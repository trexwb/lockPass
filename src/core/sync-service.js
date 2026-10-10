/* ═══════════════════════════════════════════════════════════════════
   LockPass — 局域网同步服务（设计文档 docs/multi-device-sync-design.md §7）

   ───────────────────────────────────────────────────────────────────
   安全红线（本模块逐条落实）：
   🔴 同步口令 P 绝不等于主密码，界面任何位置都不显示主密码。
      P 只用于派生会话鉴权密钥 K_auth；数据面直接复用既有密文信封，
      A 端不解密、不重加密、不需要一次性同步密钥（§4.1）。
   🔴 P 本身永不过线（局域网明文 HTTP 可嗅探）。只上线 HMAC(K_auth, challenge)，
      以及载荷绑定的 mac = HMAC(K_auth, iv‖data)。
   🔴 全程只搬运密文。明文只在本 webview 内存中解密与合并，不出进程。
   🔴 一次会话 600 秒上限；鉴权失败 3 次销毁服务实例。
   ───────────────────────────────────────────────────────────────────

   本模块只提供「无状态原语」：口令生成、鉴权计算、传输、信封读写。
   编排（何时合并、何时回推、UI 状态）在 composables/useSyncService.js。
   ═══════════════════════════════════════════════════════════════════ */

/* i18n：错误文案在抛出时求值（window.I18n 由 core/i18n.js 挂载） */
const t = (k, p) => window.I18n.t(k, p)

/** 同步协议版本：两端不一致即拒绝，不做部分合并 */
const SCHEMA_REV = 1

/**
 * 同步口令位数：6 位纯数字（用户 2026-10-10 拍板「越简单越好」）。
 *
 * 强度说明（记录在案，便于日后复核）：6 位数字只有约 20 bit，远低于设计文档
 * §4.2 原本要求的 40 bit。仍然可用的理由是它**只在「用户主动开启服务的 600 秒内」
 * 有效**，且：
 *   ① 在线猜测被 Rust 侧限制为 3 次（`MAX_AUTH_FAILS`），失败即销毁服务实例；
 *   ② 离线爆破必须先拿到 `challenge` + `mac`，且每次候选都要跑 600000 次 PBKDF2，
 *      无法在 600 秒会话窗口内完成；
 *   ③ 口令只用于「挑战-响应鉴权 + 载荷绑定」，不是数据加密密钥 —— 拿到它也不能
 *      解密保险箱，仍需主密码。
 * 因此它等价于蓝牙 / Wi-Fi 配对 PIN 的用法，而不是口令。若日后改为公网或长期
 * 会话，必须换回 ≥40 bit 的词组口令。
 */
const PASSCODE_DIGITS = 6
const PASSCODE_SPACE = 1000000 // 10^6

/** KDF 迭代次数：与会话鉴权密钥同强度（§4.2） */
const AUTH_ITERATIONS = 600000

/** 会话盐长度（字节） */
const SESSION_SALT_BYTES = 16

/* ── 1. 同步口令（6 位数字）───────────────────────────────────── */

/**
 * 生成一次性同步口令：6 位纯数字。
 * 用拒绝采样消除取模偏置（2^32 不是 10^6 的整数倍），保证 000000–999999 等概率。
 * @returns {string} 形如 "038417"（含前导零，固定 6 位）
 */
function generatePasscode() {
  const buf = new Uint32Array(1)
  // 可无偏映射的最大取值：floor(2^32 / 10^6) * 10^6
  const LIMIT = Math.floor(0x100000000 / PASSCODE_SPACE) * PASSCODE_SPACE
  let v = 0
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= LIMIT)
  return String(v % PASSCODE_SPACE).padStart(PASSCODE_DIGITS, '0')
}

/**
 * 归一化用户输入：去掉空格 / 分隔符等非数字字符（粘贴 "123 456" 也能用）。
 * @param {string} input
 * @returns {string} 仅含数字的字符串
 */
function normalizePasscode(input) {
  return String(input == null ? '' : input).replace(/\D/g, '')
}

/** 是否为合法口令（6 位纯数字）：提交前先校验，别浪费一次鉴权机会（只有 3 次） */
function isPasscode(input) {
  return new RegExp('^\\d{' + PASSCODE_DIGITS + '}$').test(normalizePasscode(input))
}

/* ── 2. 鉴权密钥与 mac ──────────────────────────────────────── */

/** 生成会话盐（base64，随 hello 下发；两端据此派生同一把 K_auth） */
function generateSessionSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_SALT_BYTES))
  return { bytes, b64: window.CryptoUtils.arrayBufferToBase64(bytes) }
}

/** base64 会话盐还原为字节（B 侧派生 K_auth 用） */
function sessionSaltBytes(b64) {
  return new Uint8Array(window.CryptoUtils.base64ToArrayBuffer(b64))
}

/**
 * 派生会话鉴权密钥 K_auth = PBKDF2(P, sessionSalt, 600000)
 * 注意：P 只在这里被使用一次，派生结果不外传、不落盘。
 * @param {string} passcode 一次性同步口令（6 位数字）
 * @param {Uint8Array} saltBytes 会话盐
 * @returns {Promise<CryptoKey>} HMAC-SHA256 密钥
 */
async function deriveAuthKey(passcode, saltBytes) {
  return window.CryptoUtils.deriveHmacKey(
    normalizePasscode(passcode),
    saltBytes,
    AUTH_ITERATIONS
  )
}

/**
 * 挑战-响应证明：mac = HMAC(K_auth, challenge)
 * @param {CryptoKey} authKey K_auth
 * @param {string} challenge 服务端下发的一次性挑战
 * @returns {Promise<string>} hex
 */
async function challengeMac(authKey, challenge) {
  return window.CryptoUtils.hmacHex(authKey, String(challenge || ''))
}

/**
 * 载荷完整性绑定：mac = HMAC(K_auth, iv‖data)
 * 防止中间人替换密文诱导两端一起写入被污染的库（§4.2）。
 * @param {CryptoKey} authKey K_auth
 * @param {string} iv base64 IV
 * @param {string} data base64 密文
 * @returns {Promise<string>} hex
 */
async function payloadMac(authKey, iv, data) {
  return window.CryptoUtils.hmacHex(authKey, String(iv || '') + String(data || ''))
}

/* ── 3. 传输层 ────────────────────────────────────────────────
   桌面版：CSP connect-src 不放行 LAN 地址 → 必须由 Rust 发起 HTTP。
   浏览器版（file:// 或 localhost）：直连 fetch，服务端已回 CORS 头。
   两条路径对上层完全一致。 */

function isDesktop() {
  return !!(window.LockTauri && window.LockTauri.isTauri)
}

/**
 * 发起同步请求
 * @param {string} method GET | POST
 * @param {string} url 完整 URL
 * @param {object|null} [bodyObj] POST JSON 体
 * @param {string} [bearer] 会话令牌
 * @returns {Promise<{status: number, body: string}>}
 */
async function request(method, url, bodyObj = null, bearer = '') {
  if (isDesktop()) {
    return window.LockTauri.invoke('sync_client_request', {
      method,
      url,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
      bearer: bearer || null,
    })
  }
  const headers = {}
  if (bodyObj) headers['Content-Type'] = 'application/json'
  if (bearer) headers['Authorization'] = 'Bearer ' + bearer
  const res = await fetch(url, {
    method,
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  })
  return { status: res.status, body: await res.text() }
}

/** 解析响应：非 2xx 抛统一错误（携带服务端错误码），JSON 解析失败按协议错误处理 */
function parseReply(reply, okStatuses = [200]) {
  const status = Number(reply && reply.status) || 0
  let json = null
  try {
    json = JSON.parse((reply && reply.body) || '{}')
  } catch (e) {
    json = null
  }
  if (okStatuses.includes(status)) return json || {}
  const code = (json && json.error) || 'E_UNKNOWN'
  const err = new Error(code)
  err.syncCode = code
  err.syncStatus = status
  err.payload = json || {}
  throw err
}

function baseUrlOf(ip, port) {
  const host = String(ip || '').trim()
  const p = Number(port)
  if (!host || !Number.isFinite(p) || p <= 0 || p > 65535) {
    throw new Error(t('syncService.err.badAddress'))
  }
  return 'http://' + host + ':' + p
}

/* ── 4. 端点封装（B 侧）────────────────────────────────────── */

async function hello(baseUrl) {
  return parseReply(await request('GET', baseUrl + '/sync/hello'))
}

async function challenge(baseUrl) {
  return parseReply(await request('GET', baseUrl + '/sync/challenge'))
}

async function auth(baseUrl, mac) {
  return parseReply(await request('POST', baseUrl + '/sync/auth', { mac }))
}

async function snapshot(baseUrl, token) {
  return parseReply(await request('GET', baseUrl + '/sync/snapshot', null, token))
}

async function apply(baseUrl, token, payload) {
  return parseReply(await request('POST', baseUrl + '/sync/apply', payload, token))
}

async function deactivate(baseUrl, token) {
  return parseReply(await request('POST', baseUrl + '/sync/deactivate', {}, token))
}

/* ── 5. 本机信封读写（A 侧起服务 / 回写落盘都用它）───────────── */

/**
 * 读取本机当前加密信封（与 file-sync 负载同构，不新增格式）
 * @returns {Promise<{salt: string, iterations: number, iv: string, data: string}>}
 */
async function readLocalEnvelope() {
  const saltRec = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'salt')
  const iterRec = await window.DBUtils.dbGet(window.DBUtils.STORE_META, 'iterations')
  const vaultRec = await window.DBUtils.dbGet(window.DBUtils.STORE_VAULT, 'main')
  if (!saltRec || !vaultRec) throw new Error(t('syncService.err.noVault'))
  return {
    salt: saltRec.value,
    iterations: Number(iterRec && iterRec.value) || window.CryptoUtils.LEGACY_ITERATIONS,
    iv: vaultRec.iv,
    data: vaultRec.data,
  }
}

/**
 * 用主密码解密对端信封
 * @param {object} envelope {salt, iterations, iv, data}
 * @param {string} masterPassword 本机主密码（与对端相同，§2 硬前置）
 * @returns {Promise<object>} 对端明文状态
 */
async function decryptEnvelope(envelope, masterPassword) {
  const salt = new Uint8Array(window.CryptoUtils.base64ToArrayBuffer(envelope.salt))
  const key = await window.CryptoUtils.deriveKey(
    masterPassword,
    salt,
    Number(envelope.iterations) || window.CryptoUtils.LEGACY_ITERATIONS
  )
  try {
    return await window.CryptoUtils.decrypt(envelope.data, envelope.iv, key)
  } catch (e) {
    // 主密码不同 → 不跨主密码自动合并，引导改用 .vault 单边迁移（§4.3）
    const err = new Error('E_KEY_MISMATCH')
    err.syncCode = 'E_KEY_MISMATCH'
    throw err
  }
}

/**
 * 用会话密钥加密整包状态
 * @param {object} state {entries, history, tagDefs, tags, deleted}
 * @param {string} masterPassword 主密码
 * @param {object} kdf {salt: string(base64), iterations: number} —— 回写时必须用
 *   **接收端（A）自己的 KDF 参数**，A 才能用自身主密码解密后原样落盘，不改动 meta.salt（§7.2）
 * @returns {Promise<{iv: string, data: string}>}
 */
async function encryptState(state, masterPassword, kdf) {
  const salt = new Uint8Array(window.CryptoUtils.base64ToArrayBuffer(kdf.salt))
  const key = await window.CryptoUtils.deriveKey(
    masterPassword,
    salt,
    Number(kdf.iterations) || window.CryptoUtils.LEGACY_ITERATIONS
  )
  return window.CryptoUtils.encrypt(state, key)
}

/** 整包状态的最大 rev（乐观锁 baseRev / newRev 用） */
function maxRev(state) {
  let max = 0
  const bump = (v) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > max) max = n
  }
  ;(state.entries || []).forEach(e => bump(e && e.rev))
  ;(state.deleted || []).forEach(e => bump(e && e.rev))
  Object.keys(state.tagDefs || {}).forEach(n => bump(state.tagDefs[n] && state.tagDefs[n].rev))
  return max
}

/* ── 6. 服务端命令封装（A 侧）──────────────────────────────── */

const host = {
  async listIps() {
    return window.LockTauri.invoke('sync_list_local_ips')
  },

  /**
   * 开启服务
   * @param {object} args {deviceId, appVersion, sessionSaltB64, envelope, mac, rev, bindIp, travelMode}
   * @returns {Promise<{port: number, bindIp: string, expiresAt: number}>}
   */
  async start(args) {
    return window.LockTauri.invoke('sync_start', {
      bindIp: args.bindIp,
      args: {
        deviceId: args.deviceId,
        appVersion: args.appVersion,
        sessionSalt: args.sessionSaltB64,
        snapshot: {
          salt: args.envelope.salt,
          iterations: args.envelope.iterations,
          iv: args.envelope.iv,
          data: args.envelope.data,
        },
        mac: args.mac,
        rev: args.rev,
        travelMode: !!args.travelMode,
      },
    })
  },

  async stop() {
    return window.LockTauri.invoke('sync_stop')
  },

  async status() {
    return window.LockTauri.invoke('sync_status')
  },

  async setReady(unlocked) {
    return window.LockTauri.invoke('sync_set_ready', { unlocked: !!unlocked })
  },

  /** 本机数据变更时刷新服务端快照（对端才拉得到最新密文） */
  async setSnapshot(envelope, rev, mac) {
    return window.LockTauri.invoke('sync_set_snapshot', {
      snapshot: {
        salt: envelope.salt,
        iterations: envelope.iterations,
        iv: envelope.iv,
        data: envelope.data,
      },
      rev,
      mac,
    })
  },

  /** 裁决挑战-响应（Rust 不持有 K_auth，由前端判定后回报） */
  async answerAuth(challengeValue, ok) {
    return window.LockTauri.invoke('sync_auth_verdict', { challenge: challengeValue, ok: !!ok })
  },

  /** 裁决回写（前端验 mac 通过并落盘后回报） */
  async answerApply(id, ok) {
    return window.LockTauri.invoke('sync_apply_verdict', { id, ok: !!ok })
  },
}

window.SyncService = {
  SCHEMA_REV,
  AUTH_ITERATIONS,
  generatePasscode,
  normalizePasscode,
  isPasscode,
  PASSCODE_DIGITS,
  generateSessionSalt,
  sessionSaltBytes,
  deriveAuthKey,
  challengeMac,
  payloadMac,
  request,
  parseReply,
  baseUrlOf,
  hello,
  challenge,
  auth,
  snapshot,
  apply,
  deactivate,
  readLocalEnvelope,
  decryptEnvelope,
  encryptState,
  maxRev,
  host,
  isDesktop,
}
