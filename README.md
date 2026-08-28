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

## 更新日志

### v1.0.15 (2026-08-28)

修复本地构建仍报「no private key」：包装器此前只注入 `TAURI_SIGNING_PRIVATE_KEY_PATH`，而 **`tauri build` 的更新产物签名只认内联 `TAURI_SIGNING_PRIVATE_KEY`**（`_PATH` 形式仅 `tauri signer` 子命令支持，此前冒烟测的恰好是 signer 子命令故被误导）。

- 包装器在 env 加载后统一补齐内联变量：从 `.env.local` 的 PATH 或兜底私钥文件读取内容注入
- 加密态检测：私钥首行含 encrypted 且未提供密码时打警告（当前密钥为加密态，密码取自 .env.local）
- 实测：本机 `npm run tauri:build` 端到端产出 `LockPass.app.tar.gz` + `.sig`（408B），退出码 0

### v1.0.14 (2026-08-28)

签名环境变量收敛到项目根 `.env.local`：

- 包装器 `with-updater-key.mjs` 改为优先加载项目根 `.env.local`（兼容旧位置 `~/.tauri/lockpass-updater.env`），`tauri:build` 无需手动 source
- `.gitignore` 补 `.env.local`；文件含 600 权限，内容为私钥路径指针 + 密码占位（密钥现为「带密码加密」状态，密码由用户自行填写，不入库不外泄）
- 公钥已同步为当前加密密钥对的公钥（tauri.conf.json）；端到端签名冒烟通过
- 加载顺序：手动 export 优先 > .env.local > ~/.tauri 旧位置 > 本地私钥路径兜底

### v1.0.13 (2026-08-28)

修复本地打包「A public key has been found, but no private key」：

- **根因**：v1.0.11 起公钥内嵌 + createUpdaterArtifacts 后，本地 `npm run build` 签名更新产物时要求 `TAURI_SIGNING_PRIVATE_KEY`，该变量此前只在 CI Secrets 中存在
- **修复**：`tauri:build` 接入包装器 `scripts/with-updater-key.mjs`——未设置签名变量时自动注入 `~/.tauri/lockpass-updater.key` 路径与空密码 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`（空密码密钥在无 TTY 环境必须显式提供空值，否则 CLI 交互询问密码直接失败）；CI 已有 Secrets 时原样透传；release.yml 两个构建 job 同步补显式空密码
- **备选**：也可手动在 shell 配置里 `export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/lockpass-updater.key"`

### v1.0.12 (2026-08-28)

修复 macOS 桌面版「复制失败，请手动复制」：

- **根因**：tauri-plugin-clipboard-manager 在 tokio worker 线程经 arboard 调 NSPasteboard，与 WebKit 主线程的粘贴板监控竞态（官方 issue plugins-workspace#3205，macOS 26 上高发）→ `write_text` 失败 → 复制报错；原实现把真实错误吞成统一文案且无法定位
- **修复三层**：
  1. macOS 桌面不再安装剪贴板插件 shim，点击复制回归 WebKit 原生 `navigator.clipboard.writeText`（主线程执行、手势可用、天然线程安全）；Windows 保持插件 shim 不变
  2. 无手势场景（如 10s 自动清空剪贴板）新增 Rust 命令 `clipboard_write_text`：`run_on_main_thread` 派发 arboard 写入，绕开线程竞态（前端经 `LockClipboard.write` 统一入口）
  3. `copyToClipboard` 失败自动降级 `execCommand('copy')` 兼容通道，仍失败才报错且 Toast 携带真实错误信息；复制后的纯 UI 装饰异常不再误报为复制失败
- **影响面**：仅 macOS 桌面行为变化；Windows / 浏览器版复制路径不变

### v1.0.11 (2026-08-28)

新增桌面版自动更新（Tauri updater 插件 + GitHub Releases）：

- **更新通道**：启动 5s 后静默检查 GitHub Releases 的 `latest.json`；发现新版本自动下载安装（进度在 设置 → 关于 → 应用更新 展示），完成后弹窗重启生效；可在设置关闭自动检查
- **发布链**：`createUpdaterArtifacts` 生成签名更新包（Windows NSIS setup.exe / macOS app.tar.gz），新增 `update-manifest` job 汇总双平台产物生成 `latest.json` 随 Draft Release 发布；签名私钥经 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` 注入
- **完整性**：更新包签名校验（公钥内嵌 tauri.conf.json），拒绝篡改与错配
- **引导说明**：v1.0.11 为首个可自更新版本，更早版本需手动安装一次；浏览器版/Pages 不具备也不需要更新能力（刷新即最新）
- **同批**：v1.0.10 已将设置面板「使用指南」切至 Pages 托管（`lockpass-扩展使用指南.html`，构建时由 `copy-guide.mjs` 拷入站点）

### v1.0.9 (2026-08-27)

Windows 桌面启动 404 问题根治（受控对比实验锁定根因）：同机另一 Tauri 项目（fastenerTradeWorkbench，无 Service Worker）从不复现该症状——唯一结构差异即 lockPass 自 v1.0 起随包携带并注册 PWA SW，其历史注册残留在 http://tauri.localhost 的 WebView2 用户目录中，冷启动首次导航被 SW 接管时产生浏览器级 404。

- **打包剥离**：`beforeBuildCommand` 追加 `node scripts/remove-dist-sw.mjs`，桌面包不再携带 `sw.js`（浏览器版/Pages 流程不受影响），从源头杜绝新的注册可能
- **自愈探针**：`core/boot-flag.js` 最先同步设置 `__LOCKPASS_BOOTED__`；Rust setup 注入一次性探针（500ms/1400ms/3000ms 三次 eval），首屏未完成引导则页面上下文内自动 reload（最多重试 2 次），替代手动点「刷新」
- **数据迁移桥**：发现历史上 `__TAURI__` 注入异常期间 file-store 从未激活、密码库一直存放在旧 origin 的 IndexedDB 中。新增一次性迁移——文件存储为空而 IDB(`PasswordVaultDB`) 有 salt+vault.main 时整体搬入 meta.json/vault.json（刻意排除 dirHandle，禁止把浏览器版句柄带入桌面）；所有读写经 openDB 闸门串行化保证 boot 首读前完成
- **设置面板外链升级**：桌面端改用 Rust 命令 `open_url`（协议白名单校验）直接在系统浏览器打开扩展下载/指南链接，剪贴板复制降级为兜底

### v1.0.8 (2026-08-27)

设置面板新增「浏览器扩展」分组（位于「备份」之后）：

- **下载扩展包**：一键打开 Pages 发布的 `lockpass-extension-v<版本>.zip`，版本号与主应用一致；浏览器直接新标签页下载
- **使用指南**：跳转 GitHub 文档《lockpass-扩展使用指南》（安装/配对/自动填充说明）
- **桌面版适配**：桌面端无 shell/opener 插件，点击后自动复制链接到剪贴板并提示在系统浏览器中打开（面板内有说明文案）

### v1.0.7 (2026-08-27)

修复 Windows 桌面版启动 404（需点「刷新」才能进入）复发问题：

- **根因**：与 v1.0.2 所修问题同源——桌面/浏览器判定依赖 `window.__TAURI__` 全局，而该用户 Windows 环境此全局注入缺失，v1.0.2 的「桌面跳过 SW 注册 + 清残留」逻辑从未执行：WebView2 在 `http://tauri.localhost` 注册了 PWA SW，旧 SW 拦截首屏导航返回 404 错误页
- **连锁确认**：同一缺失也是 v1.0.5/v1.0.6 所修「目录绑定入口暴露 → 句柄 JSON 落盘退化 → 每次写入报 getFileHandle 错」的源头；本次一并收口
- **修复**：新增 `src/core/tauri-env.js` 统一环境探测（最先加载）——`__TAURI__.core.invoke` 可用则直连，否则回退恒存在的 `__TAURI_INTERNALS__.invoke` 并输出警告日志，结果挂载 `window.LockTauri`；file-store / sw-register / tauri-bridge / tauri-server-bridge 四处消费方全部改为读取 LockTauri；sw-register 桌面分支提前到脚本求值期立即清残留（不再等 load），尽量缩小旧 SW 干扰窗口
- **升级用户**：安装本版后第一次打开若仍见 404，点一次「刷新」进入即可；此后每次启动恢复正常（残留 SW 已被清除）

### v1.0.6 (2026-08-27)

Windows 桌面端「绑定目录后每次写入报 getFileHandle not a function」加固：

- **背景**：Windows 上若 `window.__TAURI__` 全局注入异常，file 存储不启用，桌面被误判为浏览器 → 设置面板出现「绑定目录」入口；WebView2 选择器返回的目录句柄经 JSON 落盘（meta.json）后丢失全部方法，之后任何写入触发 syncNow 都抛 `getFileHandle is not a function`
- **修复**：① file-store 增加 `__TAURI_INTERNALS__` 兜底桥接——`__TAURI__` 缺失时仍以文件存储模式运行并输出警告日志；② 绑定入口、设置面板状态判定升级为双信号检测；③ `bindDirectory()` 在 Tauri 环境硬拒绝并提示「桌面版数据已由本地文件自动保存，无需绑定同步目录」，从源头杜绝误绑
- **对已有损坏状态**：升级到本版后首次写入会自动解绑失效句柄（Toast 提示一次）并恢复正常保存

### v1.0.5 (2026-08-27)

修复任何写入操作都报「本地文件同步失败：e.getFileHandle is not a function」的问题：

- **根因**：绑定的目录句柄（FileSystemDirectoryHandle）退化为普通对象——该对象无法经 JSON 序列化还原方法（桌面文件存储/异常迁移场景），或引擎升级导致旧句柄失配；同步流程仍照常读取并调用其 `getFileHandle`，每次保存（doSave 均触发 syncNow）都抛错弹 Toast
- **修复**：新增 `ensureUsableDirHandle()` 自愈式获取——检测到句柄无 `getFileHandle` 方法时自动解绑（清除存储句柄与绑定标记）、Toast 提示一次「本地文件同步已停用…可在设置中重新绑定」，此后未绑定状态静默跳过；自动快照浏览器分支与设置面板状态显示同步适配（面板显示「目录句柄失效，请重新绑定」）
- **影响**：密码数据本身始终保存在 IndexedDB / 桌面本地文件中，完全不受影响；重新在设置中绑定目录即可恢复文件同步

### v1.0.4 (2026-08-27)

回滚功能优化：「密码历史」升级为「修改历史」——

- **全字段记录**：不再只记密码。编辑保存时任意内容字段（标题/用户名/网址/备注/标签/端口/Root 账号/App ID/私钥等）有变更都会生成一条记录，内容为修改前的完整字段快照 + 变更字段列表；favorite / 显密等状态位变化不记录
- **确认弹窗防误操作**：点击「回滚」先弹出确认（提示将覆盖哪些字段），原「回滚前自动把当前密码存入历史」的保护方式取消
- **执行即删**：回滚成功后删除被执行的那条记录，避免重复执行
- **回滚不新增记录**：回滚不是编辑，不再产生新的历史条目
- 兼容旧版 `{ password, at }` 仅密码记录：仍可展示与回滚（只恢复密码），列表标注「旧版记录 · 仅密码」；每条目仍保留最近 5 版

### v1.0.3 (2026-08-27)

修复「批量导入」导入备份 JSON 报 `不支持的文件格式` 问题：

- **根因**：导入侧仅识别 `.vault` 导出的 `format: 'encrypted'` 标记或明文 `entries` 结构；而自动快照 / 文件同步生成的 JSON（`LockPass-backup-*.json`、`LockPass-vault.json`）使用 `format: 'LockPass-file-sync'` 信封，两条判断都不命中，直接弹出格式错误提示
- **修复**：「批量导入」弹窗与主窗口拖拽导入（`import-bridge.js`）均改为按加密封套结构识别——文件同时含 `salt + iv + data` 即走主密码解密流程；快照文件的展示时间回退读取 `updatedAt`
- **影响**：`.vault` 导出、自动快照、同步 JSON 三类加密备份现在均可直接导入；解密逻辑不变（PBKDF2 按文件自带 salt / iterations 派生密钥）

### v1.0.2 (2026-08-25)

修复 Windows 桌面版首次启动 404（点击刷新后恢复正常）问题：

- **根因**：Tauri 桌面版也注册了 PWA Service Worker，旧 SW 缓存的资源清单与安装包内嵌资源不一致时，首屏导航被旧 SW 拦截返回 404；刷新后新 SW 接管才正常
- **修复**：`sw-register.js` 增加 Tauri 环境检测（`window.__TAURI__`），桌面版跳过 SW 注册；启动时自动注销历史版本残留的 SW 并清空 CacheStorage，升级用户首次运行即完成清理，之后不再出现 404
- **影响**：浏览器版（file:// / localhost / GitHub Pages）SW 注册与 PWA 更新机制保持不变，仅桌面版行为变更

### 扩展 v1.0.1 (2026-08-25)

- 新增「Tauri 桌面版内嵌本地 HTTP 服务」：Rust tiny_http 仅绑定 127.0.0.1:33555，提供 `/status`、`/credentials`（Bearer 鉴权、按域名查询）、`/pair` 一键配对（6 位 nonce 桌面弹窗确认）等接口；前端解锁后经 `tauri-server-bridge.js` 同步明文条目到 Rust 内存、锁定即清空；桌面版扩展不再依赖失效的页面 postMessage 桥，改为 fetch 本地服务取数，并支持网页版页面桥与桌面版 HTTP 双就绪来源
- 扩展升级「复杂动态表单支持」：content_scripts 开启 `all_frames` 穿透 iframe（填充消息显式携带 frameId，杜绝多 frame 广播重复填充）；`walkRoots` 递归遍历 open shadow root，支持 Shadow DOM 内部表单；新增多步登录状态机（第一步 `LP_FILL_USERNAME` 只填用户名 → 密码框出现 `LP_PASSWORD_READY` 自动补填，pendingCredential 缓存含 120s 有效期），MutationObserver 增加 attributes 监听覆盖动态 type 切换
- 新增「自动弹出建议」：按当前 tab URL 域名预筛选推荐条目，命中时右下角气泡展示可点击条目（气泡仅接收剥离密码字段的条目，密码只在 background 内存）+ toolbar 徽标数字；未命中给空态提示；同页 60s 节流、用户关闭/点选后本页不再自动弹、气泡 5s 自动收起、徽标 30s 自动清除；点击建议一键填充当前页面（兼容 iframe 与多步登录），零新增权限
- 新增文档「扩展使用指南」：`docs/lockpass-扩展使用指南.md` 与 `.html`（含一键配对 / 自动填充全流程截图 guide-01~06），覆盖浏览器版（file:// 双击、localhost dev、GitHub Pages）与桌面版（内嵌 HTTP 通道）使用方式及桌面版打包安装说明
- 扩展 manifest 版本同步至 1.0.1（主应用版本保持 v1.0.1 不变）
- 新增「浏览器扩展（v0.1 实验版）」：`extension/` 目录 Manifest V3 扩展——解锁态通信（LockPass 页面 ExtBridge + 会话令牌 + postMessage 协议，主密码不出主应用）、通用登录表单识别与填充（原生 setter + input/change 事件，兼容主流前端框架）、popup 搜索列表、不自动提交、扩展零落盘（无 storage 权限，明文瞬时转发）
- 新增「自动备份」：可配置提醒间隔（关闭/1/3/7/30 天），解锁时距上次 .vault 导出或快照超期则 Toast 提醒（防刷屏节流）；桌面端（Tauri）与浏览器已绑定目录支持自动加密快照——解锁后检查间隔自动生成带日期时间的完整密文快照到 backups/，保留最近 N 份（默认 5，可配 3~20），Tauri 用清单文件维护、浏览器用目录枚举清理；设置面板新增备份区块（提醒间隔/快照开关/间隔/保留份数/上次备份时间/立即备份），浏览器未绑定目录时按钮引导导出 .vault；.vault 导出成功自动刷新备份时间
- 移动端体验打磨：新增底部导航（全部/收藏/回收站/添加/标签，回收站徽标，中心凸起添加按钮）；修复移动端无 hover 导致卡片操作按钮不可见的问题（改为常显）；触控目标尺寸对齐（导航项 44px、卡片操作 36px、主按钮 40px+）；扫码流程优化（上传区更大触控面、取景框限高防溢出）；安全区适配补齐（底部导航/详情页/弹窗底栏）
- 新增「自定义主题」：深色 / 浅色 / 跟随系统（`prefers-color-scheme` 实时响应）三种模式 + 蓝/绿/紫/橙/红/青 6 种强调色；主题与强调色存 localStorage，挂载前同步应用无闪屏；强调色由 CSS 色相变量驱动（accent/dim/glow/hover/焦点边框全跟随）；粒子背景颜色随主题切换重绘；Tauri 桌面版 CSP 下无内联脚本，兼容
- 新增「密码历史记录与回滚」：编辑条目且密码变更时自动快照旧密码（每条目最多保留最近 5 版，最新在前）；详情面板展示历史版本（时间 + 掩码密码），一键回滚；回滚前自动保存当前密码防误操作。历史随整体 vault 加密，不参与 .vault / CSV 导入导出；彻底删除 / 清空回收站时同步清理无主历史
- 文档对齐：README / docs/spec.md / docs/tauri.md / AGENTS.md 更新至 Vue 3 + Vite 实际架构（此前仍描述 Vanilla JS 结构与已退役构建脚本）

### v1.0.0 (2026-08-22)

PWA 更新机制修复 — 解决「添加到主屏幕」后线上代码更新无法触达用户的问题：

- **sw.js fetch 策略重构**：
  - 导航请求（index.html）从「缓存优先」改为「网络优先」— 用户每次打开 PWA 先尝试拿最新 HTML，网络失败时回退缓存保底离线可用
  - 静态资源（JS/CSS）从「缓存优先」改为「Stale-While-Revalidate」— 先返回缓存秒开，同时后台拉取新版写入缓存，下次打开生效
- **sw-register.js 新增 controllerchange 自动刷新**
- **6 种条目类型**：网站、服务器、数据库、AI、应用、其他凭证（服务器含 root 账号层级；应用含公钥/私钥多行 PEM；AI 含 Token）
- **二维码同步**：分享为加密二维码（LockPass-QR v1 载荷）+ 移动端扫码 / 上传 / 拖拽 / 拍照导入
- **回收站**：软删除 + 恢复 / 彻底删除 / 清空，删除数据不随导入导出迁移
- **标签体系**：合并「分类 + 标签」为统一标签注册表（颜色 + 图标），旧数据自动迁移
- **关联密码**：同 IP / 根域名 / 内网主机名 / 同账号自动关联
- **Vue 3 迁移**：全量迁移至 Vue 3 + Vite（iife 产物，file:// 双击可用），详见 `docs/superpowers/specs/2026-08-23-vue3-migration-design.md`
- **Bug 修复**：CSV 导入切行不一致（RFC 4180 引号字段内换行）；FileSync 同步失败无反馈；exportVault 迭代次数硬编码；importEncryptedVault 忽略文件自带迭代次数

---

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
