# LockPass 桌面封装（Tauri v2）

将 LockPass 密码保险箱打包为 Windows / macOS 原生桌面应用。
数据仍 100% 本地存储，**默认不联网**；浏览器版与桌面版共用同一套前端产物（`dist/`）。

## 架构要点

- **Vite 构建产物**：`tauri.conf.json` 的 `build.frontendDist` 指向 `"../dist"`（相对 `src-tauri/`），
  `beforeBuildCommand: "vite build"` 构建前端，`beforeDevCommand: "npm run dev"`（Vite dev server，
  `devUrl: http://localhost:1420`）供开发模式热更新。
- **全局 Tauri API**：`app.withGlobalTauri: true` 把 Tauri JS API 注入 `window.__TAURI__`，
  前端直接调用 `core.invoke` 下的 `export_text_file` 等 Rust 命令。
- **桥接层** `src/core/tauri-bridge.js`：仅在检测到 `window.__TAURI__` 时生效，覆盖
  `Utils.downloadFile`（导出→系统保存框+写文件，返回 boolean）与 `navigator.clipboard`（复制→剪贴板插件）。
  **浏览器环境下自动降级原生 API，Web 版零改动。**
- **存储**：桌面版默认数据目录为系统应用数据目录（macOS `~/Library/Application Support/com.lockpass`，
  Windows `%APPDATA%\com.lockpass`），`src/core/file-store.js` 以同接口透明替换 IndexedDB；
  加密负载结构不变，与浏览器版可无缝迁移。
- 导入：沿用 `<input type=file>`（Tauri v2 原生可用）；系统拖放导入已禁用（见下）。
- `IndexedDB` / `Web Crypto`：Tauri webview 原生支持，`tauri://localhost` 下 `isSecureContext` 为 `true`，正常通过。
- `bundle.identifier` 为 `com.lockpass`（不能是 `com.lockpass.app`，会与 macOS 应用包扩展名冲突）。

## 本地 prerequisites

### macOS（开发 / 构建 macOS 包）
- **Rust**（`rustup` 安装，含 cargo）——Tauri 必需
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Node.js 22+** 与 npm
- Xcode Command Line Tools（`xcode-select --install`）

### Windows（构建 Windows 安装包，必需）
> ⚠️ **最大坑**：Tauri 在 Windows 上用 MSVC 工具链编译，机器必须装好 C++ 编译器，
> 否则 `cargo build` 报 “linker `link.exe` not found”。
1. **Visual Studio 生成工具 2022**（或 VS2022 社区版），安装时勾选
   **“使用 C++ 的桌面开发”** 工作负载（含 MSVC v14x、Windows 10/11 SDK）。
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
2. **Node.js 22+** 与 npm。
3. **Rust**（默认装 `stable-msvc` 工具链，正好对应 Windows）：
   ```powershell
   winget install Rust.Rustup
   ```
4. 构建机需联网：下载 Rust crate、WebView2 SDK（链接用）、WiX / NSIS 打包工具。

## 常用命令

```bash
npm install              # 安装全部依赖（vue/vite/tauri CLI）
npm run dev              # 前端开发模式（Vite dev server，http://localhost:1420）
npm run tauri dev        # 桌面开发模式（自动执行 beforeDevCommand: npm run dev + Tauri 窗口）
npm run tauri build      # 构建 .app（macOS）/ msi+nsis（Windows），干净完成、不碰 dmg
                          #   macOS → src-tauri/target/release/bundle/macos/LockPass.app
                          #   Windows → src-tauri/target/release/bundle/{msi, nsis}
npm run make-dmg         # (仅 macOS) 用 hdiutil 生成 .dmg（绕过 create-dmg 的 AppleScript 限制）
                          #   → src-tauri/target/release/bundle/dmg/LockPass_<版本>_aarch64.dmg
npm run icons            # 用 app-icon.png 经 `tauri icon` 重新生成全套图标
npm run version:set      # 升级版本号（真源 package.json + tauri.conf.json，同步派生物）
npm run version:check    # 校验版本号一致性
```

> **遗留脚本说明**：`scripts/copy-frontend.mjs` 现为 `vite build` 的兼容壳（仅为 GitHub Actions
> 既有调用点保留，实际执行 `npm run vite:build`）；`scripts/serve.mjs`（旧静态服务器）已不再被
> 任何命令引用，可删除。两者均不影响当前构建链路。

## Windows 构建（重要约束）

**Tauri 无法从 macOS 交叉编译 Windows 安装包**（依赖 MSVC + WebView2），必须在 Windows 上构建。
已提供 GitHub Actions 工作流：

### `.github/workflows/release.yml` — 发布自动打包

- 触发：推 `v*` 标签（如 `v1.0.2`），或 Actions 页面手动 `workflow_dispatch`
- `windows-latest` → NSIS(.exe) + MSI(.msi)
- `macos-latest`（arm64 原生）→ `.app` zip + `.dmg`（`npm run make-dmg`，hdiutil）
- 产物先传 Actions Artifact，再上传到 **Draft Release**，人工确认后 Publish
- macOS 产物为 ad-hoc 签名（未配证书），用户首次打开需右键 → 打开；Windows 有 SmartScreen 提示

### `.github/workflows/pages.yml` — 在线版部署 GitHub Pages

- 触发：`main` 分支推送 或 `workflow_dispatch`
- `npm ci` → `node scripts/copy-frontend.mjs`（内部执行 `npm run vite:build`）→ 部署 `dist/` 到 Pages
- 访问：`https://trexwb.github.io/lockPass/`（首次需在仓库 Settings → Pages → Source 选 GitHub Actions）
- 在线版与桌面版数据独立（浏览器 IndexedDB），可用 .vault 导入导出互通

## macOS 本地构建实测（2026-08-20）

- 工具链：Rust 1.97.1 (aarch64-apple-darwin) + Node 22 + Xcode CLT；首次 `cargo build` 约 **3m27s** 完成。
- `src-tauri/target/release/bundle/macos/LockPass.app` **生成成功**（Mach-O arm64，ad-hoc 签名），
  可在构建机直接运行。
- **`.dmg` 已与 `tauri build` 解耦**：Tauri 自带 create-dmg 的末尾 `osascript`（Finder AppleScript）美化步骤，在无 GUI / 无 Finder 自动化授权的环境（CI、远程、部分本地终端）必失败（报错 “failed to run bundle_dmg.sh”）。为此 `bundle.targets` 已设为 `["app","msi","nsis"]`（macOS 只出 `.app`），dmg 改由 `npm run make-dmg`（`scripts/make-dmg.sh`，纯 `hdiutil`、无 AppleScript）生成：`src-tauri/target/release/bundle/dmg/LockPass_<版本>_aarch64.dmg`（已挂载验证）。这样 `tauri build` 在任意环境都能干净跑完。
- 分发到其他 Mac 需 **Apple Developer ID 签名 + 公证**（CI 已预留 `APPLE_*` Secrets，配置后启用）。

## 安全 / 发布说明

- **CSP 已启用**：`app.security.csp` 为严格策略（`default-src 'self'`，脚本仅 `'self'`，样式允许
  `'unsafe-inline'`，图片允许 `data:/blob:`，connect 仅 `'self' ipc: http://ipc.localhost`）。
  Vue 3 迁移后不再有内联事件处理器，CSP 可安全收紧。
- `withGlobalTauri: true` 会把 API 暴露到 `window.__TAURI__` 全局，任何页面脚本均可调用 `invoke`。
  同进程本地应用可接受，知悉即可。
- **系统拖放导入已禁用（为保构建一次过）**：`capabilities/default.json` 中未授予
  `core:webview:allow-on-drag-drop-event`（该权限名跨版本有差异，写错会让 `tauri build`
  在能力编译阶段失败）。按钮导入（`<input type=file>`，Tauri 原生可用）完全正常。
  如需「从系统拖文件进窗口」：在 `default.json` 的 `permissions` 数组加回该行即可，
  `src/core/tauri-bridge.js` 中已有对应注册代码（带 try/catch 容错）。
- `fs` 能力范围设为 `**`（任意路径读写），仅用于响应用户主动的「保存/打开」对话框，符合预期。
- **macOS 未签名构建**：本地 `tauri build` 为 ad-hoc 签名，仅能在构建机运行；分发到其他 Mac 需
  Apple Developer ID 签名 + 公证。CI 已预留 `APPLE_*` Secrets，配置后自动启用公证。
- **Windows 未签名**：默认无签名，部分系统会弹出 SmartScreen 警告，属正常；如需去警告需代码签名证书。
