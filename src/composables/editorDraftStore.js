/* ═══════════════════════════════════════════════════════════════════
   LockPass — 编辑器草稿内存存储（S1 审计修复）
   ───────────────────────────────────────────────────────────────────
   背景：旧实现把含明文（password/privateKey/rootPwd 等）的完整表单
   对象 JSON.stringify 后实时写入 sessionStorage —— 明文持久化面过大。
   修复：草稿改为纯内存驻留（本模块 Map），刷新页面即失、不落任何
   持久化存储。由以下路径主动清理，保证明文驻留时间最短：
     • 编辑器保存成功（EntryEditorModal onSave → clearDraft）
     • 编辑器关闭并确认放弃（handleClose → clearDraft）
     • 右键菜单「清空当前编辑草稿」（clear-draft）
     • 锁定 / 退出登录（useVault.lockVault / logout → clearEditorDrafts
       → clearAllDrafts）
   内存写不涉及磁盘安全面，因此无需节流/防抖；如未来需跨刷新恢复
   草稿，必须走独立加密通道或受控数据目录，严禁把明文 JSON 直接
   写回 sessionStorage / localStorage 等持久化媒介。
   ═══════════════════════════════════════════════════════════════════ */

const _drafts = new Map()

/**
 * 读取草稿（返回快照，避免组件意外改写缓存对象）
 * @param {string} key - 草稿键
 * @returns {Object|null}
 */
export function loadDraft(key) {
  const d = _drafts.get(key)
  if (!d) return null
  try { return JSON.parse(JSON.stringify(d)) } catch (e) { return null }
}

/**
 * 写入草稿（内存驻留；写入时展开快照，避免与响应式代理纠缠）
 * @param {string} key - 草稿键
 * @param {Object} draft - 草稿对象（含 title/entryType/fields/tags/notes/customFields）
 */
export function saveDraft(key, draft) {
  try { _drafts.set(key, JSON.parse(JSON.stringify(draft))) } catch (e) { /* 忽略异常值 */ }
}

/**
 * 删除单条草稿
 * @param {string} key - 草稿键
 */
export function clearDraft(key) {
  _drafts.delete(key)
}

/**
 * 清空全部草稿（锁定 / 退出登录时调用，作为安全边界兜底）
 */
export function clearAllDrafts() {
  _drafts.clear()
}
