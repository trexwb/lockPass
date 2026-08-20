# LockPass 桌面封装（Tauri v2）

将原本纯浏览器的 LockPass 密码保险箱打包为 Windows / macOS 原生桌面应用。
数据仍 100% 本地存储（IndexedDB），**不联网**；浏览器版与桌面版共用同一套前端文件。

## 架构要点

- **零打包器**：通过 `tauri.conf.json` 的 `app.withGlobalTauri: true`，Tauri 把 JS API 注入
  `window.__TAURI__.core.invoke`，前端直接调用 `plugin:dialog|save`、`plugin:fs|write_text_file`、
  `plugin:clipboard-manager|write_text` 等命令，**无需 Vite / webpack**。
- **桥接层** `js/tauri-bridge.js`：仅在检测到 `window.__TAURI__` 时生效，覆盖
  `Utils.downloadFile`（导出→系统保存框+写文件，返回 boolean）与 `navigator.clipboard`（复制→剪贴板插件）。
  **浏览器环境下自动降级原生 API，Web 版零改动。**
- **前端资源隔离**：浏览器版真源仍在仓库根目录 `index.html` + `css/` + `js/` + `assets/`；
  `tauri.conf.json` 的 `build.frontendDist` 设为 `"../dist"`（相对 `src-tauri/`），
  构建前由 `build.beforeBuildCommand: "node scripts/copy-frontend.mjs"` 把上述文件拷贝到 `dist/`。
  这样既满足 Tauri「frontendDist 不能包含 src-tauri/node_modules」的校验，又不改动 Web 版。
- 导入：沿用原 `<input type=file>`（Tauri v2 原生可用）；系统拖放导入已禁用（见下）。
- `IndexedDB` / `Web Crypto`：Tauri webview 原生支持，`main.js` 的 `isSecureContext` 检查
  在 `tauri://localhost` 下为 `true`，正常通过。
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
npm install              # 仅安装 @tauri-apps/cli
npm run tauri dev        # 开发模式（Node 静态服务器 scripts/serve.mjs + Tauri 窗口）
npm run tauri build      # 构建 .app（macOS）/ msi+nsis（Windows），干净完成、不碰 dmg
                          #   macOS → src-tauri/target/release/bundle/macos/LockPass.app
                          #   Windows → src-tauri/target/release/bundle/{msi, nsis}
npm run make-dmg         # (仅 macOS) 用 hdiutil 生成 .dmg（绕过 create-dmg 的 AppleScript 限制）
                          #   → src-tauri/target/release/bundle/dmg/LockPass_<版本>_aarch64.dmg
                          #   Windows → src-tauri/target/release/bundle/{msi, nsis}
node scripts/copy-frontend.mjs   # 仅把 Web 资源拷贝到 dist/（构建前自动跑，一般无需手动）
node scripts/gen-icons.mjs       # 用 app-icon.png 重新生成全套图标（纯 Node，无需 Rust）
npm run icons            # 用 app-icon.png 经 `tauri icon` 重新生成全套图标
```

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
- `node scripts/copy-frontend.mjs` 生成 dist/（纯 Node，零依赖安装）→ 部署到 Pages
- 访问：`https://trexwb.github.io/lockPass/`（首次需在仓库 Settings → Pages → Source 选 GitHub Actions）
- 在线版与桌面版数据独立（浏览器 IndexedDB），可用 .vault 导入导出互通

## macOS 本地构建实测（2026-08-20）

- 工具链：Rust 1.97.1 (aarch64-apple-darwin) + Node 22 + Xcode CLT；首次 `cargo build` 约 **3m27s** 完成。
- `src-tauri/target/release/bundle/macos/LockPass.app` **生成成功**（Mach-O arm64，ad-hoc 签名），
  可在构建机直接运行。
- **`.dmg` 已与 `tauri build` 解耦**：Tauri 自带 create-dmg 的末尾 `osascript`（Finder AppleScript）美化步骤，在无 GUI / 无 Finder 自动化授权的环境（CI、远程、部分本地终端）必失败（报错 “failed to run bundle_dmg.sh”）。为此 `bundle.targets` 已设为 `["app","msi","nsis"]`（macOS 只出 `.app`），dmg 改由 `npm run make-dmg`（`scripts/make-dmg.sh`，纯 `hdiutil`、无 AppleScript）生成：`src-tauri/target/release/bundle/dmg/LockPass_<版本>_aarch64.dmg`（已挂载验证）。这样 `tauri build` 在任意环境都能干净跑完。
- 分发到其他 Mac 需 **Apple Developer ID 签名 + 公证**（CI 已预留 `APPLE_*` Secrets，配置后启用）。

## 安全 / 发布说明

- `app.security.csp` 设为 `null`（不启用 CSP）。原因：原应用大量使用内联 `onclick` 事件处理器、
  内联 SVG 与动态注入 HTML，启用严格 CSP 需较大重构。对纯本地离线密码管理器影响有限，
  但如需上架分发，建议后续迁移为事件委托 + 非内联处理器以启用 CSP。
- `withGlobalTauri: true` 会把 API 暴露到 `window.__TAURI__` 全局，任何页面脚本均可调用 `invoke`。
  同进程本地应用可接受，知悉即可。
- **系统拖放导入已禁用（为保构建一次过）**：`capabilities/default.json` 中未授予
  `core:webview:allow-on-drag-drop-event`（该权限名跨版本有差异，写错会让 `tauri build`
  在能力编译阶段失败）。按钮导入（`<input type=file>`，Tauri 原生可用）完全正常。
  如需「从系统拖文件进窗口」：在 `default.json` 的 `permissions` 数组加回该行即可，
  `js/tauri-bridge.js` 中已有对应注册代码（带 try/catch 容错）。
- `fs` 能力范围设为 `**`（任意路径读写），仅用于响应用户主动的「保存/打开」对话框，符合预期。
- **macOS 未签名构建**：本地 `tauri build` 为 ad-hoc 签名，仅能在构建机运行；分发到其他 Mac 需
  Apple Developer ID 签名 + 公证。CI 已预留 `APPLE_*` Secrets，配置后自动启用公证。
- **Windows 未签名**：默认无签名，部分系统会弹出 SmartScreen 警告，属正常；如需去警告需代码签名证书。
