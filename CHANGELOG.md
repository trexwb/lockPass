# Changelog

本文件记录 LockPass 各版本的变更内容。版本号遵循语义化版本（Semantic Versioning）。

## v1.0.29 (2026-08-29)

> 复制成功反馈重构：统一为右下角倒计时胶囊组件。v1.0.26 ~ v1.0.28 为本功能多轮构建的迭代中间版本，无独立发布内容，统一收敛至 v1.0.29。

### 复制反馈改进

- **新增 `CopyCountdownPill.vue` 倒计时胶囊组件**：合并原「Toast + 浮动提示」双路反馈为单一胶囊，由 `vaultState.clipboardCountdown` 响应式状态驱动，彻底移除 `useVault.js` 中 `createElement` / `appendChild` / `innerHTML` 跨层 DOM 操控
- **右下角定位**（桌面 >480px）：`right/bottom: 24px + 安全区`，符合密码管理器惯例，不遮挡中央内容；移动端 ≤480px 改为底部全宽
- **底边进度条**：宽度 100% → 0% 每秒递减，颜色随紧迫度渐变（绿 → ≤10s 琥珀 → ≤5s 红）
- **倒计时秒数着色**：`tabular-nums` 等宽数字 + 随紧迫度变色，直观感知剩余时间
- **手动关闭 + 自动消失**：× 按钮可提前关闭，剪贴板清除后自动淡出
- **Teleport 到 body**：脱离 `#app-shell` 的 `overflow:hidden`，`position:fixed` 稳定相对视口
- **入场动画 `pill-pop-in`**：上移 + 缩放 + 成功色辉光扩散，成功反馈更有质感
- 保留：卡片复制按钮高亮 `.copied` + 屏幕阅读器 `srAnnounce`；新增 `--z-float-tip: 350`（盖 toast 300、低于 confirm 400）
- 清理：移除旧版 `.copy-float-tip` 全部样式（约 120 行）及 `DetailPanel.vue` 的 `#clipboard-note` DOM、`entries.css` 的 `.clipboard-note` 样式

## v1.0.25 (2026-08-29)

> 设计审计修复：可访问性 / UX / 视觉一致性 / 功能增强，覆盖 P0-P3 共 18 项。

### 可访问性修复（P0）

- **颜色对比度修复**：`--text-faint` 暗色 `#484f58`→`#797f8b`、浅色 `#8c959f`→`#6e7681`，达到 WCAG AA 对比度标准
- **ModalBase ARIA 完整**：新增 `ariaLabel` prop + `ariaLabelledBy` ref，`onMounted` 自动查找标题元素赋 id，模板加 `role="dialog" aria-modal="true" :aria-labelledby`
- **修改密码弹窗密码可见性切换**：新增旧密码 / 新密码 / 确认密码三个独立切换按钮（眼睛图标），顶部新增不可撤销警告框（`role="alert"`）
- **条目卡片键盘可达**：卡片 `tabindex="0"` + `role="button"`，支持 Enter / Space 触发

### 操作流程改进（P1）

- **设置模态框标签页导航**：将单一长列表重构为 6 个标签页（安全 / 外观 / 同步 / 数据 / 扩展 / 关于），`role="tablist"` 语义化标签栏
- **编辑器关闭未保存警告**：添加 `snapshotForm()` + `hasUnsavedChanges()` 检测，关闭时有修改则弹确认弹窗（"放弃修改" / "继续编辑"）
- **编辑器表单校验**：添加 `validateForm()` 函数，校验标题非空、URL 格式（http(s):// 或裸域名 / IP）、端口 1-65535、邮箱格式
- **AppShell Shift+F10 键盘触发右键菜单**：扩展 `onCardKeydown` 支持 Shift+F10 和 ContextMenu 键
- **搜索框清除按钮**：添加 X 图标清除按钮，Escape 键先清空再失焦
- **CSV 导入列头校验**：缺 `title` / `password` 列时报错并中止，检测未知列名显示警告

### 用户体验改进（P2）

- **软删除撤销**：`softDelete()` 移除前置 confirm，直接删除后 showToast 带"撤销"按钮（5 秒有效）
- **复制反馈 aria-live**：`vaultState.srAnnounce` + `role="status" aria-live="polite"` 屏幕阅读器播报
- **Toast 扩展 action 按钮**：`showToast()` 第三参数支持 `options.action`（label + callback）

### 视觉一致性（P2）

- **图标按钮尺寸修正**：`.btn-icon.btn-icon-sm` 24px→28px，`.btn-icon.btn-icon-xs` 26px→24px（xs 应比 sm 小）
- **新增 `--radius-xs: 4px` 令牌**：批量替换硬编码 `border-radius`（4px→xs / 6px→sm / 8px→sm / 10px→md / 12px→lg）
- **硬编码 `#fff` 改令牌**：`modal.css` copy-float-tip、`layout.css` tabbar badge 改 `var(--text-on-accent)`

### 功能增强（P3）

- **浅色主题微调**：`--bg-tertiary` / `--bg-hover` / `--border` / `--accent-dim` / `--accent-glow` 对比度优化
- **导出按标签筛选**：ExportModal 添加标签筛选下拉框，导出时仅包含选中标签的条目
- **标签合并功能**：TagsModal 新增合并视图，选择源标签和目标标签，遍历条目替换标签（去重）后删除源标签

## v1.0.24 (2026-08-30)

> 复审遗留 P3 项收口（用户确认「全部处理」）+ 公钥复制语义修复。

### 正确性修复

- **应用类型「公钥」行复制语义**：行内复制按钮此前走 `copyPassword()` 的 app 特例（取 App ID），复制到的是 App ID 而非公钥；改 `copy-mode="value"` 行内直接复制公钥（footer 主按钮保持 App ID 语义不变）

### 键盘分发统一（P3-2）

- **ModalBase 只管焦点陷阱**：Escape 关闭从模态框自身监听改为统一由 `useShortcuts.handleKeyboard` 分发（confirm → modal → detail → 清空搜索），消除双重监听导致的语义分叉；移除无使用方的 `closeOnEsc` prop

### 安全加固（P3-9）

- **解锁失败指数退避**：会话内连续失败 ≥5 次进入冷却，1s 起、每次翻倍、封顶 30s；冷却期提交按钮禁用并显示剩余秒数，错误提示同步显示倒计时。仅解锁模式计数（创建模式无既存保险箱可暴力破解），解锁成功/恢复流程切换时复位

### 性能（P3-5）

- **条目列表虚拟滚动**：条目数 >100 时窗口化渲染（可视区 ±6 行缓冲，上下 spacer 撑高，行高实测校准 + resize 重校准），≤100 条时行为与原来完全一致；筛选/搜索切换回滚顶部。长期解决大密码库（数百条以上）的渲染卡顿

### 代码规范收敛（P3-4 / P3-11 / P3-12）

- **SVG 双体系收敛（P3-4）**：SvgIcons 补 `lock/upload/folder/alert/grid/tag` 六个图标；组件内与图标库重复的内联 SVG 全部替换（右键菜单 5 个、移动端 tabbar 4 个、8 个模态关闭按钮、字段行 eye/copy、锁屏 5 处）。仅保留一次性插画（36px stroke-1.5）与 FAB 2.5 描边加号两类特殊内联
- **浮动「已复制」提示样式迁样式表（P3-11）**：useVault 中 14 项 JS 内联样式收敛为 `modal.css` 的 `.copy-float-tip` 类（新增 `--z-float-tip` 层级令牌），JS 只负责定位
- **i18n 基础设施（P3-12）**：新增 `src/core/i18n.js`（window.I18n，zh-CN 语言包 + `t()` 占位符支持）；锁屏 AuthView 全量文案试点迁移。约定：新 UI 文案禁止硬编码，存量按页面渐进迁移（已写入 AGENTS.md）

## v1.0.23 (2026-08-29)

> 基于前端开发规范的多维度复审（功能设计 / 操作流程 / 用户体验 / 响应式专项），产出报告 docs/audit-2026-08-29-响应式与体验复审.md。

### 响应式 / 移动端

- **右键快捷菜单触屏可达**：iOS Safari 不派发 `contextmenu`，新增长按 500ms 呼出（touchstart 计时，touchmove/touchend/touchcancel 取消，滚动即中止）；触屏下条目卡片 `user-select: none`，长按不再触发系统文字选择/放大镜
- **右键菜单对齐 44px 触控规范**：`(hover:none) and (pointer:coarse)` 下 `.ctx-item` 加大至 ≥44px 高、菜单加宽至 180px、补 `:active` 按压反馈
- **补 `--text-secondary` 设计令牌**（深 `#b6c2cf` / 浅 `#444c56`）：此前 5 处引用该未定义变量（回收站标题、类型徽章、编辑器副标题等），颜色静默回退为继承色，弱化层级失效

### 正确性修复

- **`.btn-dropdown-menu` 硬编码白色改令牌**：边框 `rgba(255,255,255,0.14)` / 按钮 `rgba(255,255,255,0.04/0.07)` 在浅色主题下几乎不可见，改 `var(--border)` / `var(--border-dim)`（与上轮 P2-8 同类问题）
- **详情面板标签 chip 颜色注入补白名单**：`tagStyle()` 的 `--chip-color` 改走 `Utils.safeTagColor()`，对齐 P3-6 安全链路（`safeTagColor` 导出至 `window.Utils`）
- `.entry-date` 重复 `font-size` 声明去除死代码；`.ctx-item` 字号 `13px` → `0.93rem`

### 可访问性 / 重构

- 汉堡按钮、移动端底部导航「标签」按钮补 `aria-expanded` 状态
- `empty-active` 类从 `watch` + `getElementById` 手动 DOM 操作改为模板 `:class` 绑定（消除 Vue 反模式）

## v1.0.22 (2026-08-29)

> 依据 2026-08-29 功能设计多维度深度评审报告（docs/audit-2026-08-29-功能设计多维度深度评审.md）完成的修复版本：P1 ×2 + P2 ×12 + P3 低成本项。

### 安全修复（P1）

- **锁定/退出登录清空密码历史快照**：`vaultState.history` 含修改前的明文密码 / root 密码 / 私钥，此前锁定后继续驻留内存。`lockVault()` / `logout()` 现补 `vaultState.history = {}`
- **锁定/退出登录清除编辑器草稿**：草稿（sessionStorage `lockpass_draft_*`）含明文密码，此前仅保存成功时清除，中途锁定后仍残留。新增 `clearEditorDrafts()` 在锁定/退出时遍历清除

### 新功能

- **条目卡片右键快捷菜单**（兑现 spec §3.8 承诺）：编辑 / 复制密码 / 收藏 / 删除；回收站视图为恢复 / 复制密码 / 彻底删除。Teleport 挂 body，位置视口钳制，点击/滚动/缩放自动关闭
- **列表键盘导航**：`↑` / `↓` 在列表中上下移动选中条目并滚动到可见（非输入态）；条目卡片、侧边栏导航项可 Tab 聚焦，`Enter` / `Space` 触发（原先主界面键盘不可达，设置按钮还被 `tabindex="-1"` 移出 tab 序）

### 正确性修复（P2）

- **编辑已删除条目不再静默丢数据**：`saveEntry()` 在条目已被移入回收站时此前不写入但仍弹「已保存」；现提示「条目已被删除」并保持编辑器打开以便复制内容
- **编辑器复制按钮走统一剪贴板安全链路**：此前裸 `navigator.clipboard.writeText` 无反馈、不启动 30 秒自动清除；现复用 `useVault.copyToClipboard`
- **AI 类型删除死字段 `organization`**：定义于 TYPE_FIELD_KEYS 但模板从未渲染，切换类型时被静默清除

### 可访问性改进（P2）

- 图标按钮统一 `aria-label`（AppShell 卡片操作 / DetailPanel / EntryEditor 眼睛与复制按钮）
- `navigator.platform`（已废弃）迁移至 `navigator.userAgentData` + platform 兜底

### UI / 重构

- **DetailPanel 组件化重构**：抽取 `FieldRow.vue` / `SecretFieldRow.vue`，消除六类型字段块约 10 处眼睛/复制/SVG 复制粘贴
- **详情面板动画响应式化**：`selectEntry()` 不再直接操作 DOM class，改 `vaultState.detailAnim` 状态驱动，消除与 Vue 重渲染的类覆盖竞态
- **cmd-field 硬编码色改设计令牌**：`rgba(255,255,255,.15)` → `var(--border-dim)`，浅色主题下虚线边框恢复可见；新增 `--warning-border` 令牌
- **创建模式「主密码无法找回」警示**：对齐 spec §5.3 风险表与密码管理器行业惯例
- **标签颜色白名单校验**：`renderTagChip` / `getCategoryIcon` 注入前校验 `#RGB` / `#RRGGBB`，防导入恶意 vault 的 CSS 注入

### 其他

- 模板函数改 computed（contentTitle / sshCommand / mysqlCommand / renderNotes）；创建模式防自动填充改清 ref（v-model 真源）；类型图标 title 显示中文名；空态按钮统一走 `openEntryModal()`；备注 textarea 加 `maxlength="256"` 对齐 spec
- **spec.md 回写**：扩展字段表对齐 url/password 模型、章节编号去重（3.18 设置 / 3.19 自动更新 / 3.20 快捷键）、快捷键表对齐实际 28 键

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
