# LockPass — 个人密码工作台

一款纯前端离线密码管理器，无需后端服务器，双击 `index.html` 即可在浏览器中使用。

---

## 功能清单

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 主密码验证 | [x] | 首次设置主密码，后续解锁需输入 |
| AES-256-GCM 加密 | [x] | Web Crypto API + PBKDF2（100000次迭代） |
| 密码增删改查 | [x] | 完整 CRUD 操作 |
| 分类管理 | [x] | 预设7个分类 + 自定义分类 |
| 标签系统 | [x] | 用逗号分隔的标签 |
| 收藏功能 | [x] | 一键收藏常用密码 |
| 全文搜索 | [x] | 按标题/用户名/URL/标签搜索 |
| 密码生成器 | [x] | 8-64位，可选字符集，实时强度计算 |
| 密码显示/隐藏 | [x] | 点击切换，默认掩码 |
| 一键复制 | [x] | 复制后自动清除剪贴板 |
| 导入/导出 | [x] | 加密 .vault 格式 + CSV 明文格式 |
| 自动锁定 | [x] | 无操作超时自动锁定 |
| 键盘快捷键 | [x] | ⌘ + K / ⌥ + N / ⌥ + L / ⌘ + , |
| IndexedDB 存储 | [x] | 浏览器本地持久化 |

---

## 快速开始

### 1. 打开应用

```bash
# 方式1：双击文件
双击 index.html

# 方式2：命令行打开
open index.html

# 方式3：拖拽到浏览器
将 index.html 拖拽到浏览器窗口
```

### 2. 创建密码库

首次打开会显示「创建密码保险箱」界面：

1. 输入主密码（8位以上，建议包含大小写字母、数字、符号）
2. 再次确认密码
3. 点击「确认创建」

> **注意：** 主密码是唯一解锁方式，忘记后将无法恢复数据！

### 3. 添加密码

- 点击左下角「添加密码」按钮
- 填写标题（必填）、用户名、密码（必填）、网址、分类、标签、备注
- 可使用密码生成器生成强密码
- 点击「保存」

### 4. 使用密码

- **查看详情**：点击密码条目
- **复制密码**：点击复制按钮，或打开详情面板后点击复制
- **显示/隐藏**：点击眼睛图标切换显示
- **编辑/删除**：在详情面板操作

---

## 安全机制

### 加密算法

```
主密码 → PBKDF2(SHA-256, 100000次迭代) → AES-256-GCM 密钥
数据   → AES-256-GCM 加密               → 密文存储到 IndexedDB
```

### 数据存储

| 数据 | 存储位置 | 加密状态 |
|------|----------|:--------:|
| 密码条目 | IndexedDB | 已加密 |
| 主密码 | 不存储 | — |
| 盐值 (Salt) | IndexedDB | 明文 |
| 分类列表 | IndexedDB | 加密（随密码一起） |

### 安全特性

| 特性 | 说明 |
|------|------|
| 零网络请求 | 所有数据在本地处理，无任何网络通信 |
| 自动锁定 | 无操作超时（可配置 1/5/15/30 分钟）后自动锁定 |
| 剪贴板清除 | 复制密码后自动清除剪贴板（可配置 10/30/60 秒） |
| 内存清理 | 锁定时清除内存中的明文数据 |

---

## 导入导出

### 导出

点击右上角「导出」按钮，选择格式：

| 格式 | 说明 | 安全性 |
|------|------|:------:|
| `.vault` | 加密备份文件 | 安全 |
| `.csv` | 明文表格文件 | 需妥善保管 |

**推荐使用 `.vault` 格式作为定期备份。**

### 导入

点击右上角「导入」按钮：

- 支持 `.vault` 加密文件（需要原主密码解密）
- 支持 `.csv` 明文文件
- 导入时会自动去重（按标题+用户名匹配）

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 聚焦搜索框 |
| `Ctrl/Cmd + N` | 新建密码条目 |
| `Ctrl/Cmd + L` | 锁定密码库 |
| `Ctrl/Cmd + ,` | 打开设置 |
| `Escape` | 关闭模态框/面板 |

---

## 技术架构

### 技术栈

- **前端框架**：纯 Vanilla JavaScript（无框架依赖）
- **存储**：IndexedDB（浏览器原生）
- **加密**：Web Crypto API（浏览器原生）
- **UI**：CSS Variables + Flexbox/Grid
- **字体**：system-ui 系统字体栈（零外部依赖，纯离线）

### 为什么选择 IndexedDB 而非 sql.js？

| 维度 | IndexedDB | sql.js (SQLite WASM) |
|------|-----------|---------------------|
| 数据容量 | 数百 MB ~ GB | 需加载整个 DB 到内存 |
| 持久化 | 浏览器自动管理 | 需手动导入/导出 |
| 初始化开销 | 零依赖 | 需加载 ~1MB WASM |
| 查询能力 | 索引查询足够 | 完整 SQL |

**结论**：密码管理器数据量有限（几十到几千条），IndexedDB 已足够，且零依赖、自动持久化。

---

## 项目结构

```
LockPass/
├── index.html           # 主 HTML 文件（轻量化，仅结构）
├── css/
│   └── main.css         # 主样式文件（734 行）
├── js/
│   ├── crypto.js        # 加密工具模块（AES-256-GCM）
│   ├── database.js      # IndexedDB 存储模块
│   ├── generator.js     # 密码生成器模块
│   ├── utils.js         # 工具函数模块
│   ├── app.js           # 主应用逻辑模块
│   ├── ui.js            # UI 渲染模块
│   ├── entries.js       # 条目管理模块
│   ├── editor.js        # 条目编辑模块
│   ├── import-export.js # 导入导出模块
│   ├── settings.js      # 设置模块
│   ├── shortcuts.js     # 快捷键模块
│   └── main.js          # 主初始化模块
├── assets/
│   └── icons/
│       └── favicon.svg  # 网站图标
├── SPEC.md              # 产品规格文档
└── README.md            # 使用说明（本文件）
```

**模块化优势**：
- 每个功能模块独立文件，便于维护和升级
- 所有脚本本地化，完全离线可用
- 清晰的依赖关系，便于调试和扩展

---

## CI 与在线版

### 发布自动打包（GitHub Actions）

推 `v*` 标签（如 `v1.0.2`）或手动触发，自动构建并发布：

| 平台 | 产物 |
|------|------|
| Windows | NSIS 安装包 (.exe) + MSI (.msi) |
| macOS | .app 压缩包 (.zip) + .dmg |

产物先上传 Actions Artifact，再汇总到 **Draft Release**，人工确认后发布。
Windows 安装包会有 SmartScreen 提示，点击"更多信息 → 仍要运行"即可。

#### macOS 安装说明（首次打开）

macOS 产物为 ad-hoc 签名（未配置 Apple Developer 证书），分发到其他 Mac 首次打开时，
系统会拦截并提示"已损坏，无法打开"。这是正常的 Gatekeeper 安全机制，解除方法如下：

**下载 dmg 后（以 .dmg 为例）：**

1. 双击挂载 dmg，拖动 LockPass.app 到 Applications 文件夹
2. **打开 Finder → 应用程序**，找到 LockPass.app
3. **首次运行**：不要直接双击，改用以下任一方式打开：

   **方式一（推荐）：右键打开**
   - 按住 `Control` 键，同时单击 LockPass.app
   - 在弹出菜单中选择"打开"
   - 弹出提示框，点"打开"

   **方式二（终端命令）：**
   ```bash
   # 解除隔离属性（只需执行一次）
   xattr -rd com.apple.quarantine /Applications/LockPass.app

   # 然后正常双击打开
   open /Applications/LockPass.app
   ```

   **方式三（适用于 .zip 方式）：**
   ```bash
   # 解压后，同样解除隔离
   xattr -rd com.apple.quarantine ~/Downloads/LockPass-macos-aarch64/LockPass.app

   # 打开
   open ~/Downloads/LockPass-macos-aarch64/LockPass.app
   ```

> **注意**：每次下载新版本安装时，都需要重新执行上述解除隔离步骤。
> 如果不需要桌面版，也可以直接使用[在线版](https://trexwb.github.io/lockPass/)，无需安装。

### 在线版（GitHub Pages）

`main` 分支推送后自动将浏览器版部署到 **GitHub Pages**：

- 访问地址：`https://trexwb.github.io/lockPass/`
- 首次需在仓库 Settings → Pages → Source 选择 **GitHub Actions**
- 在线版数据存在访问者浏览器（IndexedDB），与桌面版相互独立，可用 .vault 文件导入导出互通

---

## 安全注意事项

### 浏览器环境风险

| 风险 | 说明 | 防范措施 |
|------|------|----------|
| XSS 攻击 | 恶意脚本窃取内存中的明文密码 | 仅在受信任环境使用，避免安装可疑浏览器扩展 |
| 浏览器漏洞 | 浏览器被入侵可能读取内存 | 保持浏览器更新，使用主流浏览器 |
| 本地文件泄露 | 电脑被盗/被入侵 | 设置电脑登录密码，启用磁盘加密（FileVault/BitLocker） |
| 主密码遗忘 | 无法恢复数据 | 牢记主密码，或将主密码存储在安全的地方 |

### 最佳实践

1. 使用强主密码（12位以上，含大小写字母、数字、符号）
2. 定期导出 `.vault` 加密备份，存储在安全位置
3. 设置合理的自动锁定时间（建议 5 分钟）
4. 不要在公共场所的电脑上使用
5. 启用电脑磁盘加密（FileVault / BitLocker）
6. 不要将 `.csv` 明文导出文件长期保存在电脑上
7. 不要将主密码写在纸上贴在显示器旁边

---

## 数据迁移

### 从其他密码管理器迁移

大多数密码管理器支持导出 CSV 文件：

1. 从原密码管理器导出 CSV
2. 在 LockPass 中点击「导入」
3. 选择 CSV 文件
4. 确认导入

**支持的 CSV 列名**：`title`, `username`, `password`, `url`, `category`, `notes`

---

## 浏览器兼容性

| 浏览器 | 版本要求 |
|--------|----------|
| Chrome | 60+ |
| Firefox | 60+ |
| Safari | 12+ |
| Edge | 79+ |

---

## 更新日志

### v1.0.13 (2026-08-22)

PWA 更新机制修复 — 解决「添加到主屏幕」后线上代码更新无法触达用户的问题：

- **sw.js fetch 策略重构**：
  - 导航请求（index.html）从「缓存优先」改为「网络优先」— 用户每次打开 PWA 先尝试拿最新 HTML，网络失败时回退缓存保底离线可用
  - 静态资源（JS/CSS）从「缓存优先」改为「Stale-While-Revalidate」— 先返回缓存秒开，同时后台拉取新版写入缓存，下次打开生效
  - 旧策略的问题：缓存优先导致即使 SW 激活了新版本，所有资源仍命中旧缓存，用户永远拿不到新代码
- **sw-register.js 新增 controllerchange 自动刷新**：
  - 新 SW 激活并接管页面时，自动 `window.location.reload()` 一次，确保用户立即使用最新资源
  - `refreshed` 标志位防止重复刷新
- 版本号统一 v1.0.13（AGENTS.md / SPEC.md 头尾 / js/app.js / package.json / tauri.conf.json / Cargo.toml / sw.js 共 9 处同步）
- **Bug 1：CSV 导入切行不一致** — 备注/密码等字段内含换行（RFC 4180 引号字段内换行）时，`previewCSV` 用 `Utils.splitCSVLines` 正确切行，但 `importCSV` 实际导入使用 `text.trim().split('\n')` 将一条记录拆成多条，导致导入错位/失败。修复：`importCSV` 统一切行方式为 `Utils.splitCSVLines`。
- **Bug 2：FileSync.syncNow() 同步失败无反馈** — 本地文件同步写入失败时只 `console.error`，既没有设置 `FileSync.lastSyncError`（设置面板状态标签始终显示「已同步」），也没有 Toast 提示用户。修复：成功清空 `lastSyncError`；失败写入 `this.lastSyncError = e` 并 `Utils.showToast` 提示。
- **Bug 3：exportVault 导出 iterations 硬编码为 100000** — `.vault` 加密备份导出时 `iterations` 直接写死 `100000`，未从 `DBUtils.meta.iterations` 读取实际存储值；若未来开放「修改迭代次数」功能，该导出文件会和实际加密参数不一致。修复：`iterRecord = await DBUtils.dbGet('iterations')`，与 `file-sync.js:_readPayload` 保持一致逻辑。
- **Bug 4：importEncryptedVault 解密未使用导入文件自带 iterations** — 与 Bug 3 成对存在：导入 `.vault` 解密时 `CryptoUtils.deriveKey(password, salt)` 未传第 3 参数，默认用 `100000` 次，完全忽略了导入文件 `data.iterations` 字段。修复：`iterations = Number(data.iterations) || 100000` 后传入 `deriveKey`，与导出逻辑对称。
- 版本号统一 v1.0.13（AGENTS.md / SPEC.md 头尾 / js/app.js / package.json / tauri.conf.json / Cargo.toml / sw.js 共 9 处同步）

### v1.0.12 (2026-08-21)

- 修复手机端侧边栏抽屉顶部按钮被 iOS 状态栏/刘海遮挡的问题：
  - `css/layout.css`：移动端抽屉 `#sidebar` 增加 `padding-top: env(safe-area-inset-top)`，使「添加密码」等顶部按钮避开系统状态栏
  - `css/entries.css`：移动端全屏详情面板 `#detail-panel` 同步增加 `padding-top: env(safe-area-inset-top)`，避免关闭按钮被刘海遮挡
- 版本号统一 v1.0.12

### v1.0.11 (2026-08-21)

- 修复 iPhone Safari 横屏显示 PC 布局的问题：
  - 根因：iPhone 横屏视口宽度 844~932px 超过原有 768px 断点，媒体查询不匹配导致 PC 布局（侧边栏常驻、无汉堡按钮）被应用
  - 平板断点 `max-width: 768px` → `max-width: 1024px`（覆盖 iPhone 横屏 + iPad 全系列），影响 `layout.css` / `settings.css`
  - 移动端断点 `max-width: 480px` → `max-width: 480px), (max-height: 500px`（通过 `max-height` 捕获横屏矮屏 375~430px），影响 `layout.css` / `base.css` / `modal.css` / `settings.css`
  - `base.css` 中 `max-width: 640px` 断点同步增加 `max-height: 500px` 条件（横幅布局 / 快捷键表格等）
  - CSS 变量 `--breakpoint-tablet` 从 768px 更新为 1024px
- 回归测试 19 项全通过：桌面 9 项 + iPhone 竖屏 5 项 + iPhone 横屏 5 项（含侧边栏抽屉 / 详情面板 / 添加条目）

### v1.0.10 (2026-08-21)

- 前端代码规范全面治理（按「前端开发规范」Skill 逐项修复）：
  - 移除全部 43 处 ES2020 可选链 `?.`（`editor.js` 42 + `main.js` 1），改写为 ES6 等价写法，兼容 Chrome 60+ / Firefox 60+ / Safari 12+ / Edge 79+
  - 5 个文件约 100 处 `var` 声明全部替换为 `const`/`let`（`template.js` / `tauri-bridge.js` / `file-store.js` / `ui.js` / `particles.js`）
  - 约 50 处静态行内样式 `style=""` 抽离为 CSS 工具类，新建 `css/utilities.css`（置于 `@import` 链最后，可覆盖组件默认样式）；动态样式（宽度百分比 / 条件显示 / 颜色变量）保留 JS 直接操作
  - `index.html` 内联 SW 注册脚本外置为 `js/sw-register.js`，清理 console 调试日志
  - z-index 全部变量化（`--z-bg` ~ `--z-banner` 语义化命名，统一管理于 `:root`）；4 组重复 rgba 半透明色提取为 CSS 变量
  - 魔法数字治理：动画时长 / 悬浮提示 / 复制反馈 / Toast 时长等常量前置命名（`entries.js` / `utils.js`）
  - CSP 保持 `script-src 'self' 'unsafe-inline'`（JS 模板大量 `onclick` 内联事件由 AGENTS.md 允许）
- 版本号统一 v1.0.10：`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` / `Cargo.toml` / `js/app.js` / `sw.js` / `AGENTS.md` / `SPEC.md` 共 9 处一致，`version:check` 通过
- Service Worker 缓存命名同步 `lockpass-v1.0.10`，`js/sw-register.js` 已加入预缓存列表

### v1.0.9 (2026-08-21)

- 跨端布局兼容性修复（H5 / Pad / PC / Tauri）：
  - `100vh` 全部补充 `100dvh` 回退（修复 iOS Safari 地址栏裁切）
  - `#header` / 详情页脚 / 弹窗页脚适配 `env(safe-area-inset-*)`（刘海屏 / Tauri 标题栏）
  - 触屏设备（`@media (hover:none)`）卡片操作按钮强制 `opacity:1`，修复复制/删除按钮不可见
  - `#sidebar-overlay` 桌面端默认 `display:none`，不再干扰布局
  - 绑定横幅 `#lp-bind-banner` 与 `#header` 重叠修复（`:has()` 选择器为 `#app` 加 padding-top）
  - 平板（≤768px）数据统计卡片 4 列改 2 列；手机端 Toast 移至顶部避开底部弹窗

### v1.0.8 (2026-08-21)

- 跨端 UI 兼容性全面检查（H5 / Pad / PC / Tauri 共 13 视口 × 10 状态 = 130 组合回归通过）：
  - 修复 320px 视口下设置弹窗快捷键表格横向滚动（`min-width:0` + 紧凑 padding + 名称/按键列允许折行）
  - 修复 v1.0.7 手机端横向溢出问题未在边缘视口/多界面复发

### v1.0.7 (2026-08-21)

- 修复手机端（竖屏）主界面横向溢出：
  - `css/main.css` 调整 `@import` 顺序（layout.css 移至 entries.css 之后，移动端响应式规则最后生效）
  - 侧栏 / 详情面板关闭态加 `visibility: hidden`（transition 延迟隐藏），屏外 fixed 元素不再撑宽移动端滚动区域
  - `html` 增加 `overflow-x: hidden` 与 body 双保险
- Service Worker 缓存命名同步 v1.0.7（`lockpass-v1.0.7`）

### v1.0.6 (2026-08-21)

- 绑定数据目录防覆盖机制（行为变更：不再静默覆盖已有同步文件）：
  - IndexedDB 无数据 + 目录已有 `LockPass-vault.json` → 直接用文件内容恢复数据并绑定
  - IndexedDB 已有数据（含刚创建的空库）+ 目录已有同步文件 → 弹窗让用户选择「用文件恢复」或「保留当前数据」
  - 恢复失败时不保存目录句柄、不写入文件，避免误绑定与误覆盖
- 系统 `confirm` 全部替换为应用内确认弹窗（`Utils.confirm`，桌面 / 手机 / Pad 表现一致）
- 修复桌面打包版主界面点击全部失效：
  - 根因：tauri.conf.json 配置 `csp` 后，Tauri 编译期会将 inline `<script>` 哈希化并移除 `script-src` 的 `'unsafe-inline'`，而 `onclick="..."` 事件属性不在哈希范围内导致全部被 CSP 拒绝（登录页 `addEventListener` 绑定不受影响）
  - 修复：`csp` 改回 `null`（meta CSP 原样生效），meta CSP 的 `connect-src` 补充 `ipc: http://ipc.localhost` 放行 Tauri IPC

### v1.0.5 (2026-08-21)

- 版本号统一 v1.0.5：`package.json` / `package-lock.json` / `src-tauri/tauri.conf.json` 与 `APP_VERSION`、SPEC.md 对齐（此前桌面打包产物版本与界面显示不一致）
- 清理创建流程死代码：曾绑定目录的恢复引导与「继续创建」确认合并为一次选择（`wasBound` 冗余分支移除）

### v1.0.4 (2026-08-21)

- 全量代码审计修复（17 项）：
  - CSV 预览崩溃（`rows` 未定义）修复；CSV 解析支持 RFC 4180 引号字段内换行
  - 移除主密码可逆混淆存储（sessionStorage），改为仅内存保存，刷新后需重新解锁
  - 密码生成器字段名对齐（digits/special → numbers/symbols）；消除随机数模运算偏差（拒绝采样）
  - 修复列表排序就地污染数据源（改为副本排序）
  - 收窄 Tauri `fs` 权限（移除 `path: "**"`），新增 `export_text_file` / `read_text_file_any` Rust 命令并接入前端
  - 落地 CSP（index.html meta + tauri.conf.json）
  - 消除多类型表单重复 DOM ID（改用 `data-field` 属性）
  - 文件同步失败不再静默（设置面板展示失败状态 + Toast 提示）
  - 侧栏统计合并为单次遍历；清理占位符/死代码/冗余赋值；deriveKey 支持读取 meta iterations
  - 确认框快捷键独立映射（Enter 直接点击确认）
  - CSS 按注释分区拆分为 base/layout/entries/editor/settings/modal/particles 七个子文件（main.css 保留 @import 入口）
- 新增 PWA 支持：manifest.json + Service Worker（缓存优先策略）+ iOS「添加到主屏幕」支持（apple-touch-icon / apple-mobile-web-app-*）
- macOS 桌面版不再显示「绑定数据目录」顶部横幅（数据已自动保存在应用数据目录，浏览器版行为不变）

- 修复手机端「两次密码不一致」误报（本次修复不升版本号，并入 v1.0.4）：
  - 创建保险箱两个密码输入框移除 `name` 属性并增加 `autocapitalize="off"` / `autocorrect="off"` / `spellcheck="false"`，降低移动端浏览器/密码管理器将页面识别为密码表单并自动填充的概率
  - 创建场景初始化后 250ms 再清空一次输入框（仅当两框均未聚焦时），对抗移动端异步自动填充晚于同步清空的问题
  - 校验不一致时清空确认框并聚焦，提示「两次密码不一致，请重新输入确认密码」，引导手动重输消除自动填充干扰
- 新增创建界面「绑定已有数据目录」入口（本次修复不升版本号，并入 v1.0.4）：
  - IndexedDB 为空（清空缓存/换浏览器）但原绑定目录中仍有 LockPass-vault.json 时，可在创建界面直接选择该目录完成恢复并绑定，恢复后自动同步
  - 与「从本地文件恢复」的区别：恢复同时完成目录绑定，后续修改自动写回文件
  - 所选目录无同步文件时不绑定并提示；Tauri 桌面版不显示该入口（数据已存本地文件）

### v1.0.3 (2026-08-21)

- 修复 Tauri 桌面版导出失败（dialog save 命令参数结构错误 `invalid args options`）：
  - `js/tauri-bridge.js` 中 `plugin:dialog|save` 调用将 `defaultPath`/`filters` 包进 `options` 对象，符合 Tauri v2 `tauri-plugin-dialog` 命令签名
  - 导出 `.vault` 加密备份与 `.csv` 明文备份恢复正常
- 修复 Tauri 桌面版链接点击无效（webview 中 `target=_blank` 不调起系统浏览器）：
  - `src-tauri/src/lib.rs` 新增 `open_url` 命令：协议白名单校验（仅 `http://` / `https://` / `mailto:`），按平台用 `open` / `cmd /C start` / `xdg-open` 调起系统浏览器
  - `js/tauri-bridge.js` 新增全局点击委托：拦截 `a[target="_blank"]` 链接，`preventDefault` 后调用 `open_url` 用系统浏览器打开
  - 网址链接与备注 markdown 解析链接点击恢复正常
- 侧边栏 UI 优化：
  - 「热门标签」标题可点击折叠/展开（chevron 指示器，localStorage 持久化折叠状态，默认展开）
  - 「退出」按钮始终固底：侧边栏内容移入 `.sidebar-scroll` 滚动容器，footer 不随内容滚动

### v1.0.2 (2026-08-20)

- 新增 GitHub Actions CI：
  - `.github/workflows/release.yml`：推 v* 标签自动构建 Windows（NSIS+MSI）与 macOS（.app+.dmg）安装包，上传至 Draft Release
  - `.github/workflows/pages.yml`：main 分支推送自动部署浏览器版到 GitHub Pages（在线版 [https://trexwb.github.io/lockPass/](https://trexwb.github.io/lockPass/)）

### v1.0.1 (2026-08-20)

- Tauri 桌面版新增本地文件存储 API（file_store_write/read/exists/delete/data_dir）：
  - 数据落盘到系统应用数据目录（macOS: ~/Library/Application Support/com.lockpass），meta 与 vault 分别存为 meta.json / vault.json
  - 前端新增 js/file-store.js：Tauri 环境下自动用文件版 DBUtils 替代 IndexedDB（接口完全一致，业务代码零改动），浏览器环境自动降级回 IndexedDB
  - 设置面板「本地文件同步」区在桌面版显示数据目录路径；Rust 命令含路径穿越防护

### v1.0.0 (2026-08-20)

- 更换应用图标：深海军蓝渐变底 + 青色 3D 金属保险箱 + 银白转盘（macOS/Windows 桌面图标与浏览器 favicon 同步更新）

### v1.0.0 (开发中)

- **6 种条目类型**：支持网站、服务器、数据库、AI、应用、其他凭证
  - 服务器：连接地址 + 端口 + 登录账号/密码 + root 账号/密码
  - 数据库：数据库地址 + 端口 + 用户名 + 密码（无 root 层级）
  - AI：服务名称 + API 地址 + Token
  - 应用：应用名称 + App ID + 公钥 + 私钥（多行 textarea）
  - 其他：凭证名称 + 凭证值
- **5 种条目类型**：支持网站、服务器、AI、应用、其他凭证
  - 服务器：连接地址 + 登录账号/密码 + root 账号/密码
  - AI：服务名称 + API 地址 + Token
  - 应用：应用名称 + App ID + 公钥 + 私钥（多行 textarea）
  - 其他：凭证名称 + 凭证值
- 公钥/私钥字段支持多行内容（含 PEM 证书格式）
- 详情面板按类型语义化渲染
- 卡片显示类型图标与语义化副标题
- CSV 导入/导出支持全部类型字段
- 二维码同步支持全部类型字段x
- 首次发布
- 完整的密码管理功能
- AES-256-GCM 加密
- IndexedDB 存储
- 导入导出功能
- 密码生成器
- 自动锁定
- 键盘快捷键

---

## License

MIT License - 自由使用、修改、分发。

---

## 常见问题

### Q: 忘记主密码怎么办？

**A: 无法恢复。** 主密码不存储在任何地方，是唯一解锁方式。如果忘记，只能销毁密码库重新开始。

### Q: 数据存储在哪里？

**A: 浏览器的 IndexedDB 数据库中。** 数据文件位于浏览器用户数据目录（Chrome: `~/Library/Application Support/Google/Chrome/Default/IndexedDB/`）。

### Q: 可以同步到其他设备吗？

**A: 手动同步。** 导出 `.vault` 文件，复制到其他设备，在浏览器中打开 `index.html` 后导入即可。

### Q: 可以在手机上使用吗？

**A: 理论上可以。** 在手机浏览器中打开 `index.html` 即可，但未针对移动端优化 UI。

### Q: 导出的 `.vault` 文件安全吗？

**A: 是的，已加密。** `.vault` 文件包含加密的密码数据，需要主密码才能解密。但请妥善保管主密码和 `.vault` 文件，不要同时泄露。

---

**保护好你的主密码，它守护着你所有的数字钥匙。**
