/* ═══════════════════════════════════════════════════════════════════
   LockPass — 多设备同步合并引擎（设计文档 docs/multi-device-sync-design.md §6）
   纯逻辑层：不访问存储、不发网络、不依赖框架，输入输出均为普通对象。

   职责：
   - rev 序号维护：条目/标签每次真实变更时单调 +1，作为冲突判定主键
     （替代纯时间戳 LWW —— 时钟漂移的机器会永久赢得每一次冲突）；
   - mergeState：按条目 id 的双向合并，满足交换律与幂等（join 语义），
     半途失败的同步会在下一次自动收敛；
   - 真冲突不静默覆盖：落选版本以新 id 写入回收站（conflictOf 指回原 id），
     用户用现有回收站界面即可找回；
   - 墓碑表维护：collectTombstones / rememberTombstone / pruneTombstones，
     已彻底删除的条目在对端旧副本里不得复活；
   - 时钟漂移：clockSkewMs 量出对端超前量，超限则以 strict 合并 —— 所有差异
     进冲突表而不按 rev 自动选，避免快时钟机器静默赢得每一次冲突。
   ═══════════════════════════════════════════════════════════════════ */

/** 指纹忽略的键：rev 自身（否则自激）、showPassword（纯 UI 态，切换会假报变更） */
const DIGEST_IGNORED_KEYS = ['rev', 'showPassword']

/** rev 起点：历史数据与新建条目都从 1 起算 */
const REV_DEFAULT = 1

/** 密码历史合并上限（与 useVault 的 HISTORY_LIMIT 一致，可注入覆盖） */
const DEFAULT_HISTORY_LIMIT = 5

/** 墓碑保留窗口：必须长于回收站自动清理上限，否则对端旧副本会复活已删条目 */
const TOMBSTONE_RETENTION_DAYS = 365

/** 时钟漂移容忍：对端时间戳超前本机超过该值即视为时钟不可信（设计文档 §6.4） */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * 稳定序列化：递归排序对象键，使内容相同的对象得到同一字符串。
 * @param {*} value 任意 JSON 值
 * @returns {*} 键已排序的同构值
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value).sort().forEach((k) => { out[k] = canonicalize(value[k]) })
    return out
  }
  return value
}

/**
 * 非加密内容指纹（FNV-1a），只用于「这条有没有变」的变更检测，不承担安全职责。
 * @param {object} obj 源对象
 * @param {string[]} [ignore] 需忽略的键名
 * @returns {string} 指纹（哈希 + 长度，长度变化必然变）
 */
export function fingerprint(obj, ignore = DIGEST_IGNORED_KEYS) {
  const c = canonicalize(obj || {})
  ignore.forEach((k) => { delete c[k] })
  const s = JSON.stringify(c)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length
}

/** 条目指纹：带上门禁状态，删除/恢复本身算一次变更 */
function entryFingerprint(entry, alive) {
  return fingerprint(entry) + (alive ? '#a' : '#d')
}

/** 标签定义指纹（颜色 + 图标 + 默认标记） */
function tagFingerprint(def) {
  return fingerprint({ color: def && def.color, icon: def && def.icon, isDefault: !!(def && def.isDefault) })
}

const revOf = (v) => (v && typeof v.rec.rev === 'number' ? v.rec.rev : REV_DEFAULT)

/**
 * 冲突表展示用的轻量投影：只带识别信息，不外带密码/密钥等敏感字段。
 * @param {object} rec 条目记录
 * @param {boolean} alive 是否存活（false 表示该版本处于回收站）
 * @param {string} side 来源：'local' | 'remote'
 * @returns {object} 展示字段
 */
function brief(rec, alive, side) {
  return {
    side,
    alive: !!alive,
    title: rec.title || '',
    username: rec.username || '',
    entryType: rec.entryType || 'website',
    updatedAt: rec.updatedAt || '',
    rev: typeof rec.rev === 'number' ? rec.rev : REV_DEFAULT,
  }
}

/**
 * 建立「上次落盘指纹索引」，供 stampRevs 判定本次写盘是否真的改过某条目。
 * @param {{entries: object[], deleted: object[]}} state 保险箱状态
 * @returns {Map<string, string>} 条目 id → 指纹
 */
export function digestIndex(state) {
  const index = new Map()
  ;(state.entries || []).forEach((e) => { index.set(e.id, entryFingerprint(e, true)) })
  ;(state.deleted || []).forEach((e) => { index.set(e.id, entryFingerprint(e, false)) })
  return index
}

/**
 * 建立标签定义指纹索引。
 * @param {Record<string, object>} tagDefs 标签注册表
 * @returns {Map<string, string>} 标签名 → 指纹
 */
export function tagDigestIndex(tagDefs) {
  const index = new Map()
  Object.keys(tagDefs || {}).forEach((name) => { index.set(name, tagFingerprint(tagDefs[name])) })
  return index
}

/**
 * 写盘前盖序号：与上次落盘指纹比对，只有真实变更的条目/标签 rev +1。
 * 就地修改 state；写盘失败时下一次保存会重新判定，多进一位序号无害。
 * @param {{entries: object[], deleted: object[], tagDefs: Record<string, object>}} state 保险箱状态
 * @param {Map<string, string>} prevEntries 上次落盘的条目指纹（空 Map 表示全新库）
 * @param {Map<string, string>} prevTags 上次落盘的标签指纹
 * @returns {void}
 */
export function stampRevs(state, prevEntries, prevTags) {
  const aliveIds = new Set((state.entries || []).map((e) => e.id))
  const bumpEntry = (e) => {
    if (typeof e.rev !== 'number' || !Number.isFinite(e.rev)) { e.rev = REV_DEFAULT; return }
    if (prevEntries.get(e.id) !== entryFingerprint(e, aliveIds.has(e.id))) e.rev += 1
  }
  ;(state.entries || []).forEach(bumpEntry)
  ;(state.deleted || []).forEach(bumpEntry)
  Object.keys(state.tagDefs || {}).forEach((name) => {
    const def = state.tagDefs[name]
    if (typeof def.rev !== 'number' || !Number.isFinite(def.rev)) { def.rev = REV_DEFAULT; return }
    if (prevTags.get(name) !== tagFingerprint(def)) def.rev += 1
  })
}

/**
 * 收集墓碑：回收站内的软删除记录并入既往已彻底删除的 id。
 * 墓碑必须独立于回收站自动清理存活，否则对端旧副本会在下次同步时复活已删条目。
 * @param {{deleted: object[]}} state 保险箱状态
 * @param {Record<string, {rev: number, deletedAt: string}>} [previous] 已有墓碑
 * @param {string} [now] 缺失 deletedAt 时的补记时间
 * @returns {Record<string, {rev: number, deletedAt: string}>} 合并后的墓碑表
 */
export function collectTombstones(state, previous, now) {
  const stamp = now || new Date().toISOString()
  const out = {}
  Object.keys(previous || {}).forEach((id) => { out[id] = { ...previous[id] } })
  ;(state.deleted || []).forEach((e) => {
    const rev = typeof e.rev === 'number' ? e.rev : REV_DEFAULT
    const cur = out[e.id]
    if (!cur || rev >= cur.rev) out[e.id] = { rev, deletedAt: e.deletedAt || (cur && cur.deletedAt) || stamp }
  })
  return out
}

/**
 * 记录单条墓碑（彻底删除 / 清空回收站 / TTL 自动清理时即时调用）。
 * 不能只等写盘时收集：删除与彻底删除落在同一次防抖写入里时，落盘态已查不到这条。
 * @param {Record<string, {rev: number, deletedAt: string}>} tombstones 现有墓碑表
 * @param {object} entry 即将离开回收站的条目
 * @param {string} [now] 补记时间
 * @returns {void}
 */
export function rememberTombstone(tombstones, entry, now) {
  if (!tombstones || !entry || !entry.id) return
  const rev = typeof entry.rev === 'number' ? entry.rev : REV_DEFAULT
  const cur = tombstones[entry.id]
  if (!cur || rev >= cur.rev) {
    tombstones[entry.id] = { rev, deletedAt: entry.deletedAt || (cur && cur.deletedAt) || now || new Date().toISOString() }
  }
}

/**
 * 墓碑裁剪：超出保留窗口（且条目本机已不存在）的墓碑丢弃，防止无限增长。
 * @param {Record<string, {rev: number, deletedAt: string}>} tombstones 墓碑表
 * @param {string} [now] 当前时间
 * @returns {Record<string, {rev: number, deletedAt: string}>} 裁剪后的墓碑表
 */
export function pruneTombstones(tombstones, now) {
  const nowMs = new Date(now || new Date().toISOString()).getTime()
  const horizon = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const out = {}
  Object.keys(tombstones || {}).forEach((id) => {
    const t = tombstones[id]
    const ts = t && t.deletedAt ? new Date(t.deletedAt).getTime() : NaN
    if (!Number.isFinite(ts)) return
    if (nowMs - ts <= horizon) out[id] = { ...t }
  })
  return out
}

/**
 * 对端时钟相对本机的超前量（毫秒，只返回正偏差）。
 * 一台时钟快 5 分钟的电脑在纯时间戳 LWW 下会永久赢得每次冲突且用户无感，
 * 因此合并前必须先量漂移，超限则拒绝自动合并（设计文档 §6.4）。
 * @param {object} state 对端状态 { entries, deleted }
 * @param {string} [now] 本机当前时间
 * @returns {number} max(对端 updatedAt/createdAt) - now，负值归零
 */
export function clockSkewMs(state, now) {
  const nowMs = new Date(now || new Date().toISOString()).getTime()
  let max = -Infinity
  ;[...(state.entries || []), ...(state.deleted || [])].forEach((e) => {
    const ts = new Date(e.updatedAt || e.createdAt || '').getTime()
    if (Number.isFinite(ts) && ts > max) max = ts
  })
  if (!Number.isFinite(max)) return 0
  return Math.max(0, max - nowMs)
}

/** 条目视图：id → { alive, rec } */
function viewOf(state) {
  const map = new Map()
  ;(state.entries || []).forEach((e) => map.set(e.id, { alive: true, rec: e }))
  ;(state.deleted || []).forEach((e) => map.set(e.id, { alive: false, rec: e }))
  return map
}

/**
 * 双向合并（设计文档 §6.2 / §6.3）。
 *
 * 严格占优（一方 rev 更高）→ 原样取用且不进位，这是幂等的来源；
 * 双方 rev 相同且内容不同 → 真冲突，按确定性顺序选一（updatedAt → 指纹字典序，
 * 与谁是本机无关，这是交换律的来源），胜版进位、落版以新 id 进回收站。
 *
 * @param {object} input
 * @param {object} input.local 本机状态 { entries, deleted, tagDefs, history, tags }
 * @param {object} input.remote 对端状态（同构）
 * @param {Record<string, {rev:number, deletedAt:string}>} [input.tombstones] 上次同步后的删除记录
 * @param {() => string} [input.newId] 落选副本的 id 生成器
 * @param {string} [input.now] ISO 时间戳（测试可注入）
 * @param {number} [input.historyLimit] 每条目历史保留上限
 * @param {boolean} [input.strict] 时钟不可信时置真：所有差异都进冲突表，不按 rev 自动选
 * @returns {{state: object, summary: object, conflicts: object[], tombstones: object}} 合并结果
 */
export function mergeState({ local, remote, tombstones = {}, newId, now, historyLimit = DEFAULT_HISTORY_LIMIT, strict = false }) {
  const makeId = typeof newId === 'function' ? newId : () => 'conflict-' + fingerprint({ t: stamp(), n: Math.random() })
  const stamp = () => now || new Date().toISOString()
  const L = viewOf(local)
  const R = viewOf(remote)

  const entries = []
  const deleted = []
  const tombstoneOut = { ...tombstones }
  const conflicts = []
  const history = {}

  /** 原样取用某一版本（保留其 rev） */
  const adopt = (v) => {
    const clone = canonicalize(v.rec)
    if (v.alive) entries.push(clone); else deleted.push(clone)
    return clone
  }

  /** 真冲突：胜版 rev 进位，落版以新 id 进回收站 */
  const resolveConflict = (id, l, r, winner, reason) => {
    const loser = winner === l ? r : l
    const win = canonicalize(winner.rec)
    win.rev = Math.max(revOf(l), revOf(r)) + REV_DEFAULT
    const lose = canonicalize(loser.rec)
    lose.id = makeId()
    lose.rev = REV_DEFAULT
    lose.conflictOf = id
    lose.deletedAt = stamp()
    lose.deletedReason = 'sync-conflict'
    if (winner.alive) entries.push(win); else deleted.push(win)
    deleted.push(lose)
    conflicts.push({
      id,
      title: win.title || '',
      reason: reason || 'equal-rev',
      winnerSide: winner === l ? 'local' : 'remote',
      loserSide: loser === l ? 'local' : 'remote',
      loserCopyId: lose.id,
      // 冲突表只需要识别与时间信息，不搬运密码等敏感字段（rev 取冲突前的原值）
      winner: brief(winner.rec, winner.alive, winner === l ? 'local' : 'remote'),
      loser: brief(loser.rec, loser.alive, loser === l ? 'local' : 'remote'),
    })
  }

  /**
   * 并列时的确定性选择（必须与「谁是本机」无关，否则破坏交换律）：
   * 1. rev 大者（strict 模式下仍按 rev 给出默认选中项，但差异已全部进冲突表）；
   * 2. 内容相同仅一活一删 → 删除优先（安全基线，且两边算出的结果一致）；
   * 3. 否则 updatedAt 新者；
   * 4. 仍并列 → 指纹字典序小者。
   */
  const pickDeterministic = (l, r) => {
    if (revOf(l) !== revOf(r)) return revOf(l) > revOf(r) ? l : r
    if (l.alive !== r.alive && fingerprint(l.rec) === fingerprint(r.rec)) return l.alive ? r : l
    const lu = String(l.rec.updatedAt || ''), ru = String(r.rec.updatedAt || '')
    if (lu !== ru) return lu > ru ? l : r
    return fingerprint(l.rec) <= fingerprint(r.rec) ? l : r
  }

  /**
   * 历史合并：两边快照并集，按 at 倒序、同 at 按指纹序（与谁是本机无关），截断到上限。
   * 同一 at 的不同快照都要保留，否则去重顺序会随合并方向变化而破坏交换律。
   */
  const mergeHistory = (id) => {
    const list = [...(local.history || {})[id] || [], ...(remote.history || {})[id] || []]
    if (!list.length) return
    const byKey = new Map()
    list.forEach((s) => {
      if (!s || !s.at) return
      const key = s.at + '|' + fingerprint(s)
      if (!byKey.has(key)) byKey.set(key, s)
    })
    history[id] = [...byKey.values()]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || fingerprint(a).localeCompare(fingerprint(b)))
      .slice(0, historyLimit)
  }

  // 顺序：本机条目在前、对端独有条目追加在后。展示顺序不属于 join 等价性。
  const orderedIds = []
  const pushed = new Set()
  ;[...L.keys(), ...R.keys(), ...Object.keys(tombstones)].forEach((id) => {
    if (!pushed.has(id)) { pushed.add(id); orderedIds.push(id) }
  })

  for (const id of orderedIds) {
    const l = L.get(id), r = R.get(id)
    const tomb = tombstones[id]

    if (!l && !r) {
      // 两边都没有：墓碑原样保留，已彻底删除的条目不得复活
      if (tomb) tombstoneOut[id] = { ...tomb }
      continue
    }
    if (l && !r) {
      // 对端缺席：有墓碑即「对端删除后已清理回收站」，本机未超过该序号则维持删除
      if (tomb && revOf(l) <= tomb.rev) { tombstoneOut[id] = { ...tomb }; continue }
      adopt(l); mergeHistory(id); continue
    }
    if (r && !l) {
      if (tomb && revOf(r) <= tomb.rev) { tombstoneOut[id] = { ...tomb }; continue }
      adopt(r); mergeHistory(id); continue
    }

    const rl = revOf(l), rr = revOf(r)
    const same = entryFingerprint(l.rec, l.alive) === entryFingerprint(r.rec, r.alive)
    // 内容一致：只是计数器不同，取高 rev 即可，不必制造同内容副本
    if (same) { adopt(rl >= rr ? l : r); mergeHistory(id); continue }
    // 严格占优：rev 大者原样取用（不进位，这是幂等的来源）
    if (rl !== rr && !strict) { rl > rr ? adopt(l) : adopt(r); mergeHistory(id); continue }
    // 其余（rev 并列，或 strict 下内容存在差异）→ 真冲突，默认选中仍按确定性顺序
    resolveConflict(id, l, r, pickDeterministic(l, r), rl !== rr ? 'clock-skew' : 'equal-rev')
    mergeHistory(id)
  }

  /* ── 标签定义：按 name 并集；同名异属性按 rev，rev 并列按确定性选择 ── */
  const usedTagNames = new Set()
  entries.forEach((e) => (e.tags || []).forEach((name) => usedTagNames.add(name)))
  const tagDefs = {}
  const tagNames = new Set([...Object.keys(local.tagDefs || {}), ...Object.keys(remote.tagDefs || {})])
  tagNames.forEach((name) => {
    const a = (local.tagDefs || {})[name], b = (remote.tagDefs || {})[name]
    if (!a || !b) { tagDefs[name] = canonicalize(a || b); return }
    if (tagFingerprint(a) === tagFingerprint(b)) {
      tagDefs[name] = { ...canonicalize(a), rev: Math.max(a.rev || REV_DEFAULT, b.rev || REV_DEFAULT) }
      return
    }
    const av = a.rev || REV_DEFAULT, bv = b.rev || REV_DEFAULT
    if (av !== bv) { tagDefs[name] = canonicalize(av > bv ? a : b); return }
    const winner = tagFingerprint(a) <= tagFingerprint(b) ? a : b
    tagDefs[name] = { ...canonicalize(winner), rev: av + REV_DEFAULT }
    // 新建保险箱给热门标签随机配色，两台电脑几乎必然不同。
    // 没有被任何条目用到的标签只是外观差异，取舍即可，不占用冲突表名额。
    if (usedTagNames.has(name)) {
      conflicts.push({ id: 'tag:' + name, title: name, winnerSide: winner === a ? 'local' : 'remote', tagConflict: true })
    }
  })

  /* ── 变更摘要（相对本机视角，供结果页展示） ── */
  const beforeAlive = new Set((local.entries || []).map((e) => e.id))
  const beforeDead = new Set((local.deleted || []).map((e) => e.id))
  let added = 0, updated = 0, removed = 0, restored = 0
  entries.forEach((e) => {
    const l = L.get(e.id)
    if (!beforeAlive.has(e.id) && !beforeDead.has(e.id)) added++
    else if (beforeDead.has(e.id)) restored++
    else if (l && fingerprint(l.rec) !== fingerprint(e)) updated++
  })
  deleted.forEach((e) => {
    if (e.conflictOf) return
    if (beforeAlive.has(e.id)) removed++
    else if (!beforeDead.has(e.id) && !beforeAlive.has(e.id)) added++
  })

  return {
    state: { entries, deleted, tagDefs, history, tags: (local.tags || []).slice() },
    summary: {
      added,
      updated,
      removed,
      restored,
      conflicts: conflicts.filter((c) => !c.tagConflict).length,
      tagConflicts: conflicts.filter((c) => c.tagConflict).length,
    },
    conflicts,
    tombstones: tombstoneOut,
  }
}

const SyncMerge = {
  REV_DEFAULT,
  TOMBSTONE_RETENTION_DAYS,
  MAX_CLOCK_SKEW_MS,
  fingerprint,
  digestIndex,
  tagDigestIndex,
  stampRevs,
  collectTombstones,
  rememberTombstone,
  pruneTombstones,
  clockSkewMs,
  mergeState,
}

if (typeof window !== 'undefined') window.SyncMerge = SyncMerge
export default SyncMerge
