# LockPass 生物识别解锁（Passkey · macOS 单端 MVP）

> 版本基线：v1.0.1（项目版本整体重置至 v1.0.0 后，随功能修复 PATCH 自增） | 更新日期：2026-10-08（v1.1.3 生物识别启用失败修复后同步）

「方案 A：设备生物识别解锁」—— 允许在 macOS 桌面端用系统生物识别（面容 ID / 触控 ID）代替主密码解锁本机保险箱。**主密码仍为根信任**：生物识别只是本机解锁的便利通道，不引入新的信任根；生物验证失败或取消时随时可改用主密码解锁（走的是另一条链路，不是私钥的密码回退）。

## 架构要点

- **Rust 命令面**（`src-tauri/src/passkey.rs`，lib.rs 注册 4 个 command）：
  - `passkey_status`：返回 `{ available, enabled }`（macOS 桌面恒 available；enabled 需 Keychain item + guard 文件同时存在）。
  - `passkey_enroll`：启用。新建 Secure Enclave ECIES 密钥对（私钥持久化写入数据保护钥匙串），用公钥加密调用方传入的 32 字节 Vault Key（主密码按保险箱同一 salt/iterations 派生的原始字节，仅内存传递）后写入 guard 文件 `passkey_guard.json`。本模块不另生成随机 Device Key，被封装对象就是 Vault Key 本身。
  - `passkey_unlock`：解锁。以 Keychain 内私钥解密 guard——`PrivateKeyUsage` 使这一步由 Secure Enclave 自行弹出系统生物验证（面容 / 触控，**无系统密码回退**），验证通过才释放私钥；返回 Vault Key hex 供前端内存还原会话密钥。
  - `passkey_remove`：停用。删除 Keychain item + guard 文件，不触碰保险箱数据。
- **前端桥**（`src/core/passkey-bridge.js`）：`window.LockPasskey`（`status/enroll/unlock/remove`），main.js 注册；`isDesktopMac` 判定仅在 Tauri macOS 挂载。错误统一解析 `LKPK:<CODE>:<detail>` 为 `{ ok, code, detail }`。
- **解锁链路**（`useVault.handleBiometricUnlock`）：Rust 解锁 → 前端 `importRawAesKey`（extractable=false，仅内存）→ 解密保险箱主数据 → 与 `handleUnlock` 解锁分支同一语义。**生物会话不写入 sessionPassword**：锁屏 / 登出后内存密钥随既有 lockVault/logout 清理语义清空；依赖主密码的功能（QR 分享 / 导入等）会提示先以主密码解锁。
- **UI**：
  - `AuthView.vue`：已启用（available && enabled）时显示「生物识别解锁」按钮。
  - `SettingsModal.vue`（设置 → 安全）：macOS 桌面显示「生物识别解锁」开关。启用仅限当前主密码已解锁会话（用会话主密码 + 保险箱同一 salt/iterations 派生 32B Vault Key raw，仅内存传递）；停用不要求主密码。
- **i18n**：`lock.bioUnlock`、`vault.lock.errBio.*`、`settings.security.bio*/bioErr.*`，zh/en 均已补齐。

## 安全模型与约束

- Keychain item：`kSecAttrTokenID = com.apple.setoken`（Secure Enclave）、`kSecAttrSynchronizable = false`（仅本机，不进 iCloud）、`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`、数据保护钥匙串（`kSecUseDataProtectionKeychain = true`）。
- 访问控制：`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`（= `1<<3 | 1<<30`）。**不可叠加 `kSecAccessControlUserPresence`**：Apple 侧只允许它与 `ApplicationPassword / PrivateKeyUsage` 组合，与 `BiometryCurrentSet` 同时给出直接返回 OSStatus -50（本机实测）。
- 私钥属性布局：标签、`kSecAttrApplicationTag`、访问控制、`kSecAttrIsPermanent = true` 一律放进 `kSecPrivateKeyAttrs` 子字典（Apple 文档布局）。写在顶层不属文档化布局，最坏情况是私钥没带上访问控制而使用不再要求生物验证；缺 `kSecAttrIsPermanent` 则 item 不持久，`status.enabled` 恒 false、锁屏不出现生物入口。
- **签名前提**：写数据保护钥匙串要求 app 携带 `keychain-access-groups` entitlement（`src-tauri/entitlements.plist`）。ad-hoc / 未签名构建（`codesign -dv` 显示 `adhoc,linker-signed`、`TeamIdentifier=not set`）拿不到它，`SecKeyCreateRandomKey` 返回 `errSecMissingEntitlement(-34018)`，功能整体不可用；给 ad-hoc 二进制注入该 entitlement 会被内核 kill。故本功能只能在用 Apple 开发者证书签名的构建上启用与验证。
- guard 文件：0600 原子写（同目录临时文件 + rename），只含公钥加密后的密文（hex），不含任何明文密钥材料。
- **禁止静默降级**：未配置生物 / 用户取消 / 验证失败均返回结构化错误（`USER_CANCELED` / `AUTH_FAILED` / `KEYCHAIN_ERR` / `ENTITLEMENT_ERR` 等），前端回退主密码输入或展示错误文案；不会在生物失败后自动跳过校验。设置里的失败 toast 附带 Rust 侧 `detail`，不再只剩「加密操作失败」。
- **Key mismatch 处理**：若主密码已改 / 恢复数据后 guard 内密文与当前保险箱 Vault Key 失配，解锁报 `KEY_MISMATCH`，引导用主密码解锁后重新启用生物识别。
- **无明文落盘**：Vault Key 明文只存在于内存（Web Crypto 不可导出密钥）；enroll 时 32 字节 raw 以 hex 参数经 IPC 传入 Rust，用完即弃，不写 WebView/JS 持久存储。

## 边界（MVP 未做项）

- 仅 macOS 桌面；Windows / Linux 返回 `UNSUPPORTED`（非 macOS 分支编译为 stub），Web 版不显示入口。
- 未签名（ad-hoc）开发构建不能启用生物识别，`passkey_enroll` 明确返回 `ENTITLEMENT_ERR`；不是「稍后再试」类瞬时错误，需签名构建。
- `kSecAccessControlBiometryCurrentSet` 意味着重新录入生物特征后需重新启用（旧 item 在新指纹集合下不可用属预期行为）。
- 修改主密码后生物记录不自动跟随更新（见 Key mismatch 处理）。

## 验证

- `cargo check` 0 error / 0 warning
- `vite build` 0 error（72 modules，含 usePasskey composable）
- 代码审查修复：补 `SvgIcons.shield` 方法（原生物解锁按钮引用不存在图标致渲染崩溃）；抽 `usePasskey` 统一状态查询与平台判定。
- 版本号随项目整体重置后自增至 v1.0.1；未执行任何 git 操作。
- 2026-10-08（v1.1.3）本机直调 Security 框架实测：三标志叠加返回 -50；去掉 `userPresence` 后访问控制对象创建成功；`kSecPrivateKeyAttrs` 嵌套布局被接受，失败点仅剩 -34018（未签名环境的 entitlement）。同机 `security find-identity -v -p codesigning` = 0 valid identities，故 **enroll → 生物验证 → unlock 全链尚未在任何签名构建上端到端跑通**，需在 Apple 开发者证书签名的构建上回归（启用一次 → 锁屏出现生物入口 → 生物验证解密 → `status.enabled` 为 true）。
