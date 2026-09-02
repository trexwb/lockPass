# Changelog

本文件记录 LockPass 各版本的变更内容。版本号遵循语义化版本（Semantic Versioning）。

## v1.0.2 (2026-09-02)

### 修复

- 修复下拉选择菜单被下方内容遮挡的问题：`BaseSelect` 菜单改为 Teleport 到 `<body>` 并以 fixed 定位（与 CtxMenu 同款策略），脱离弹窗、滚动容器等祖先的 overflow / transform 层叠影响；覆盖设置页全部下拉、条目编辑器自定义字段等所有使用处
  - 菜单按触发器视口坐标定位，向下/向上自适应展开，高度与横向按视口边界钳制
  - 监听 scroll / resize（rAF 节流）实时重定位，滚动容器内菜单跟随不漂移
- `SidebarNav` 侧边栏下拉菜单同款 Teleport + fixed 处理，脱离侧栏 `overflow` 裁切与遮挡
- 修复本地打包报 `A public key has been found, but no private key`：`scripts/with-updater-key.mjs` 补上 `~` 前缀展开（与 fastenerTradeWorkbench 同款实现）——Node 的 `existsSync` 不解析波浪号，`.env.local` 中 `TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/...` 此前永远命中失败并被静默跳过
- 兜底分支改为注入内联 `TAURI_SIGNING_PRIVATE_KEY`：原实现设置 `TAURI_SIGNING_PRIVATE_KEY_PATH`，而打包签名只认内联变量（值可为私钥内容或文件路径），不读取 `_PATH` 变量，原兜底等同无效
- `TAURI_SIGNING_PRIVATE_KEY_PATH` 指向的文件缺失时显式告警；未找到任何私钥时打印正确变量名与用法指引

## v1.0.1 (2026-09-02)

### 修复

- 修复生物识别解锁按钮引用不存在的 `SvgIcons.shield` 图标方法，导致 macOS 桌面已启用生物识别时锁屏渲染崩溃（在 `SvgIcons` 补齐 `shield` 方法）
- 移除 `AuthView` 冗余的 `bioBusy` 忙碌锁，统一走 `vaultState.lockBusy`（`handleBiometricUnlock` 内部已置位/复位）

### 重构

- 抽出 `usePasskey` composable，统一生物识别解锁（Passkey）的状态查询与平台判定：消除 `AuthView` 与 `SettingsModal` 重复的 status 查询逻辑，平台判定统一到 `window.LockPasskey.isDesktopMac`

## v1.0.0 (2026-09-02)

> 全新起点：版本号整体重置为 v1.0.0，重新生成更新签名密钥对，从 v1.0.0 重新发布。

### 核心能力

- 纯前端离线密码管理器：Vue 3 + Vite 构建，无后端服务器，浏览器版双击 `dist/index.html` 即用
- 多端支持：Tauri v2 桌面版（Windows / macOS）+ GitHub Pages 在线版
- 端到端加密：AES-256-GCM 加密 + PBKDF2 密钥派生（OWASP 2023 推荐迭代次数），数据整体加密存储
- 双存储后端：浏览器 IndexedDB / Tauri 文件存储（同接口透明替换）

### 主要功能

- 六种条目类型与类型化字段（登录 / 信用卡 / 身份 / 安全笔记 / 数据库 / AI 密钥）
- 带颜色和图标的标签体系
- 回收站（软删除 / 恢复 / 彻底删除）
- 关联密码（同 IP / 根域名 / 账号自动关联）
- 密码生成器与密码强度评估
- 剪贴板 30 秒自动清除
- 二维码同步（分享 + 移动端扫码 / 上传 / 拍照导入）
- CSV / .vault 加密导入导出
- 中英文双语界面（i18n）
- 暗色主题优先，响应式适配（Pad / Phone）
- 自动更新（Tauri updater，minisign 签名校验）
