/* ═══════════════════════════════════════════════════════════════════
   LockPass — 局域网同步编排（设计文档 docs/multi-device-sync-design.md §7 / §8）

   本层负责「什么时候做什么」：A 侧开启服务并裁决对端请求，B 侧
   鉴权 → 拉取 → 合并 → **回推** → 结束。密文搬运与鉴权计算全部下沉到
   core/sync-service.js，本层不碰任何密码学细节。

   ── 为什么「单向拉取后要回推」（本项目对 P1 的增强）─────────────
   设计文档原计划 P1 只做 A→B 单向拉取、P2 再做 B→A 回写。用户要求一次
   到位：B 拉到 A 的快照后在**本地**完成双向合并（sync-merge.js 的 join
   语义），再把合并结果整包推回 A（POST /sync/apply，带 baseRev 乐观锁）。
   这样一轮同步结束时**两端都持有同一份合并结果**，而不是「B 更新了、A 还是旧的」。
   A 侧不做二次合并 —— B 推来的已是合并完成的整包，A 只校验 baseRev 与
   mac 后原样落盘（§7.2）。这依赖 §6.3 的交换律/幂等：半途失败的两边不一致
   会在下一轮自动收敛。
   ═══════════════════════════════════════════════════════════════════ */

import { reactive, onBeforeUnmount } from 'vue'
import { useVault, vaultState } from './useVault'
import { APP_VERSION } from '../core/version.js'

/* i18n：文案在调用时求值 */
const t = (k, p) => window.I18n.t(k, p)

/** 设备标识：本机唯一、不随同步漂移；非敏感，存 localStorage 即可 */
const DEVICE_ID_KEY = 'lockpass_device_id'

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = window.CryptoUtils.uuid()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch (e) {
    return 'unknown-device'
  }
}

/**
 * 取出任意抛错形态的可读文本。
 *
 * 🔴 不能只读 `err.message`：Tauri v2 的 `invoke` 在命令返回 `Err(String)` 时
 * reject 的是**裸字符串**（Rust 侧的中文原因就在里面），不是 Error。
 * 只读 message 会得到 undefined → 界面显示「同步失败：」空串，真实原因被吞掉。
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  if (err == null) return ''
  if (typeof err === 'string') return err.trim()
  if (err instanceof Error) return String(err.message || err.name || '').trim()
  if (typeof err === 'object') {
    const inner = err.message || err.error || ''
    if (inner) return String(inner).trim()
    try { return JSON.stringify(err) } catch (e) { return String(err).trim() }
  }
  return String(err).trim()
}

/** 把同步错误码 / 原始文本翻译成用户文案（§7.3 / §4.3） */
function describeError(err) {
  const msg = messageOf(err)
  const code = (err && err.syncCode) || (msg === 'E_KEY_MISMATCH' ? 'E_KEY_MISMATCH' : '')
  switch (code) {
    case 'E_SCHEMA_MISMATCH': return t('syncService.err.schema')
    case 'E_BAD_MAC': return t('syncService.err.badMac')
    case 'E_LOCKED': return t('syncService.err.locked')
    case 'E_TRAVEL_MODE': return t('syncService.err.travelMode')
    case 'E_REV_CONFLICT': return t('syncService.err.revConflict')
    case 'E_SESSION_EXPIRED': return t('syncService.err.expired')
    case 'E_TOO_LARGE': return t('syncService.err.tooLarge')
    case 'E_BUSY': return t('syncService.err.busy')
    case 'E_TOO_MANY_AUTH_FAILS': return t('syncService.err.tooManyFails')
    case 'E_KEY_MISMATCH': return t('syncService.err.keyMismatch')
    case 'E_NO_VAULT': return t('syncService.err.noRemoteVault')
    case 'E_CANCELLED': return t('syncService.err.cancelled')
    case 'E_MIXED_CONTENT': return t('syncService.err.mixedContent')
    default:
      // 系统拦截本机访问局域网（macOS「本地网络」隐私未授权时 Rust connect 即 EPERM）：
      // 必须先于「连不上」判定，否则会被误判成网段选错而给出错误引导
      if (/Operation not permitted|Permission denied|EACCES|os error 1\b/i.test(msg)) {
        return t('syncService.err.localNetworkBlocked')
      }
      // 连不上（fetch/invoke 抛错，无 syncCode）按网络不通给专门的引导文案：
      // 选错网段是「连不上」的头号原因（§9）
      if (/Failed to fetch|Load failed|NetworkError|timed out|Connection refused|No route to host|Host is down|连接/i.test(msg)) {
        return t('syncService.err.unreachable')
      }
      return t('syncService.err.unknown', { msg: msg || t('syncService.err.noDetail') })
  }
}

export function useSyncService() {
  const {
    saveVault,
    mergeExternalState,
    getSession,
    resetLockTimer,
    refreshSyncDigests,
  } = useVault()

  const s = reactive({
    /** 'menu' | 'host' | 'client' */
    mode: 'menu',
    busy: false,
    error: '',
    /** A 侧 */
    ips: [],
    selectedIp: '',
    passcode: '',
    hostSaltB64: '', // 会话盐（公开值：随 hello 下发给对端，用于派生同一把 K_auth）
    server: null, // { bindIp, port, expiresAt }
    countdown: 0,
    /** B 侧 */
    remoteIp: '',
    remotePort: 5613,
    remotePass: '',
    preview: null, // { deviceId, appVersion, rev, skewMs, skewWarn }
    /** 进度 */
    step: '', // 'auth' | 'pull' | 'merge' | 'push' | 'done'
    result: null, // { summary, conflicts }
    /** 桌面端才具备开启服务的能力（浏览器版只能当客户端，§2 / §7.4） */
    canHost: window.SyncService.isDesktop(),
  })

  /* ── 会话内的非响应式句柄（密钥绝不放进 reactive，避免被序列化/追踪）── */
  let mounted = true // 组件是否已卸载（决定卸载后是否还继续做异步工作）
  let hostAuthKey = null // A 侧 K_auth
  let hostEnvelope = null // A 侧当前信封
  let clientAuthKey = null // B 侧 K_auth
  let clientToken = ''
  let clientBaseUrl = ''
  let countdownTimer = null

  /* ── 主密码：同步的硬前置是两端主密码相同（§2）─────────────────
     生物识别解锁的会话里没有主密码，必须显式询问。
     🔴 主密码只在本地用于派生解密密钥，永不上线、不写盘、不打印。 */
  async function ensureMasterPassword() {
    const existing = getSession && getSession()
    if (existing) return existing
    const pw = await window.Utils.prompt({
      title: t('syncService.pw.title'),
      message: t('syncService.pw.msg'),
      placeholder: t('syncService.pw.ph'),
      password: true,
      selectAll: false,
    })
    if (!pw) {
      const err = new Error('E_CANCELLED')
      err.syncCode = 'E_CANCELLED'
      throw err
    }
    return pw
  }

  function setError(err) {
    s.error = describeError(err)
    console.error('[LockPass/sync]', err)
  }

  /* ══════════ A 侧：开启服务 ══════════ */

  /**
   * 保证会话材料就绪（信封 / 会话盐 / 口令 / K_auth / 网卡列表）。
   *
   * 幂等且可重复调用：每次「开启服务」都必须是一次全新会话 —— 新盐、新口令、新
   * K_auth。停止服务后这些材料会被丢弃，若不重新生成就再次点「开启服务」，
   * `hostAuthKey` 仍是 null，`crypto.subtle.sign('HMAC', null, …)` 会抛
   * "Argument 2 ('key') … must be an instance of CryptoKey"（二次开启必崩）。
   * 网卡列表只在首次拉取（用户可能已选好 IP，不应被重置）。
   */
  async function ensureHostSession() {
    if (!hostEnvelope) hostEnvelope = await window.SyncService.readLocalEnvelope()
    if (!s.ips.length) {
      s.ips = await window.SyncService.host.listIps()
      if (!s.selectedIp) s.selectedIp = s.ips[0] || ''
      if (!s.ips.length) s.error = t('syncService.err.noLanIp')
    }
    // 只要口令材料缺失就整套重发（停止服务 / 会话到期 / 首次进入都走这里）
    if (!hostAuthKey || !s.passcode || !s.hostSaltB64) {
      const salt = window.SyncService.generateSessionSalt()
      const pass = window.SyncService.generatePasscode()
      s.hostSaltB64 = salt.b64 // 先落盐再派生：派生是异步的，避免中间态被读到空串
      s.passcode = pass
      hostAuthKey = await window.SyncService.deriveAuthKey(pass, salt.bytes)
    }
  }

  /** 进入「开启服务」视图 */
  async function prepareHost() {
    s.mode = 'host'
    s.error = ''
    s.busy = true
    try {
      await ensureHostSession()
    } catch (e) {
      setError(e)
    } finally {
      s.busy = false
    }
  }

  /** 真正在选定网卡上监听（用户确认 IP 后） */
  async function startHost() {
    if (!s.selectedIp) {
      s.error = t('syncService.err.noLanIp')
      return
    }
    s.busy = true
    s.error = ''
    try {
      // 二次开启 / 到期后重开：会话材料可能已被 stopHost 丢弃，这里按需重建
      await ensureHostSession()
      // 每次开启都重读本机信封：上一轮同步可能已把合并结果落盘，
      // 沿用内存里的旧信封会让对端拉到过期数据（且 mac 与 rev 对不上）。
      hostEnvelope = await window.SyncService.readLocalEnvelope()
      // 旅行模式：入口即禁用（§8），Rust 侧也会拒，这里提前拦下给出可读文案
      if (vaultState.travelMode) throw new Error('E_TRAVEL_MODE')
      const mac = await window.SyncService.payloadMac(hostAuthKey, hostEnvelope.iv, hostEnvelope.data)
      const res = await window.SyncService.host.start({
        deviceId: getDeviceId(),
        appVersion: APP_VERSION || '0.0.0',
        sessionSaltB64: s.hostSaltB64,
        envelope: hostEnvelope,
        mac,
        rev: window.SyncService.maxRev(vaultState),
        bindIp: s.selectedIp,
        travelMode: vaultState.travelMode,
      })
      await window.SyncService.host.setReady(true)
      s.server = res
      startCountdown()
    } catch (e) {
      if (messageOf(e) === 'E_TRAVEL_MODE') {
        s.error = t('syncService.err.travelMode')
      } else {
        setError(e)
      }
    } finally {
      s.busy = false
    }
  }

  async function stopHost() {
    stopCountdown()
    try { await window.SyncService.host.stop() } catch (e) { /* 停止失败无副作用 */ }
    s.server = null
    s.passcode = ''
    s.hostSaltB64 = ''
    hostAuthKey = null
    // 会话材料已作废（口令一次性）。组件仍在时立刻换一副新的，
    // 免得面板停在「空白口令」状态；卸载中则不要再做任何异步工作。
    if (!mounted) return
    try { await ensureHostSession() } catch (e) { /* 换口令失败不影响已停止的服务 */ }
  }

  function startCountdown() {
    stopCountdown()
    const tick = () => {
      if (!s.server) return
      const left = Math.max(0, Math.round((s.server.expiresAt - Date.now() / 1000)))
      s.countdown = left
      if (left <= 0) stopHost()
    }
    tick()
    countdownTimer = setInterval(tick, 1000)
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  /* ── A 侧裁决：Rust 不持有 K_auth，只有前端能判定 ────────────── */

  async function onAuthRequest(payload) {
    try {
      const expect = await window.SyncService.challengeMac(hostAuthKey, payload.challenge)
      // 常数时间不现实（字面量比较在 JS 侧），但 challenge 是一次性的，
      // 且 mac 长度固定；真正的防护是「错 3 次销毁服务」（Rust 侧计数）。
      await window.SyncService.host.answerAuth(payload.challenge, expect === payload.mac)
    } catch (e) {
      try { await window.SyncService.host.answerAuth(payload.challenge, false) } catch (_e) {}
    }
  }

  async function onApplyRequest(payload) {
    try {
      const expect = await window.SyncService.payloadMac(hostAuthKey, payload.iv, payload.data)
      if (expect !== payload.mac) {
        // 载荷被替换：拒绝，绝不落盘
        await window.SyncService.host.answerApply(payload.id, false)
        return
      }
      // 回滚点：落盘前先写一份本地加密快照（§7.2）
      try { await window.BackupManager.createSnapshot() } catch (e) { /* 快照失败不阻断 */ }

      // A 用自身主密码解密（B 是按 A 的 salt/iterations 加密的），原样落盘，
      // 不改动 meta.salt
      const masterPw = await ensureMasterPassword()
      const plain = await window.SyncService.decryptEnvelope(
        { salt: payload.salt, iterations: payload.iterations, iv: payload.iv, data: payload.data },
        masterPw
      )
      await window.DBUtils.dbPut(window.DBUtils.STORE_VAULT, {
        id: 'main',
        iv: payload.iv,
        data: payload.data,
      })
      // 内存态同步为合并结果，并重建 rev 基线（否则下次写盘会把全部条目 rev 误 +1）
      vaultState.entries = plain.entries || []
      vaultState.history = plain.history || {}
      vaultState.tagDefs = plain.tagDefs || {}
      vaultState.tags = plain.tags || []
      vaultState.deleted = plain.deleted || []
      refreshSyncDigests()
      window.Utils.showToast(t('syncService.host.applied'), 'success')
      await window.SyncService.host.answerApply(payload.id, true)
      // 服务端快照由 Rust 用本次信封自动更新（含 mac 与 rev），无需再推一次
    } catch (e) {
      try { await window.SyncService.host.answerApply(payload.id, false) } catch (_e) {}
    }
  }

  /* ══════════ B 侧：连接并同步 ══════════ */

  function enterClient() {
    s.mode = 'client'
    s.error = ''
    s.preview = null
    s.result = null
  }

  /** 第一步：hello —— 拿协议版本、会话盐、对端 rev，并量时钟漂移 */
  async function connect() {
    s.busy = true
    s.error = ''
    try {
      // 口令只有 3 次机会（Rust 侧错 3 次即销毁服务），提交前先本地校验格式
      if (!window.SyncService.isPasscode(s.remotePass)) {
        s.error = t('syncService.err.badPassFormat')
        return false
      }
      clientBaseUrl = window.SyncService.baseUrlOf(s.remoteIp, s.remotePort)
      const h = await window.SyncService.hello(clientBaseUrl)
      if (Number(h.schemaRev) !== window.SyncService.SCHEMA_REV) {
        const err = new Error('E_SCHEMA_MISMATCH')
        err.syncCode = 'E_SCHEMA_MISMATCH'
        throw err
      }
      const serverMs = Number(h.serverTime) * 1000
      const skewMs = Math.max(0, serverMs - Date.now())
      s.preview = {
        deviceId: h.deviceId,
        appVersion: h.appVersion,
        rev: h.rev,
        skewMs,
        // 漂移超 5 分钟 → 不按 rev 自动选，全部差异进冲突表（§6.4）
        skewWarn: skewMs > window.SyncMerge.MAX_CLOCK_SKEW_MS,
      }
      return true
    } catch (e) {
      setError(e)
      return false
    } finally {
      s.busy = false
    }
  }

  /**
   * 完整一轮：鉴权 → 拉取 → 合并 → 回推 → 结束
   * @param {number} [retry=0] 409 自动重跑的轮次（只重跑一次）
   */
  async function runSync(retry = 0) {
    s.busy = true
    s.error = ''
    s.result = null
    // 同步跨两台机器，耗时不可控：挂起自动锁定（与捕获确认同口径）
    vaultState.syncPending = true
    resetLockTimer()
    try {
      /* 1) 鉴权：挑战-响应（口令永不上线） */
      s.step = 'auth'
      const h = await window.SyncService.hello(clientBaseUrl)
      const ch = await window.SyncService.challenge(clientBaseUrl)
      clientAuthKey = await window.SyncService.deriveAuthKey(
        s.remotePass,
        window.SyncService.sessionSaltBytes(h.sessionSalt)
      )
      const mac = await window.SyncService.challengeMac(clientAuthKey, ch.challenge)
      const authed = await window.SyncService.auth(clientBaseUrl, mac)
      clientToken = authed.sessionToken
      if (!clientToken) {
        const err = new Error('E_BAD_MAC')
        err.syncCode = 'E_BAD_MAC'
        throw err
      }

      /* 2) 拉取快照（只搬密文） */
      s.step = 'pull'
      const snap = await window.SyncService.snapshot(clientBaseUrl, clientToken)
      const expectMac = await window.SyncService.payloadMac(clientAuthKey, snap.iv, snap.data)
      if (expectMac !== snap.mac) {
        const err = new Error('E_BAD_MAC')
        err.syncCode = 'E_BAD_MAC'
        throw err
      }
      const masterPw = await ensureMasterPassword()
      const remote = await window.SyncService.decryptEnvelope(snap, masterPw)

      /* 3) 本地双向合并（join 语义：交换律 + 幂等） */
      s.step = 'merge'
      const merged = mergeExternalState(remote)
      const okSaved = await saveVault()
      if (!okSaved) throw new Error(t('syncService.err.saveFailed'))

      /* 4) 回推：把合并结果整包推回 A，两端同时收敛 */
      s.step = 'push'
      const newRev = window.SyncService.maxRev(vaultState)
      const { iv, data } = await window.SyncService.encryptState(
        {
          entries: vaultState.entries,
          history: vaultState.history,
          tagDefs: vaultState.tagDefs,
          tags: vaultState.tags,
          deleted: vaultState.deleted,
        },
        masterPw,
        { salt: snap.salt, iterations: snap.iterations } // 沿用 A 的 KDF 参数
      )
      const pushMac = await window.SyncService.payloadMac(clientAuthKey, iv, data)
      let applied
      try {
        applied = await window.SyncService.apply(clientBaseUrl, clientToken, {
          salt: snap.salt,
          iterations: snap.iterations,
          iv,
          data,
          mac: pushMac,
          baseRev: snap.rev,
          rev: newRev,
        })
      } catch (e) {
        // A 在拉取后被改过 → 自动重跑一轮（§7.3 / §9）
        if (e && e.syncCode === 'E_REV_CONFLICT' && retry < 1) {
          window.Utils.showToast(t('syncService.retrying'), 'info')
          return runSync(retry + 1)
        }
        throw e
      }

      /* 5) 收尾：通知 A 关闭服务 */
      s.step = 'done'
      try { await window.SyncService.deactivate(clientBaseUrl, clientToken) } catch (e) { /* 已结束 */ }
      s.result = {
        summary: merged.summary,
        conflicts: merged.conflicts || [],
        skewMs: merged.skewMs,
        strict: merged.strict,
        newRev: applied && applied.newRev,
      }
      return true
    } catch (e) {
      setError(e)
      return false
    } finally {
      s.busy = false
      s.step = ''
      vaultState.syncPending = false
      resetLockTimer()
      clientToken = ''
      clientAuthKey = null
    }
  }

  /* ── 事件订阅：只有桌面端能收到（A 侧裁决用）──────────────── */
  const unlisteners = []
  async function bindHostEvents() {
    const LT = window.LockTauri || {}
    if (!LT.isTauri || typeof LT.listen !== 'function') return
    try {
      unlisteners.push(await LT.listen('lockpass:sync-auth', (ev) => onAuthRequest(ev.payload || {})))
      unlisteners.push(await LT.listen('lockpass:sync-apply', (ev) => onApplyRequest(ev.payload || {})))
      unlisteners.push(await LT.listen('lockpass:sync-destroyed', () => {
        s.error = t('syncService.err.destroyed')
        s.server = null
        stopCountdown()
      }))
      unlisteners.push(await LT.listen('lockpass:sync-deactivated', () => {
        s.server = null
        stopCountdown()
      }))
    } catch (e) { /* 监听失败仅影响 A 侧裁决，不影响 B 侧发起同步 */ }
  }
  bindHostEvents()

  onBeforeUnmount(async () => {
    mounted = false
    stopCountdown()
    while (unlisteners.length) {
      const fn = unlisteners.pop()
      try { if (typeof fn === 'function') fn() } catch (e) {}
    }
    if (s.server) {
      try { await window.SyncService.host.stop() } catch (e) {}
    }
  })

  return {
    s,
    prepareHost,
    startHost,
    stopHost,
    enterClient,
    connect,
    runSync,
    describeError,
  }
}
