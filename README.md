# LockPass — 个人密码工作台

一款纯前端离线密码管理器，Vue 3 + Vite 构建，无后端服务器。浏览器双击 `dist/index.html` 即用，也可作为 Tauri 桌面应用（Windows / macOS）或 PWA 在线版使用。

---

## 功能清单

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 主密码验证 | [x] | 首次设置主密码，后续解锁需输入 |
| AES-256-GCM 加密 | [x] | Web Crypto API + PBKDF2（100000 次迭代） |
| 6 种条目类型 | [x] | 网站 / 服务器 / 数据库 / AI / 应用 / 其他凭证 |
| 密码增删改查 | [x] | 完整 CRUD 操作，按类型语义化字段 |
| 标签体系 | [x] | 带颜色和图标的标签，默认 7+12 个，可自定义 |
| 收藏功能 | [x] | 一键收藏常用密码 |
| 回收站 | [x] | 软删除 + 恢复 / 彻底删除 / 清空 |
| 修改历史与回滚 | [x] | 任意字段修改均生成快照记录（最近 5 版），回滚需确认、执行即删且不新增记录，不参与导入导出 |
| 全文搜索 | [x] | 按标题/用户名/URL/标签搜索 |
| 密码生成器 | [x] | 8-64 位，可选字符集，实时强度计算 |
| 密码显示/隐藏 | [x] | 点击切换，默认掩码 |
| 一键复制 | [x] | 复制后自动清除剪贴板 |
| 关联密码 | [x] | 同 IP / 域名 / 账号自动关联，点击跳转 |
| 二维码同步 | [x] | 分享为加密二维码；扫码 / 上传 / 拖拽 / 拍照导入 |
| 导入/导出 | [x] | 加密 .vault 格式 + CSV 明文格式 |
| 文件同步 | [x] | 本地文件系统访问 API（Chrome/Edge） |
| 自动锁定 | [x] | 无操作超时自动锁定（1/5/15/30 分钟/从不） |
| 自定义主题 | [x] | 深色 / 浅色 / 跟随系统 + 6 种强调色 |
| 移动端优化 | [x] | 底部导航、触控目标、扫码流程、安全区适配 |
| 自动备份 | [x] | 定期提醒导出 .vault + 自动加密快照（保留最近 N 份） |
| 浏览器扩展 | [x] | 自动填充登录表单（扩展 v1.0.1，见下方说明） |
| 键盘快捷键 | [x] | ⌘/Ctrl + K / N / L / , |
| IndexedDB 存储 | [x] | 浏览器本地持久化 |
| 桌面应用 | [x] | Tauri v2 封装（macOS / Windows） |
| PWA 离线 | [x] | Service Worker 离线缓存 + 在线版 |

---

## 快速开始

### 开发模式（Vite Dev Server）

```bash
npm install
npm run dev          # 启动开发服务器 http://localhost:1420
```

### 构建与使用

```bash
npm run vite:build   # 构建到 dist/（浏览器版 / Pages / Tauri 共用产物）
```

- **浏览器版**：构建后双击 `dist/index.html`，或拖拽到浏览器（产物为 iife 脚本，file:// 直接可用）
- **在线版**：推送到 `main` 分支自动部署到 GitHub Pages：<https://trexwb.github.io/lockPass/>

### 桌面版（Tauri）

```bash
npm run tauri:dev    # 桌面开发模式（自动启动 Vite dev server）
npm run tauri:build  # 构建桌面安装包
npm run make-dmg     # (macOS) 生成 .dmg
```

### 2. 创建密码库

首次打开会显示「创建密码保险箱」界面：

1. 输入主密码（8 位以上，建议包含大小写字母、数字、符号）
2. 再次确认密码
3. 点击「确认创建」

> **注意：** 主密码是唯一解锁方式，忘记后将无法恢复数据！

### 3. 添加密码

- 点击左下角「添加密码」按钮
- 选择条目类型（网站 / 服务器 / 数据库 / AI / 应用 / 其他），不同类型展示对应字段
- 填写标题（必填）、用户名、密码（必填）、网址、标签、备注
- 可使用密码生成器生成强密码
- 点击「保存」

### 4. 使用密码

- **查看详情**：点击密码条目，详情面板展示关联密码、操作入口
- **复制密码**：点击复制按钮，或打开详情面板后点击复制
- **显示/隐藏**：点击眼睛图标切换显示
- **编辑/删除**：在详情面板操作（删除进入回收站，可恢复）

---

## 安全机制

### 加密算法

```
主密码 → PBKDF2(SHA-256, 100000次迭代, 32字节盐值) → AES-256-GCM 密钥
数据   → AES-256-GCM 加密（随机12字节IV）          → 密文存储
```

### 数据存储

| 数据 | 存储位置 | 加密状态 |
|------|----------|:--------:|
| 密码条目 / 回收站 / 标签注册表 | IndexedDB | 已加密 |
| 主密码 | 不存储 | — |
| 盐值 / 迭代次数 (Salt / iterations) | IndexedDB | 明文 |
| 会话密钥 | sessionStorage | 解锁期间存在，锁定即清除 |

### 安全特性

| 特性 | 说明 |
|------|------|
| 零网络请求 | 默认所有数据在本地处理，无任何网络通信（可选联网功能默认关闭） |
| 自动锁定 | 无操作超时（可配置 1/5/15/30 分钟/从不）后自动锁定 |
| 剪贴板清除 | 复制密码后自动清除剪贴板（可配置 10/30/60 秒） |
| 内存清理 | 锁定时清除内存与 sessionStorage 中的明文数据 |
| CSP 限制 | Tauri 桌面版启用严格 CSP（无远程脚本/样式） |

---

## 导入导出

### 导出

点击右上角「导出」按钮，选择格式：

| 格式 | 说明 | 安全性 |
|------|------|:------:|
| `.vault` | 加密 JSON 文件（盐值+IV+密文，含迭代次数） | ✅ 安全 |
| `.csv` | 明文表格文件 | ⚠️ 需妥善保管 |

**推荐使用 `.vault` 格式作为定期备份。**

### 导入

点击右上角「导入」按钮：

- 支持 `.vault` 加密文件（需要原主密码解密，使用文件内自带迭代次数）
- 支持 `.json` 加密备份：自动快照（`backups/LockPass-backup-*.json`）与同步文件（`LockPass-vault.json`）同样可导入，需主密码解密
- 支持 `.csv` 明文文件（含全部类型字段）
- 导入时自动去重（按标题+用户名匹配）

### 跨设备迁移

- **二维码**：详情面板「分享为二维码」→ 另一台设备「二维码导入」扫码，自动解密导入
- **.vault 文件**：导出 → 复制 → 导入

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

- **前端框架**：Vue 3（Composition API，`<script setup>`）+ Vite 5
- **状态管理**：composables（`useVault` 等，不引 Pinia）
- **核心逻辑**：`src/core/` ES module（保持 `window.*` 挂载，算法零改动迁移）
- **存储**：IndexedDB（浏览器原生）；桌面版走 Tauri 文件存储（`file-store.js` 同接口）
- **加密**：Web Crypto API（浏览器原生）
- **UI**：CSS Variables + Flexbox/Grid，自绘组件，零 UI 库依赖
- **字体**：system-ui 系统字体栈（零外部依赖，纯离线）
- **桌面封装**：Tauri v2（Rust）

### 构建产物

| 产物 | 用途 | 说明 |
|------|------|------|
| `dist/` | 浏览器版 / GitHub Pages / Tauri frontendDist | `vite build` 外置资源产物，iife 单 chunk（file:// 可双击打开） |

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
├── src/                   # 前端源码（唯一真源）
│   ├── index.html         # Vite 入口 HTML（仅结构）
│   ├── main.js            # Vue 入口：顺序导入 core 模块 + 挂载 App
│   ├── App.vue            # 根组件：认证（创建/解锁）→ 主界面
│   ├── core/              # 核心逻辑层（ES module，window.* 挂载，零框架依赖）
│   │   ├── crypto.js      # AES-256-GCM 加密（PBKDF2 派生）
│   │   ├── database.js    # IndexedDB 存储
│   │   ├── file-store.js  # Tauri 文件存储（与 IndexedDB 同接口）
│   │   ├── file-sync.js   # 数据目录绑定 + 文件同步
│   │   ├── generator.js   # 密码生成器
│   │   ├── utils.js       # 工具函数 + SvgIcons
│   │   ├── related.js     # 关联密码（同 IP/域名/账号）
│   │   ├── import-bridge.js # CSV/.vault 导入解析
│   │   ├── tauri-bridge.js  # Tauri 桥接（检测 __TAURI__ 时覆盖下载/剪贴板）
│   │   ├── sw-register.js   # Service Worker 注册 + 更新自动刷新
│   │   ├── version.js       # 版本号（构建期注入）
│   │   └── particles.js     # 粒子背景动效
│   ├── composables/       # 响应式状态（useVault / useShortcuts）
│   ├── components/        # Vue SFC 组件
│   │   ├── layout/        # AppShell / SidebarNav / HeaderBar
│   │   ├── auth/          # AuthView（创建/解锁/修改主密码）
│   │   ├── entries/       # DetailPanel 详情面板
│   │   ├── modals/        # EntryEditor / Settings / Import / Export / Tags / QrShare / QrImport / ChangePw
│   │   └── common/        # ModalBase 等公共组件
│   ├── styles/            # 设计令牌 + 按域拆分样式（base/layout/entries/editor/modal/settings/utilities）
│   └── public/            # 静态资源（sw.js / manifest.json / assets/vendor/*.js）
├── src-tauri/             # Tauri v2 桌面封装（Rust 命令 + 图标 + 打包配置）
├── scripts/               # 构建辅助脚本（bump-version / check-version / gen-icons / make-dmg）
├── dist/                  # 构建产物（vite build 生成，不手动修改）
├── docs/                  # 文档中心（spec / tauri / 迁移设计，见 docs/README.md）
└── README.md              # 使用说明（本文件）
```

**模块化优势**：
- `core/` 纯逻辑层零框架依赖，加密与存储算法稳定可审计
- 组件层（composables + SFC）负责状态与交互，便于扩展新功能（TOTP、审计等）
- 所有资源本地化，完全离线可用

---

## 浏览器扩展（自动填充）

`extension/` 目录提供 Manifest V3 扩展，解锁 LockPass 后可在任意网站一键填充登录表单。

### 安装（开发者模式）

**方式一：下载在线扩展包（免克隆仓库）**

0. 也可在应用内直接获取：设置 → 浏览器扩展 → 「下载 zip」/「使用指南」（桌面版会复制链接到剪贴板，请在系统浏览器打开）
1. 下载部署在 GitHub Pages 的扩展包：`https://trexwb.github.io/lockPass/lockpass-extension-v<版本>.zip`（版本号随主应用，由流水线自动打包 `extension/` 目录生成，如 `lockpass-extension-v1.0.7.zip`）
2. 解压到任意目录
3. 打开 Chrome/Edge → `chrome://extensions`（Edge: `edge://extensions`）→ 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的目录

**方式二：使用仓库源码**

1. 打开 Chrome/Edge → `chrome://extensions`（Edge: `edge://extensions`）
2. 开启「开发者模式」→「加载已解压的扩展程序」
3. 选择本仓库的 `extension/` 目录

> 若使用本地 `file://` 版 LockPass（双击 dist/index.html），需在扩展详情页开启「允许访问文件网址」。

### 使用流程

1. 打开并解锁 LockPass（在线版 / localhost 开发版 / file:// 版均可）
2. 在任意登录页面点击扩展图标 → 弹出条目列表（可搜索）
3. 点击条目 → 用户名与密码自动填入表单（**不会自动提交**，高亮提交按钮后由你确认）

### 安全模型

| 项 | 说明 |
|----|------|
| 主密码不出主应用 | 解密只在 LockPass 页面内存进行，扩展仅转发密文请求结果 |
| 扩展不落盘 | 明文密码只在「请求 → 转发填充」的瞬时内存中出现，用后即清；扩展无 storage 权限 |
| 会话令牌 | 解锁时生成一次性令牌（sessionStorage），锁定/登出即失效 |
| 来源校验 | 页面仅响应本窗口携带有效令牌的 postMessage 请求 |
| 不自动提交 | 填充后不触发提交，避免误操作 |

### 限制

- 需 LockPass 页面保持打开且处于解锁态（实时代理，不做扩展侧缓存）
- 表单识别基于通用规则（密码框定位 + 常见用户名选择器），复杂/动态表单可能识别失败
- 仅支持单条目点击填充，无自动弹出建议

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

### 自动更新（桌面版，v1.0.11 起）

基于 Tauri 官方 updater 插件 + GitHub Releases：

- **工作原理**：桌面版启动 5 秒后后台检查 `https://github.com/trexwb/lockPass/releases/latest/download/latest.json`；发现新版本自动下载安装（进度见 设置 → 关于 → 应用更新），完成后 Toast 提示并弹确认「立即重启」；也可关闭「自动检查更新」改为手动检查
- **完整性校验**：更新包经 minisign 体系签名（私钥本地保管，公钥内嵌 `tauri.conf.json`），篡改/错配的更新包会被拒绝安装
- **发布流程**：推 `v*` 标签 → CI 构建三平台产物并自动生成 `latest.json` → **Publish Draft Release** 后全量用户可达（Draft 未发布前清单 404 属预期）
- **首次启用引导**：v1.0.11 是首个带更新能力的版本，v1.0.10 及更早安装包需**手动安装一次 v1.0.11**，此后版本即可自动升级
- **CI 密钥配置（一次性，两个 Secret 缺一不可）**：仓库 Settings → Secrets and variables → Actions 新增
  1. `TAURI_SIGNING_PRIVATE_KEY` — 本地 `~/.tauri/lockpass-updater.key` 全文
  2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — 生成密钥时设置的密码（当前密钥为加密态；release.yml 已用 ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }} 引用；若换回无密码密钥则改回空串）
  私钥丢失将无法再为该公钥签名发版（需在 conf 换公钥并让用户重装），务必妥善备份
- **本地构建**：v1.0.15 起签名变量统一收敛到项目根 `.env.local`（已被 .gitignore 忽略）：包装器 `scripts/with-updater-key.mjs` 在 `tauri:build` 时自动加载并注入**内联私钥**（`tauri build` 签名只认内联 `TAURI_SIGNING_PRIVATE_KEY`，`_PATH` 形式仅 signer 子命令支持）；首次使用需把其中 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 的占位值替换为生成密钥时设置的密码（当前密钥为带密码加密状态）

### 在线版（GitHub Pages）

`main` 分支推送后自动将浏览器版部署到 **GitHub Pages**：

- 访问地址：`https://trexwb.github.io/lockPass/`
- 浏览器扩展 zip 随站点一同发布：`https://trexwb.github.io/lockPass/lockpass-extension-v<版本>.zip`（见「浏览器扩展 → 安装」）
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

1. 使用强主密码（12 位以上，含大小写字母、数字、符号）
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

**支持的 CSV 列名**：`title`, `username`, `password`, `url`, `category`, `notes`（另支持 6 种条目类型的扩展字段，见 `src/core/import-bridge.js` 的列名映射）

### 旧版本数据

- 旧版「分类」数据在首次解锁时自动迁移为「标签」（幂等，迁移后回写）
- 旧版索引数据（categories 字段）导入导出保持兼容

---

## 浏览器兼容性

| 浏览器 | 版本要求 |
|--------|----------|
| Chrome | 60+ |
| Firefox | 60+ |
| Safari | 12+ |
| Edge | 79+ |

---

## 版本日志

版本迭代日志已迁移至 [`docs/version/`](docs/version/README.md)（按主版本归档，最新在前）；本文件不再内嵌更新日志。
## 常见问题

### Q: 忘记主密码怎么办？

**A: 无法恢复。** 主密码不存储在任何地方，是唯一解锁方式。如果忘记，只能销毁密码库重新开始。

### Q: 数据存储在哪里？

**A: 浏览器的 IndexedDB 数据库中。** 数据文件位于浏览器用户数据目录（Chrome: `~/Library/Application Support/Google/Chrome/Default/IndexedDB/`）。桌面版存储于系统应用数据目录（见 `docs/tauri.md`）。

### Q: 可以同步到其他设备吗？

**A: 手动同步。** 导出 `.vault` 文件，或使用「分享为二维码」扫码导入。多设备自动同步不在当前规划内（与零网络原则冲突）。

### Q: 可以在手机上使用吗？

**A: 可以。** 移动端有底部导航（全部/收藏/回收站/添加/标签）、全屏详情面板、二维码扫码导入、安全区适配（刘海屏/全面屏），触控目标按移动端规范加大；也可安装为 PWA（添加到主屏幕）。

### Q: 导出的 `.vault` 文件安全吗？

**A: 是的，已加密。** `.vault` 文件包含加密的密码数据，需要主密码才能解密。但请妥善保管主密码和 `.vault` 文件，不要同时泄露。

---

**保护好你的主密码，它守护着你所有的数字钥匙。**
