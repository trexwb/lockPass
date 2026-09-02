/* ═══════════════════════════════════════════════════════════════════
   LockPass — 编辑器草稿分级缓存（S1 审计修复 · v2 分级策略）
   ───────────────────────────────────────────────────────────────────
   旧实现把含明文（password/privateKey/rootPwd 等）的完整表单对象
   JSON.stringify 实时写入 sessionStorage —— 明文持久化面过大。

   v2 分级策略（两层）：
     1) 内存 Map（_drafts）：保存全量表单快照，含敏感字段明文。
        用于同一次解锁会话内误关/误切后的即时恢复，刷新即失。
     2) sessionStorage（仅脱敏子集）：只写「确定不含机密语义」的
        元数据字段（title/entryType/tags + fields 中的 url/username/
        port/dbType/dbName/appId/rootUser 等，依据 TYPE_FIELD_KEYS
        实际 schema 判定；自定义字段仅保留 label 语义明确的非敏感
        项），用于刷新 / 意外关闭后恢复非敏感表单骨架。写入加防抖
        （默认 300ms），避免高频键入反复触碰持久化层。
   敏感语义字段（password/privateKey/rootPwd/token/apiKey/publicKey/
   otp/secret/seed/recovery，以及自定义字段 label 命中敏感词的项、
   sensitive===true 的 pin/otp 类型）一律不落任何持久化媒介。

   存储键空间：
     • 旧版明文残留键：lockpass_draft_*（本模块不读写，由调用方
       在挂载/锁定时兜底清理，防止从旧格式恢复出敏感明文）
     • 脱敏草稿键：lockpass_safe_draft_*（本模块专用）
   清理时机（草稿生命周期 v1.1.12b 规则）：
     • 仅「提交并保存成功」/ 用户显式操作（右键「清空草稿」、
       草稿询问中选择不使用）→ clearDraft() 清内存与该 key 脱敏 storage
     • 任何关闭 / 跳转 / 切换 / 刷新（页面刷新前 pagehide 兜底 flush）
       → 均不清空；内存全量明文在关闭后仍可被同一会话重新打开恢复，
       刷新前未落盘的非敏感骨架由 flushDrafts 立即补齐到 sessionStorage
     • 锁定 / 退出登录 → clearAllDrafts() 清内存全量 + 取消防抖待写；
       已落盘的脱敏子集无机密语义，可保留用于下次恢复
   ═══════════════════════════════════════════════════════════════════ */

const _drafts = new Map()

// 脱敏子集 sessionStorage 键前缀（与旧明文键 lockpass_draft_* 严格分离）
const SAFE_PREFIX = 'lockpass_safe_draft_'
// session 写入防抖窗口（毫秒）
const STORAGE_DEBOUNCE_MS = 300
// schema v：脱敏子集 JSON 结构版本
const SCHEMA_VERSION = 2

/** 防抖定时器表：draftKey -> timerId */
const _pendingWrites = new Map()
/** 待写草稿快照表：draftKey -> 最近一次待落盘的草稿（供 flushDrafts 兜底） */
const _pendingDrafts = new Map()

/**
 * TYPE_FIELD_KEYS 中「确定不含机密语义」的元数据键白名单
 * （对齐 EntryEditorModal.vue TYPE_FIELD_KEYS + server 隐含 rootUser；
 *  password/privateKey/rootPwd 等机密键一律不在白名单内）
 */
const SAFE_FIELD_KEYS = new Set([
  'url', 'username', 'port', 'dbType', 'dbName', 'appId', 'rootUser',
  // 兼容语义等价键名（当前 schema 未用，若未来扩展可安全收纳）
  'host', 'website', 'appName',
])

/** 敏感语义词表（命中 key 或自定义字段 label 即视为机密，含中英文） */
const SENSITIVE_TERMS = [
  'password', 'pwd', 'pass', 'token', 'apikey', 'api_key', 'key',
  'secret', 'seed', 'otp', 'recovery', 'private', 'public', 'rootpwd',
  '密码', '口令', '密钥', '私钥', '公钥', '验证码', '授权码', '安全码',
  '恢复码', '助记词', '令牌', '口令卡',
]

/** 明显非敏感的自定义字段 label 词典（命中才允许缓存该项 value） */
const META_SAFE_LABEL_TERMS = [
  'email', '邮箱', 'mail', 'phone', '手机', '电话', 'mobile',
  'wechat', '微信', 'qq', '工号', 'staff', 'employee',
  'address', '地址', 'city', '城市', 'location',
  'url', 'link', '链接', 'website', '站点', 'site', '主页',
  'user', 'username', '用户名', 'account', '账号', '昵称', 'nickname', 'alias',
  'id', '编号', 'no', '名称', 'name',
]

/** 判断字段 key / label 是否命中敏感语义 */
function looksSensitive(text) {
  if (!text) return false
  const lower = String(text).toLowerCase()
  return SENSITIVE_TERMS.some(term => lower.includes(term))
}

/** 值级强敏感正则（用于检测自定义字段 value 是否含明文机密，短词误伤少） */
const VALUE_SENSITIVE_RE = /(pass(word|wd|phrase)|api[_-]?key|private\s*key|public\s*key|secret|recovery|seed|otp|totp|2fa|助记词|私钥|口令|令牌|验证码)/i

/**
 * 判断自定义字段 value 是否含明文机密
 * @param {string} value
 * @returns {boolean}
 */
function valueLooksSensitive(value) {
  if (!value) return false
  return VALUE_SENSITIVE_RE.test(String(value))
}

/**
 * 判断自定义字段 label 是否「明显非敏感」的元数据（决定 value 可否缓存）
 * @param {string} label
 * @returns {boolean}
 */
function looksMetaSafe(label) {
  if (!label) return false
  const lower = String(label).toLowerCase()
  return META_SAFE_LABEL_TERMS.some(term => lower.includes(term))
}

/**
 * 从全量草稿中提取「确定不含机密语义」的脱敏子集。
 * 约定：输出永远不含 notes / 敏感字段 / 语义未知自定义字段，
 * 即使调用方传入旧格式含明文的草稿，也只会产出安全骨架。
 * @param {Object} draft - 全量草稿
 * @returns {{v:number, ts:number, title:string, entryType:string, tags:Array, fields:Object, customFields:Array}}
 */
function toSafeSubset(draft) {
  const src = draft || {}
  const subset = {
    v: SCHEMA_VERSION,
    ts: Date.now(),
    title: typeof src.title === 'string' ? src.title : '',
    entryType: typeof src.entryType === 'string' ? src.entryType : '',
    tags: Array.isArray(src.tags) ? src.tags.filter(x => typeof x === 'string').slice(0, 200) : [],
    fields: {},
    customFields: [],
  }
  // fields：仅拷贝白名单内的元数据键，明文/未知键自然被剔除
  const srcFields = src.fields || {}
  for (const k of SAFE_FIELD_KEYS) {
    const v = srcFields[k]
    if (v !== undefined && v !== null) subset.fields[k] = String(v)
  }
  // customFields：sensitive 标记 / otp 类型 / label 命中敏感词 → 丢弃；
  // 仅 label 命中明确元数据词典的项允许连同 value 缓存，其余默认不缓存
  if (Array.isArray(src.customFields)) {
    for (const cf of src.customFields) {
      if (!cf || typeof cf !== 'object') continue
      if (cf.sensitive === true) continue
      if (cf.type === 'otp') continue
      const label = String(cf.label || '')
      if (looksSensitive(label)) continue
      if (!looksMetaSafe(label)) continue // 语义未知 → 默认不缓存
      subset.customFields.push({ id: cf.id, label, type: cf.type || 'text', value: String(cf.value ?? '') })
    }
  }
  return subset
}

/**
 * 入参若为「旧格式明文草稿」（含敏感键），判定其是否残留机密
 * @param {Object} obj - 解析后的存储对象
 * @returns {boolean} true=含明文敏感内容（应拒读并清理）
 */
function containsSensitivePayload(obj) {
  if (!obj || typeof obj !== 'object') return false
  if (looksSensitive(String(obj.title || ''))) return true
  const f = obj.fields
  if (f && typeof f === 'object') {
    for (const k of Object.keys(f)) {
      if (looksSensitive(k)) return true
    }
  }
  if (Array.isArray(obj.customFields)) {
    for (const cf of obj.customFields) {
      if (cf && looksSensitive(String(cf.label || ''))) return true
      if (cf && looksSensitive(String(cf.value || ''))) return true
    }
  }
  return false
}

/** draftKey（'new' | 'edit:<id>'）→ 脱敏 sessionStorage 键 */
function safeSessionKey(draftKey) {
  return SAFE_PREFIX + String(draftKey).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** 取消某草稿的待写防抖定时器 */
function cancelPending(draftKey) {
  const t = _pendingWrites.get(draftKey)
  if (t != null) {
    clearTimeout(t)
    _pendingWrites.delete(draftKey)
  }
  _pendingDrafts.delete(draftKey)
}

/** 立即把脱敏子集写入 sessionStorage（异常静默降级为仅内存） */
function commitSafeSubset(draftKey, draft) {
  try {
    const subset = toSafeSubset(draft)
    sessionStorage.setItem(safeSessionKey(draftKey), JSON.stringify(subset))
  } catch (e) { /* sessionStorage 不可用：保持仅内存 */ }
}

/**
 * 立即落盘全部待写脱敏子集（页面刷新 / 跳转 / 关闭前兜底）。
 * 只写最近一次 saveDraft 的脱敏内容，绝不写敏感明文；
 * 已由 clearDraft / clearAllDrafts 作废的草稿不在此表内，天然跳过。
 */
export function flushDrafts() {
  if (!_pendingWrites.size && !_pendingDrafts.size) return
  const keys = Array.from(_pendingWrites.keys())
  keys.forEach((key) => {
    const timer = _pendingWrites.get(key)
    if (timer != null) clearTimeout(timer)
    _pendingWrites.delete(key)
    const draft = _pendingDrafts.get(key)
    if (draft != null) {
      _pendingDrafts.delete(key)
      commitSafeSubset(key, draft)
    }
  })
  _pendingDrafts.clear()
}

/* 页面隐藏 / 刷新前兜底：把防抖窗口中未落盘的最新脱敏骨架立即补齐，
   满足「刷新 / 跳转不得丢草稿（非敏感骨架）」的语义。
   锁定 / 登出时 clearAllDrafts 已取消防抖待写，此兜底不会误写明文。 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  try {
    window.addEventListener('pagehide', flushDrafts)
    window.addEventListener('beforeunload', flushDrafts)
  } catch (e) { /* 忽略：无兜底时仍按原防抖落盘 */ }
}

/**
 * 判断草稿是否「无实质内容」（等于空白表单，不值得弹提示打扰）。
 * 仅含 entryType 等骨架信息或全空字段视为空草稿。
 * @param {Object|null} draft
 * @returns {boolean}
 */
export function isEmptyDraft(draft) {
  if (!draft || typeof draft !== 'object') return true
  if (String(draft.title || '').trim()) return false
  const f = draft.fields
  if (f && typeof f === 'object') {
    for (const k of Object.keys(f)) {
      if (String(f[k] ?? '').trim()) return false
    }
  }
  if (Array.isArray(draft.tags) && draft.tags.length) return false
  if (draft.notes && String(draft.notes).trim()) return false
  if (Array.isArray(draft.customFields) && draft.customFields.length) return false
  return true
}

/**
 * 草稿与「当前表单/已保存内容」在可比范围内是否完全一致。
 * 只比较草稿实际携带的字段（sessionStorage 脱敏子集会缺少 notes /
 * 敏感字段 / 敏感自定义项，缺省项视为不可比、不判差异），用于：
 *   • 编辑模式：草稿与已保存内容一致时不打扰用户；
 *   • 打开新建：草稿实质等于当前装载内容时静默跳过恢复。
 * @param {Object|null} draft
 * @param {{title:string, entryType:string, fields?:Object, tags?:Array, notes?:string, customFields?:Array}} form
 * @returns {boolean}
 */
export function draftsEqual(draft, form) {
  if (!draft || !form || typeof draft !== 'object') return false
  const norm = (v) => String(v ?? '')
  if (norm(draft.title) !== norm(form.title)) return false
  if (draft.entryType && norm(draft.entryType) !== norm(form.entryType)) return false
  const df = draft.fields && typeof draft.fields === 'object' ? draft.fields : {}
  const ff = form.fields && typeof form.fields === 'object' ? form.fields : {}
  for (const k of Object.keys(df)) {
    if (norm(df[k]) !== norm(ff[k])) return false
  }
  const dt = Array.isArray(draft.tags) ? draft.tags.slice().sort() : []
  const ft = Array.isArray(form.tags) ? form.tags.slice().sort() : []
  if (dt.length !== ft.length) return false
  for (let i = 0; i < dt.length; i++) if (dt[i] !== ft[i]) return false
  if (draft.notes !== undefined && draft.notes !== null && norm(draft.notes) !== norm(form.notes)) return false
  const dc = Array.isArray(draft.customFields) ? draft.customFields : []
  const fc = Array.isArray(form.customFields) ? form.customFields : []
  const fById = new Map(fc.map((cf) => [String(cf.id), cf]))
  for (const cf of dc) {
    if (!cf || typeof cf !== 'object') continue
    const old = fById.get(String(cf.id))
    if (!old) return false
    if (norm(cf.label) !== norm(old.label)) return false
    if ((cf.type || 'text') !== (old.type || 'text')) return false
    if (norm(cf.value) !== norm(old.value)) return false
  }
  return true
}

/**
 * 当前是否存在内存全量草稿（同会话内写入）。
 * 组件恢复时可据此区分「内存全量（可整组替换）」与
 * 「sessionStorage 脱敏子集（仅安全骨架，需按 id 合并避免破坏敏感项）」。
 * @param {string} key - 草稿键
 * @returns {boolean}
 */
export function hasInMemoryDraft(key) {
  return _drafts.has(key)
}

/**
 * 读取草稿（快照拷贝，避免组件意外改写缓存对象）
 * 优先读内存全量明文；内存 miss（刷新/新会话）时回退读取
 * sessionStorage 脱敏子集。任何旧格式/含敏感载荷的残留一律拒读。
 * @param {string} key - 草稿键
 * @returns {Object|null}
 */
export function loadDraft(key) {
  const d = _drafts.get(key)
  if (d) {
    try { return JSON.parse(JSON.stringify(d)) } catch (e) { return null }
  }
  // 内存 miss：仅允许从脱敏子集恢复（键空间与旧明文 lockpass_draft_* 隔离）
  try {
    const raw = sessionStorage.getItem(safeSessionKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // 旧版误写 / 含敏感键载荷：拒绝恢复并清除，避免从旧格式恢复出敏感明文
    if (parsed.v !== SCHEMA_VERSION || containsSensitivePayload(parsed)) {
      sessionStorage.removeItem(safeSessionKey(key))
      return null
    }
    const subset = {
      title: parsed.title,
      entryType: parsed.entryType,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice() : [],
      fields: parsed.fields && typeof parsed.fields === 'object' ? { ...parsed.fields } : {},
      customFields: Array.isArray(parsed.customFields) ? parsed.customFields.map(cf => ({ ...cf })) : [],
    }
    return subset
  } catch (e) {
    return null
  }
}

/**
 * 写入草稿：内存全量明文 + 防抖调度脱敏子集落 sessionStorage
 * @param {string} key - 草稿键
 * @param {Object} draft - 全量草稿（含 title/entryType/fields/tags/customFields）
 */
export function saveDraft(key, draft) {
  try { _drafts.set(key, JSON.parse(JSON.stringify(draft))) } catch (e) { /* 忽略异常值 */ }
  // 非敏感子集写 storage 加防抖，避免高频输入反复写 sessionStorage
  cancelPending(key)
  _pendingDrafts.set(key, draft)
  const timer = setTimeout(() => {
    _pendingWrites.delete(key)
    _pendingDrafts.delete(key)
    commitSafeSubset(key, draft)
  }, STORAGE_DEBOUNCE_MS)
  _pendingWrites.set(key, timer)
}

/**
 * 删除单条草稿：内存 + 该 key 的脱敏 storage 一并清理（作废/保存成功）
 * @param {string} key - 草稿键
 */
export function clearDraft(key) {
  cancelPending(key)
  _drafts.delete(key)
  try { sessionStorage.removeItem(safeSessionKey(key)) } catch (e) { /* 忽略 */ }
}
/**
 * 清空全部内存草稿 + 取消防抖待写（锁定 / 退出登录时调用）。
 * 只清内存中的全量明文（含敏感字段即刻消失）；已落盘的脱敏子集
 * 不含机密语义，保留以便下次解锁后恢复表单骨架。
 */
export function clearAllDrafts() {
  _pendingWrites.forEach(t => clearTimeout(t))
  _pendingWrites.clear()
  _pendingDrafts.clear()
  _drafts.clear()
}
