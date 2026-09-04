# LockPass 版本日志 · v1.0

> 全新起点：项目版本号整体重置为 v1.0.0，重新生成更新签名密钥对，从 v1.0.0 重新发布。
>
> 本文件记录 LockPass 每个次版本（v1.0.x）的发布日志，最新在前。

---

## v1.0.5 (2026-09-04) 📝 待发布

### 修复

- **修复桌面端（Tauri）打开后样式全部失效**（浏览器端正常）：vite `^5.4.2 → ^8.2.2` 升级后默认打包内核换为 rolldown，在 `output.format: 'iife'` 下不再产出外置 CSS——构建静默成功，但 `dist/assets/css/` 缺失、`index.html` 无 `<link rel="stylesheet">`，CSS 体积被并入 `index.js` 且未挂载，导致界面以无样式状态渲染（内容堆叠、双向滚动条、白底黑字）。新增 `build.cssCodeSplit: false` 强制 CSS 以独立资源产出，vite 8.2.2 实测恢复 `assets/css/style.css` + stylesheet link 注入。与启动屏图标（雪碧图）改动无关，仅因当日重新打包首次暴露
- 修复桌面端窗口右侧滚动条：锁屏容器 `#lock-screen` 改为 `position: fixed + inset: 0` 脱离文档流，卡片超高时改为 `.lock-box` 内部滚动，不再把内容高度冒泡到 body 产生整页滚动条

### 改进

- 启动屏退场零残留：Vue 挂载淡出后同步移除 `#splash` DOM 节点与 head 内联样式 `#splash-style`（含全部 @keyframes / 媒体查询），避免残留样式影响主界面
- PWA `manifest.json` 背景色 `#0f172a → #0d1524`，与启动屏渐变起始色对齐

---

## v1.0.4 (2026-09-04) 📝 待发布

### 修复

- 修复 PWA「添加到主屏幕后点击长时间白屏」：Service Worker 导航请求由「网络优先」改为「缓存优先 + 后台刷新（stale-while-revalidate）」，弱网下不再等待网络超时导致白屏
- install 阶段预缓存 `assets/js/index.js`（主逻辑 JS），消除冷启动重新下载主逻辑导致的首屏等待
- 修复启动屏「网络好时瞬间消失」：`#splash` 由 `#app` 内部移到 `<body>`（脱离 Vue mount 替换范围），挂载完成后按「从导航开始至少停留 1s」再淡出（`transition: opacity .4s`），替代原先的瞬间消失

### 新增

- 启动屏 Splash Screen：内联于 `index.html` 的纯 HTML+CSS 加载画面，在 Vue/JS/CSS 加载前立即渲染，替代白屏等待

### 改进

- 启动屏图标：由手绘保险箱内联 SVG 替换为 `SvgIcons.shield` 盾牌线性图标（Lucide 风格 24×24），与项目统一图标体系一致
- 启动屏背景：新增 `#splash::before` 流动氛围光层（蓝 + 青两层 radial-gradient，`splash-aurora` 缓慢漂移），替换原先静态渐变
- 盾牌图标配圆形青绿光晕（`splash-glow` 呼吸）+ `drop-shadow` 柔光；`prefers-reduced-motion` 下全部动画降级
- 品牌图标统一：`favicon.svg` 由保险箱改为白色盾牌（保留青绿渐变方块底），与启动屏、`SvgIcons.shield` 视觉一致

---

## v1.0.3 (2026-09-03) 📝 待发布

### 修复

- 修复移动端 `BaseSelect` 下拉「点击后不显示」：`--z-dropdown` 由 `300` 提升至 `305`，高于移动端遮罩层级（301）
- 修复触屏设备条目卡片 hover 导致选中态上边框缺失：触屏设备取消 `.entry-card:hover` 上浮/阴影

### 新增

- 新增 Wiki 文档与常见问题解答

---

## v1.0.2 (2026-09-02) 📝 待发布

### 修复

- 修复下拉选择菜单被下方内容遮挡的问题：`BaseSelect` 菜单改为 Teleport 到 `<body>` 并以 fixed 定位（与 CtxMenu 同款策略），脱离弹窗、滚动容器等祖先的 overflow / transform 层叠影响；覆盖设置页全部下拉、条目编辑器自定义字段等所有使用处
  - 菜单按触发器视口坐标定位，向下/向上自适应展开，高度与横向按视口边界钳制
  - 监听 scroll / resize（rAF 节流）实时重定位，滚动容器内菜单跟随不漂移
- `SidebarNav` 侧边栏下拉菜单同款 Teleport + fixed 处理，脱离侧栏 `overflow` 裁切与遮挡
- 修复本地打包报 `A public key has been found, but no private key`：`scripts/with-updater-key.mjs` 补上 `~` 前缀展开（与 fastenerTradeWorkbench 同款实现）——Node 的 `existsSync` 不解析波浪号，`.env.local` 中 `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/...` 此前永远命中失败并被静默跳过
- 兜底分支改为注入内联 `TAURI_SIGNING_PRIVATE_KEY`：原实现设置 `TAURI_SIGNING_PRIVATE_KEY_PATH`，而打包签名只认内联变量（值可为私钥内容或文件路径），不读取 `_PATH` 变量，原兜底等同无效
- `TAURI_SIGNING_PRIVATE_KEY_PATH` 指向的文件缺失时显式告警；未找到任何私钥时打印正确变量名与用法指引

---

## v1.0.1 (2026-09-02) 📝 待发布

### 修复

- 修复生物识别解锁按钮引用不存在的 `SvgIcons.shield` 图标方法，导致 macOS 桌面已启用生物识别时锁屏渲染崩溃（在 `SvgIcons` 补齐 `shield` 方法）
- 移除 `AuthView` 冗余的 `bioBusy` 忙碌锁，统一走 `vaultState.lockBusy`（`handleBiometricUnlock` 内部已置位/复位）

### 重构

- 抽出 `usePasskey` composable，统一生物识别解锁（Passkey）的状态查询与平台判定：消除 `AuthView` 与 `SettingsModal` 重复的 status 查询逻辑，平台判定统一到 `window.LockPasskey.isDesktopMac`

---

## v1.0.0 (2026-09-02) 📝 待发布

### 初始发布

- 纯前端离线密码管理器：Vue 3 + Vite 构建，无后端服务器，浏览器版双击 `dist/index.html` 即用
- 多端支持：Tauri v2 桌面版（Windows / macOS）+ GitHub Pages 在线版
- 端到端加密：AES-256-GCM 加密 + PBKDF2 密钥派生（OWASP 2023 推荐迭代次数），数据整体加密存储
- 双存储后端：浏览器 IndexedDB / Tauri 文件存储（同接口透明替换）
- 六种条目类型与类型化字段（登录 / 信用卡 / 身份 / 安全笔记 / 数据库 / AI 密钥）
- 带颜色和图标的标签体系、回收站（软删除 / 恢复 / 彻底删除）
- 关联密码（同 IP / 根域名 / 账号自动关联）
- 密码生成器与密码强度评估、剪贴板 30 秒自动清除
- 二维码同步（分享 + 移动端扫码 / 上传 / 拍照导入）
- CSV / .vault 加密导入导出
- 中英文双语界面（i18n）
- 暗色主题优先，响应式适配（Pad / Phone）
- 自动更新（Tauri updater，minisign 签名校验）
