# AGENTS.md - LockPass 项目开发规范

> 所有 AI Agent 在本项目中开发时必须遵循本文件规范。

---

## 项目概述

**LockPass** 是一款纯前端离线密码管理器，Vue 3 + Vite 构建，无后端服务器。浏览器版双击 `dist/index.html` 即用，另有 Tauri v2 桌面版（Windows / macOS）与 GitHub Pages 在线版。

**核心原则**：安全 → 简洁 → 离线优先

**当前版本**：`v1.1.12`

---

## 版本管理规范

> ⚠️ **用户硬性约束（最高优先级，覆盖下方默认规则）**
> - `v1.x` 的 **MAJOR / MINOR 由用户决定**，AI 不得擅自提升（如私自从 v1.0.0 升到 v1.1.0 属违规）。
> - AI 只允许在 **`v1.0.x` 的最后一位（PATCH）自增**：`v1.0.0` → `v1.0.1` → `v1.0.2` …
> - **禁止任何 agent 执行 Git 提交类操作（`git add` / `git commit` / `git push` / `git tag` 等）**：所有改动留在工作树，由用户本人决定是否提交。

### 版本号格式

遵循语义化版本号（Semantic Versioning）：`vMAJOR.MINOR.PATCH`

- **MAJOR（主版本号）**：不兼容的 API 修改、重大架构变更
- **MINOR（次版本号）**：向后兼容的功能新增
- **PATCH（修订号）**：向后兼容的问题修复、小改进

### 版本更新规则

**每次修改代码必须更新版本号：**

| 修改类型 | 版本号变化 | 示例 |
|----------|-----------|------|
| Bug 修复、样式调整、小改进 | PATCH +1 | `v1.0.0` → `v1.0.1` |
| 新增功能、功能增强 | MINOR +1, PATCH 归零（需用户决定） | `v1.0.2` → `v1.1.0` |
| 重大变更、架构重构 | MAJOR +1, 其他归零（需用户决定） | `v1.5.3` → `v2.0.0` |
| 纯文档修改（README/spec/docs） | 不升版本号 | — |

### 版本号存储位置（单一来源）

**真源（仅此两处保存版本号，其余全部派生）**：
1. **`package.json`** - `version`（npm 标准源，构建期注入运行版本）
2. **`src-tauri/tauri.conf.json`** - `version`（Tauri 打包产物版本）

**构建期自动派生（源码不含版本号字面量）**：
- `src/core/version.js` - `APP_VERSION` ← vite define 注入 `__LOCKPASS_VERSION__`
- `vite.config.js` - `__APP_VERSION__` / `__LOCKPASS_VERSION__` ← 读取 package.json
- `src/public/sw.js` - `CACHE_NAME` ← 构建时由 vite 插件注入 `lockpass-vX.Y.Z`

**脚本/生态同步（不手改）**：
- `package-lock.json` - npm 生态同步 package.json
- `src-tauri/Cargo.toml` - `npm run version:set` 同步 tauri.conf.json
- `AGENTS.md` / `docs/spec.md` - 文档记录，`npm run version:set` 同步

> 升级版本号只需 `npm run version:set <x.y.z>`（改两个真源 + 同步派生物），
> 发布前用 `npm run version:check` 校验一致性（含注入模式防硬编码漂移）。

### 更新流程

每次代码修改完成后，Agent 必须：

1. 确定版本号增量类型（遵守上方 MAJOR/MINOR 用户硬性约束，仅 PATCH 自增）
2. 运行 `npm run version:set x.y.z` 统一更新版本号（运行时代码由构建自动注入，无需手改）
3. 运行 `npm run version:check` 确认全部一致
4. 在 `memory/YYYY-MM-DD.md` 中记录变更内容和版本号

---

## 开发规范

### 1. 架构分层（Vue 3）

```
┌─────────────────────────────────────────────────┐
│  components/  Vue SFC（layout/auth/entries/     │
│               modals/common）— 只负责 UI 与交互   │
├─────────────────────────────────────────────────┤
│  composables/ 响应式状态（useVault/useShortcuts）│
│               — 状态管理与业务编排                │
├─────────────────────────────────────────────────┤
│  core/       纯逻辑层（ES module，window.* 挂载）│
│               — 加密/存储/生成器/工具，零框架依赖  │
└─────────────────────────────────────────────────┘
```

- ✅ **核心逻辑**放 `src/core/`，保持 `window.*` 挂载（`window.CryptoUtils`、`window.DBUtils` 等），
  ES module 导入仅产生挂载副作用（见 `src/main.js` 顶部 import 列表）
- ✅ **状态与业务编排**放 `src/composables/`（ES module export，`ref`/`reactive` 响应式）
- ✅ **UI 组件**放 `src/components/`，Vue 3 `<script setup>` 语法
- ✅ **样式**放 `src/styles/`（按域拆分：base/layout/entries/editor/modal/settings/utilities/particles），
  组件内不写 `<style>` 块（保持样式集中管理）
- ✅ **静态资源**放 `src/public/`（sw.js / manifest.json / assets/vendor/*.js，原样拷贝到 dist 根）
- ✅ **新增功能模块**：纯逻辑 → `core/` 新文件 + main.js 注册；新状态 → composable；新界面 → 组件

### 2. 代码风格

- ✅ Vue 组件使用 Composition API（`<script setup>`），组合式函数命名 `use*`
- ✅ 函数必须有 JSDoc 注释，说明参数和返回值
- ✅ 变量命名语义化，禁止 `a`, `b`, `temp` 等无意义命名
- ✅ 常量使用全大写下划线，如 `DB_NAME`, `DEFAULT_CATEGORIES`
- ✅ 代码缩进 2 空格，不使用 tab
- ✅ 用户可见文案统一走 `I18n.t('模块.key')`（`src/core/i18n.js`，window.I18n）；
  新增 UI 文案禁止硬编码中文字符串；存量文案按页面渐进迁移（锁屏 AuthView 已试点）
- ✅ 图标统一走 `Utils.SvgIcons`（`src/core/utils.js`）；组件内不再新增内联 `<svg>` 重复图标，
  仅允许一次性插画（如 36px stroke-1.5 插图）与特殊视觉变体（如 FAB 2.5 描边加号）保留内联

### 3. 安全规范

- ✅ 所有用户输入必须转义，使用 `Utils.escHtml()` 防止 XSS（Vue 模板默认转义，v-html 必须显式 sanitize）
- ✅ 密码相关操作必须使用 Web Crypto API，不使用第三方库
- ✅ 敏感数据不在控制台打印，调试时必须移除 `console.log`
- ✅ 剪贴板操作必须设置自动清除，默认 30 秒
- ✅ 导出文件必须加密，CSV 导出必须警告用户
- ✅ 不引入外部 CDN / 远程字体 / 外部 API（离线优先）

### 4. UI/UX 规范

- ✅ 使用 CSS Variables 定义颜色和间距，不硬编码值（见 `src/styles/base.css` 的 `:root` 设计令牌）
- ✅ 暗色主题优先
- ✅ 交互必须有视觉反馈，如 hover、active、loading 状态
- ✅ 错误提示使用 Toast（`Utils.showToast`），不使用 `alert()`
- ✅ 确认操作使用 `Utils.confirm` 自定义确认弹窗，危险操作需二次确认
- ✅ 模态框统一走 `ModalBase` 组件（遮罩 + 焦点陷阱 + Esc 关闭）

### 5. 存储规范

- ✅ 使用 IndexedDB 存储所有数据（`src/core/database.js`），不使用 localStorage
- ✅ 加密数据存储在 `vault` ObjectStore（应用状态整体加密：entries/deleted/tagDefs）
- ✅ 元数据（盐值、迭代次数）存储在 `meta` ObjectStore
- ✅ 桌面版走 `src/core/file-store.js`（同接口透明替换 IndexedDB，DBUtils 调用方无感知）
- ✅ 每次数据变更必须调用 `App.saveVault()` / 对应持久化方法

### 6. 离线优先

- ✅ 禁止使用 CDN 链接，所有资源必须本地化（`src/public/assets/vendor/`）
- ✅ 禁止使用 Google Fonts 等外部字体，使用系统字体栈
- ✅ 禁止使用外部 API（可选联网功能必须默认关闭 + 设置开关）
- ✅ 测试时必须断网验证，确保完全离线可用

---

## 文件组织

### 目录结构

```
LockPass/
├── src/                   # 前端源码（唯一真源）
│   ├── index.html         # Vite 入口 HTML（仅结构）
│   ├── main.js            # Vue 入口：顺序导入 core 模块（window.* 挂载）+ 挂载 App
│   ├── App.vue            # 根组件：认证（创建/解锁/修改主密码）→ 主界面
│   ├── core/              # 核心逻辑层（ES module，window.* 挂载，零框架依赖）
│   │   ├── crypto.js      # AES-256-GCM 加密 / PBKDF2 派生（window.CryptoUtils）
│   │   ├── database.js    # IndexedDB 存储（window.DBUtils）
│   │   ├── file-store.js  # Tauri 文件存储（同接口替换 IndexedDB）
│   │   ├── file-sync.js   # 数据目录绑定 + 文件同步（window.FileSync）
│   │   ├── generator.js   # 密码生成器（window.PasswordGenerator）
│   │   ├── utils.js       # 工具函数 + SvgIcons（window.Utils / window.SvgIcons）
│   │   ├── i18n.js        # 文案语言包（window.I18n，zh-CN；新 UI 文案统一走 I18n.t）
│   │   ├── related.js     # 关联密码（window.RelatedEntries）
│   │   ├── import-bridge.js # CSV/.vault 导入解析（window.ImportExport）
│   │   ├── tauri-bridge.js  # Tauri 桥接（检测 __TAURI__，覆盖下载/剪贴板）
│   │   ├── sw-register.js   # Service Worker 注册 + controllerchange 自动刷新
│   │   ├── version.js       # 版本号（构建期注入）
│   │   └── particles.js     # 粒子背景动效（window.LockParticles）
│   ├── composables/       # 响应式状态
│   │   ├── useVault.js    # 主状态：vaultState / 认证 / 条目 CRUD / 标签 / 回收站
│   │   └── useShortcuts.js # 键盘快捷键
│   ├── components/        # Vue SFC 组件
│   │   ├── AppShell.vue / ModalHost.vue
│   │   ├── layout/        # SidebarNav / HeaderBar
│   │   ├── auth/          # AuthView（创建/解锁/修改主密码）
│   │   ├── entries/       # DetailPanel（详情面板）+ FieldRow / SecretFieldRow（字段行复用组件）
│   │   ├── modals/        # EntryEditor / Settings / Import / Export / Tags /
│   │   │                  # QrShare / QrImport / ChangePw
│   │   └── common/        # ModalBase
│   ├── styles/            # 设计令牌 + 按域拆分（base/layout/entries/editor/modal/settings/utilities/particles）
│   └── public/            # 静态资源（sw.js / manifest.json / assets/vendor/jsQR.js、qrcode.min.js）
├── src-tauri/             # Tauri v2 桌面封装（Rust 命令 + 图标 + 打包配置）
├── scripts/               # 构建辅助脚本（bump-version / check-version / gen-icons / make-dmg）
│                          # 注：copy-frontend.mjs 为 CI 兼容壳（内部 vite build）；serve.mjs 遗留未引用
├── dist/                  # 构建产物（vite build 生成，不手动修改）
├── docs/                  # 文档中心（spec / tauri / 迁移设计，见 docs/README.md）
├── memory/                # 工作记录（按日期 YYYY-MM-DD.md）
├── README.md              # 使用说明（仓库首页）
└── AGENTS.md              # 本文件（Agent 开发规范，约定置于根目录）
```

### 新增模块流程

1. **纯逻辑**：在 `src/core/` 创建新文件（ES module，末尾挂载 `window.ModuleName = { ... }`），
   在 `src/main.js` 顶部 import 顺序列表中加入
2. **状态**：在 `src/composables/` 创建 `useXxx.js`（ES module export）
3. **界面**：在 `src/components/` 对应子目录创建 SFC，由父组件引入
4. **样式**：在 `src/styles/` 对应文件添加（或新建按域文件）
5. 更新本文件的目录结构

---

## 函数命名约定

### 事件处理函数

- `handle*` - 事件处理器，如 `handleUnlock()`, `handleSearch()`
- `on*` - 事件监听器，如 `onVaultChange()`

### UI 渲染函数

- `render*` - 渲染 DOM，如 `renderSidebar()`, `renderEntries()`
- `show*` - 显示 UI 元素，如 `showLockScreen()`, `showApp()`
- `close*` - 关闭 UI 元素，如 `closeModal()`, `closeDetailPanel()`

### 数据操作函数

- `open*` - 打开/加载，如 `openDB()`, `openModal()`
- `save*` - 保存数据，如 `saveVault()`, `saveEntry()`
- `delete*` - 删除数据，如 `deleteEntry()`, `destroyVault()`
- `toggle*` - 切换状态，如 `toggleFavorite()`, `toggleGenPanel()`

### 工具函数

- `calc*` - 计算值，如 `calcStrength()`
- `format*` - 格式化数据，如 `formatDate()`
- `validate*` - 验证数据，如 `validatePassword()`

---

## Git 提交规范

> ⚠️ 用户硬性约束：**禁止任何 agent 执行 Git 提交类操作**（add/commit/push/tag 等），
> 改动只保留在工作树，是否提交由用户本人决定。

（以下格式仅供用户本人提交时参考）

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

- `feat` - 新功能
- `fix` - Bug 修复
- `refactor` - 重构（不新增功能，不修复 Bug）
- `style` - 样式调整（不影响逻辑）
- `docs` - 文档更新
- `test` - 测试相关
- `chore` - 构建/工具相关

---

## 测试检查清单

### 功能测试

- [ ] 首次创建保险箱
- [ ] 解锁/锁定保险箱（含自动锁定、刷新恢复会话）
- [ ] 添加/编辑/删除密码条目（6 种类型字段）
- [ ] 标签筛选 / 搜索 / 收藏 / 回收站（恢复/彻底删除/清空）
- [ ] 密码生成器
- [ ] 复制密码（自动清除）
- [ ] 关联密码展示与跳转
- [ ] 二维码分享 / 扫码 / 上传 / 拍照导入
- [ ] 导出 .vault / 导入 .vault（加密）/ 导入 CSV
- [ ] 修改主密码 / 销毁保险箱
- [ ] 文件同步（成功 / 失败反馈）

### 离线测试

1. 断开网络连接
2. 刷新页面
3. 解锁保险箱
4. 执行所有功能
5. 确认无网络请求错误

### 安全测试

- [ ] 主密码错误时无法解锁
- [ ] 导入加密文件需验证密码
- [ ] 剪贴板自动清除
- [ ] 自动锁定触发
- [ ] XSS 注入测试（标题、备注等字段）

### 构建验证

- [ ] `npm run vite:build` 通过，`dist/index.html` 双击可打开（file://）
- [ ] `npm run version:check` 版本一致
- [ ] 桌面版 `npm run tauri:build` 通过（如环境允许）

### 浏览器兼容性

- [ ] Chrome 60+
- [ ] Firefox 60+
- [ ] Safari 12+
- [ ] Edge 79+

---

## 常见问题

### Q: 如何添加新功能？

1. 阅读 `docs/spec.md` 了解产品规格与未来规划
2. 按「新增模块流程」在 `src/core/` 或 `src/composables/` / `src/components/` 落地
3. 更新 `src/styles/` 对应样式（如需要）
4. 测试所有功能（见测试检查清单）
5. 按版本规范运行 `npm run version:set`（新功能需用户确认 MINOR）
6. 更新 `README.md` 和 `docs/spec.md`

### Q: 如何调试？

1. 运行 `npm run dev` 打开 Vite dev server（http://localhost:1420）
2. 打开浏览器开发者工具（F12）
3. 查看 Console 中的错误信息
4. 使用 Sources 面板设置断点
5. 查看 Application > IndexedDB 查看数据

### Q: 如何重置数据？

1. 打开设置
2. 点击「销毁保险箱」
3. 刷新页面重新创建

### Q: 为什么用 Vue 3 而不是纯 Vanilla JS？

**离线优先仍是底线**：Vue 3 + Vite 构建产物为 iife 单 chunk（外置资源），file:// 双击可用，
不依赖 CDN 或构建期后的网络。Vue 3 迁移在保留「双击即用」的同时，为 TOTP、密码审计等
复杂功能迭代提供了组件化基础（详见 `docs/superpowers/specs/2026-08-23-vue3-migration-design.md`）。

---

## 禁止事项

- ❌ 禁止在代码中硬编码 API Key 或密码
- ❌ 禁止使用 `eval()`, `new Function()` 等危险函数
- ❌ 禁止在 HTML 中内联 JavaScript（事件绑定除外）
- ❌ 禁止使用 `localStorage` 存储敏感数据
- ❌ 禁止引入外部 CDN 链接
- ❌ 禁止在控制台打印敏感信息
- ❌ 禁止跳过用户确认直接执行危险操作
- ❌ 禁止擅自提升 v1.x 的 MAJOR / MINOR 版本号
- ❌ 禁止执行任何 Git 提交类操作（add/commit/push/tag）

---

## 更新日志

### 2026-08-25 文档对齐

- README / docs/spec.md / docs/tauri.md / 本文件更新至 Vue 3 + Vite 实际架构
- 修正过时描述：Vanilla JS 技术栈、js/ 目录结构、零打包器、copy-frontend 拷贝逻辑、CSP null
- 修正 `.github/workflows/pages.yml` 注释（单文件内联 → 外置资源产物）
- 纯文档修改，不升版本号

### v1.0.0 (2026-08-19)

- 重构：合并「分类」与「标签」为统一的「带颜色和图标的标签」
- 数据模型：移除 `categories` 与条目 `category` 字段；新增顶层 `tagDefs` 注册表
- 新增「回收站」功能：软删除 + 恢复 / 彻底删除 / 清空
- 新增「关联密码」功能：同 IP / 根域名 / 账号自动关联
- 新增 6 种条目类型（网站/服务器/数据库/AI/应用/其他）与类型化字段
- 二维码同步（分享 + 移动端扫码/上传/拍照导入）
- 系统 confirm 全部替换为自定义确认弹窗
- Vue 3 全量迁移（详见迁移设计文档）
- 自动锁屏调试、会话持久化、收藏/复制按钮统一、锁屏清理 sessionStorage

---

**所有 AI Agent 在本项目中开发时，必须先阅读并遵循本文件规范。**

如有疑问，请参考 `docs/spec.md` 和 `README.md`。
