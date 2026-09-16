# LockPass Safari 扩展注册指南

> 面向后续开发者：将 LockPass 的 Chrome/Edge Manifest V3 扩展注册为 macOS Safari 浏览器扩展的完整操作文档。所有命令仅在 lockPass 目录内执行。

---

## 一、背景与原理

- `extension/` 目录是 Chrome/Edge 的 Manifest V3 扩展（`manifest_version` 3、`background.service_worker`、`action.popup`）。
- Safari **没有「加载已解压扩展」入口**，必须用 Xcode 的 `safari-web-extension-converter` 将扩展转成「宿主 App + Safari Extension target」工程。
- 注册原理：宿主 App 的 `Info.plist` 声明 `NSExtensionPointIdentifier=com.apple.Safari.web-extension`，**运行一次宿主 App** 即完成向 Safari 的注册；随后到 Safari → 设置 → 扩展中勾选启用。

---

## 二、前置条件（缺失会静默失败）

> 以下任一步缺失，转换器可能不报错但也不产出文件，务必逐项确认。

| # | 命令 | 说明 |
|---|------|------|
| 1 | 安装完整 Xcode | 仅安装 Command Line Tools **不含**转换器，必须装完整 Xcode |
| 2 | `sudo xcodebuild -license accept` | 接受 Xcode 许可，**必须 sudo** |
| 3 | `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` | 把开发目录指向完整 Xcode（避免误指向 CLT） |
| 4 | `xcodebuild -runFirstLaunch` | 补全 Xcode 首次启动组件 |
| 5 | `xcrun safari-web-extension-converter --help` | 验证：能看到 `Usage` 即就绪 |

---

## 三、转换生成 Xcode 工程

在 lockPass 仓库根目录执行：

```bash
cd <lockPass 项目根目录>
xcrun safari-web-extension-converter extension \
  --app-name "LockPass" \
  --bundle-identifier "com.trexwb.lockpass.safari" \
  --project-location .
```

生成结果：`LockPass/LockPass.xcodeproj`（含 macOS (App)/(Extension) 与 iOS 两套 target，**桌面注册只用 macOS 那套**）。

---

## 四、Xcode 构建运行

1. `open LockPass/LockPass.xcodeproj` 打开工程。
2. Scheme 选择 **LockPass**（macOS 的，**别选 iOS**）。
3. 设备下拉选择 **My Mac**（不能选 Generic macOS，否则只能编译不能运行）。
4. TARGETS 里 `LockPass` 与 `LockPass Extension` 两个 target 的 Signing & Capabilities → **Team 都设 None**（即 Sign to Run Locally，无需 Apple ID）。
5. `⌘R` 运行，宿主 App 启动即完成注册（App 窗口提示扩展关闭状态属正常现象）。

---

## 五、Safari 启用

1. Safari → 设置 → 扩展 → 左侧出现 **LockPass** → 勾选启用。
2. 如需 `file://` 本地版通信，勾选「**允许访问文件网址**」。
3. 未签名扩展需额外开启开发者开关：
   - Safari → 设置 → 高级 → 勾选「**显示网页开发者功能**」
   - 菜单栏「开发」→ 勾选「**允许未签名扩展**」
   - **完全退出 Safari 重开**（`⌘Q`，不是关窗口）

---

## 六、常见坑排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 转换器执行后不报错也无文件生成 | Xcode 许可未接受 / `xcode-select` 指向 CLT / 系统内容未 init | 依次执行前置条件 2-4 |
| A build only device cannot be used to run this target | 设备选了 Generic macOS（只能编译） | 设备下拉改选 **My Mac** |
| 宿主 App 正常启动但 Safari 扩展列表不显示 | 扩展虽已注册（pluginkit 可见）但 Safari 未刷新 / 签名问题 | ① 完全退出重启 Safari；② 重签：`codesign --force --deep --sign - <LockPass.app路径>` + `pluginkit -a <LockPass.app路径>` + 重新 open 宿主 App + 再重启 Safari；③ 开发调试可临时用 Safari → 设置 → 开发者 →「添加临时扩展...」直接加载 `extension/manifest.json`（重启 Safari 后临时扩展会消失，仅调试用） |
| 验证是否注册成功 | — | `pluginkit -m -p com.apple.Safari.web-extension` 应能看到 `com.trexwb.lockpass.safari.Extension` |

---

## 七、验证方法

- **注册验证**：

  ```bash
  pluginkit -m -p com.apple.Safari.web-extension
  ```

  输出中应能看到 `com.trexwb.lockpass.safari.Extension`。

- **启用验证**：Safari → 设置 → 扩展 → 左侧出现 LockPass 且开关为开启状态；在目标网页点击扩展图标可正常弹出 popup。

---

## 八、对外分发

本地 Sign to Run Locally 只供本机调试；分发给用户需：

1. 加入 **Apple Developer Program**；
2. 配置 App ID / Entitlements；
3. 签名后**公证**（`notarytool`）；
4. 可上架 **Mac App Store**，或发布「签名 + 公证」的 dmg。
*（内容由AI生成，仅供参考）*
