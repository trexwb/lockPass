# LockPass 生物识别解锁（Passkey · macOS 单端 MVP）

> 版本基线：v1.0.1（项目版本整体重置至 v1.0.0 后，随功能修复 PATCH 自增） | 更新日期：2026-09-02

「方案 A：设备生物识别解锁」—— 允许在 macOS 桌面端用系统生物识别（面容 ID / 触控 ID，或系统密码回退）代替主密码解锁本机保险箱。**主密码仍为根信任**：生物识别只是本机解锁的便利通道，不引入新的信任根。

## 架构要点

- **Rust 命令面**（`src-tauri/src/passkey.rs`，lib.rs 注册 4 个 command）：
  - `passkey_status`：返回 `{ available, enabled }`（macOS 桌面恒 available；enabled 需 Keychain item + guard 文件同时存在）。
  - `passkey_enroll`：启用。生成 Secure Enclave ECIES 密钥对存入 macOS Keychain，再用公钥加密 32 字节随机 Device Unlock Key（调用方传入的 Vault Key hex，实为保险箱当前 Vault Key 的原始字节）后写入 guard 文件 `passkey_guard.json`。
  - `passkey_unlock`：解锁。以 Keychain 内私钥解密 guard——此步会触发系统生物验证（Touch ID / 面容 / 密码回退），验证通过才释放私钥；返回 Device Key hex 供前端内存还原 Vault Key。
  - `passkey_remove`：停用。删除 Keychain item + guard 文件，不触碰保险箱数据。
- **前端桥**（`src/core/passkey-bridge.js`）：`window.LockPasskey`（`status/enroll/unlock/remove`），main.js 注册；`isDesktopMac` 判定仅在 Tauri macOS 挂载。错误统一解析 `LKPK:<CODE>:<detail>` 为 `{ ok, code, detail }`。
- **解锁链路**（`useVault.handleBiometricUnlock`）：Rust 解锁 → 前端 `importRawAesKey`（extractable=false，仅内存）→ 解密保险箱主数据 → 与 `handleUnlock` 解锁分支同一语义。**生物会话不写入 sessionPassword**：锁屏 / 登出后内存密钥随既有 lockVault/logout 清理语义清空；依赖主密码的功能（QR 分享 / 导入等）会提示先以主密码解锁。
- **UI**：
  - `AuthView.vue`：已启用（available && enabled）时显示「生物识别解锁」按钮。
  - `SettingsModal.vue`（设置 → 安全）：macOS 桌面显示「生物识别解锁」开关。启用仅限当前主密码已解锁会话（用会话主密码 + 保险箱同一 salt/iterations 派生 32B Vault Key raw，仅内存传递）；停用不要求主密码。
- **i18n**：`lock.bioUnlock`、`vault.lock.errBio.*`、`settings.security.bio*/bioErr.*`，zh/en 均已补齐。

## 安全模型与约束

- Keychain item：`kSecAttrTokenID = com.apple.setoken`（Secure Enclave）、`kSecAttrSynchronizable = false`（仅本机，不进 iCloud）、访问控制 `kSecAccessControlUserPresence | kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`、`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`、数据保护钥匙串（`kSecUseDataProtectionKeychain = true`）。
- guard 文件：0600 原子写（同目录临时文件 + rename），只含公钥加密后的密文（hex），不含任何明文密钥材料。
- **禁止静默降级**：未配置生物 / 用户取消 / 验证失败均返回结构化错误（`USER_CANCELED` / `AUTH_FAILED` / `KEYCHAIN_ERR` 等），前端回退主密码输入或展示错误文案；不会在生物失败后自动跳过校验。
- **Key mismatch 处理**：若主密码已改 / 恢复数据后 guard 内 Device Key 与当前保险箱 Vault Key 失配，解锁报 `KEY_MISMATCH`，引导用主密码解锁后重新启用生物识别。
- **无明文落盘**：Vault Key / Device Key 明文只存在于内存（Web Crypto 不可导出密钥）；enroll 时 32 字节 raw 以 hex 参数经 IPC 传入 Rust，用完即弃，不写 WebView/JS 持久存储。

## 边界（MVP 未做项）

- 仅 macOS 桌面；Windows / Linux 返回 `UNSUPPORTED`（非 macOS 分支编译为 stub），Web 版不显示入口。
- `kSecAccessControlBiometryCurrentSet` 意味着重新录入生物特征后需重新启用（旧 item 在新指纹集合下不可用属预期行为）。
- 修改主密码后生物记录不自动跟随更新（见 Key mismatch 处理）。

## 验证

- `cargo check` 0 error / 0 warning
- `vite build` 0 error（72 modules，含 usePasskey composable）
- 代码审查修复：补 `SvgIcons.shield` 方法（原生物解锁按钮引用不存在图标致渲染崩溃）；抽 `usePasskey` 统一状态查询与平台判定。
- 版本号随项目整体重置后自增至 v1.0.1；未执行任何 git 操作。
