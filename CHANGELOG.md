# Changelog

本文件记录 LockPass 各版本的变更内容。版本号遵循语义化版本（Semantic Versioning）。

## v1.0.20 (2026-08-28)

### 安全修复

- **[CRITICAL] 修复 macOS 剪贴板清除功能失效**：`tauri-bridge.js` 中 `lt.invoke` 变量名大小写错误（应为 `LT.invoke`），导致 macOS 上复制密码后自动清除功能完全失效，密码永久留在剪贴板中
- **[CRITICAL] 修复扩展桥 postMessage 使用通配 origin**：`ext-bridge.js` 中 `postMessage` 使用 `'*'` 作为 targetOrigin，任何页面脚本可截获会话令牌和明文密码。改为 `window.location.origin`
- **[CRITICAL] PBKDF2 迭代次数提升至 OWASP 2023 推荐**：新建保险箱的 PBKDF2 迭代次数从 100,000 提升至 600,000。旧保险箱保持原有迭代次数以兼容；修改主密码时自动升级到新标准
- **修改主密码时纳入密码历史**：`ChangePwModal.vue` 重新加密时遗漏了 `history` 字段，导致修改密码后密码历史无法解密。已将 `history` 加入加密 payload

### 正确性修复

- **编辑器切换类型时清理残留字段**：`EntryEditorModal.vue` 切换条目类型（如 server → website）时旧类型字段残留在 `reactive` 对象中，被持久化到加密 vault。已添加 watch 在类型切换时清除非当前类型的字段
- **密码显隐状态移出 entry 数据对象**：`showPassword` 直接挂在 entry 对象上，`saveVault` 触发时会被序列化进加密数据污染数据模型。改为独立的 `vaultState.showPasswordMap` 按 ID 管理

### 性能修复

- **修复 SettingsModal setInterval 内存泄漏**：每次打开设置弹窗创建 600ms 轮询定时器，关闭时不清理。已添加 `onBeforeUnmount` 清理
- **修复剪贴板倒计时 setInterval 累积**：连续复制密码时前一个倒计时 interval 未清除，多个定时器同时运行导致 UI 闪烁。已存储引用并在创建新定时器前清除旧的

### 可维护性改进

- **tauri-server-bridge.js 统一使用 const/let**：消除 var 声明，与 tauri-bridge.js 风格一致
- **生产构建移除 console.debug/console.log**：通过 vite esbuild `pure` 配置在构建时移除调试日志（保留 console.error / console.warn）

### 可访问性改进

- **DetailPanel 关联密码项支持键盘操作**：`div.related-item` 添加 `role="button"` / `tabindex="0"` / `@keydown.enter`
- **ModalBase 添加 aria-modal**：模态框容器添加 `role="dialog" aria-modal="true"` 属性
- **图标按钮添加 aria-label**：DetailPanel 中所有仅含图标的按钮（复制/显示/隐藏/收藏/关闭）均添加 `aria-label`

## v1.0.19

- 详见 AGENTS.md 更新日志

## v1.0.0 (2026-08-19)

- 重构：合并「分类」与「标签」为统一的「带颜色和图标的标签」
- 新增「回收站」功能：软删除 + 恢复 / 彻底删除 / 清空
- 新增「关联密码」功能：同 IP / 根域名 / 账号自动关联
- 新增 6 种条目类型与类型化字段
- 二维码同步（分享 + 移动端扫码/上传/拍照导入）
- Vue 3 全量迁移
