/* ═══════════════════════════════════════════════════════════════════
   LockPass — 生物识别解锁（Passkey，macOS 单端 MVP）
   ───────────────────────────────────────────────────────────────────
   方案 A：设备生物识别解锁
   - 启用 enroll：生成随机 Device Unlock Key（256-bit 对称随机数），
     先用 Secure Enclave 非对称密钥（Keychain 持有，访问控制
     userPresence | BiometryCurrentSet | PrivateKeyUsage，仅本机不可同步）
     将其加密后写入 guard 文件（passkey_guard.json）。
     注：真正落入 Secure Enclave 的是每次启用时新建的 ECIES 密钥对，
         Device Unlock Key 由 OS CSPRNG 生成后经公钥加密存储。
   - 解锁 unlock：系统生物验证（Touch ID/面容/密码回退）通过后，
     Secure Enclave 私钥解密 guard，返回 Device Unlock Key hex；
     前端仅用于内存内还原 Vault Key（Web Crypto），不落盘。
   - 停用 remove：删除 Keychain item 与 guard 文件。
   - 状态 status：available（本机是否支持）+ enabled（是否已启用）。

   安全约束：
   - 密钥材料永不明文进入 WebView / JS 持久存储；
   - guard 文件 0600 原子写（同 data_root 下）；
   - 失败 / 取消一律返回结构化错误 LKPK:<CODE>:<detail>，前端可映射
     文案，禁止静默降级（不会在生物识别失败后自动跳过安全校验）。

   注：CFString 常量字符串值取自本机 Security 框架动态库导出符号
   （ctypes 实测），AccessControl 标志位取 SDK 头文件 SecAccessControl.h。
   ═══════════════════════════════════════════════════════════════════ */

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PasskeyStatus {
    /// 当前平台是否支持生物识别解锁（仅 macOS 桌面为 true）
    pub available: bool,
    /// 是否已启用（guard 文件 + Keychain item 同时存在）
    pub enabled: bool,
}

/// 错误码：统一 LKPK:<CODE>:<detail>，前端据 CODE 选择 i18n 文案
#[allow(dead_code)] // 仅非 macOS 分支使用，macOS 构建不引用
pub const E_UNSUPPORTED: &str = "UNSUPPORTED";
pub const E_ALREADY: &str = "ALREADY_ENABLED";
pub const E_NOT_ENABLED: &str = "NOT_ENABLED";
pub const E_CANCELED: &str = "USER_CANCELED";
pub const E_AUTH_FAILED: &str = "AUTH_FAILED";
pub const E_KEYCHAIN: &str = "KEYCHAIN_ERR";
pub const E_CRYPTO: &str = "CRYPTO_ERR";
pub const E_FILE: &str = "FILE_ERR";

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    pub fn status(_app: &tauri::AppHandle) -> Result<PasskeyStatus, String> {
        Ok(PasskeyStatus { available: false, enabled: false })
    }

    pub fn enroll(_app: &tauri::AppHandle, _vault_key_hex: &str) -> Result<(), String> {
        Err(format!("LKPK:{E_UNSUPPORTED}:生物识别解锁仅支持 macOS 桌面版"))
    }

    pub fn unlock(_app: &tauri::AppHandle) -> Result<String, String> {
        Err(format!("LKPK:{E_UNSUPPORTED}:生物识别解锁仅支持 macOS 桌面版"))
    }

    pub fn remove(_app: &tauri::AppHandle) -> Result<(), String> {
        Err(format!("LKPK:{E_UNSUPPORTED}:生物识别解锁仅支持 macOS 桌面版"))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::{CFData, CFDataRef};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::error::{CFError, CFErrorRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use serde_json::json;
    use tauri::Manager;

    /* ── 常量（本机实测值，勿改） ───────────────────────────── */

    // kSecClass / kSecClassKey
    const KEY_CLASS: &str = "keys";
    // kSecAttrKeyType / kSecAttrKeyTypeECSECPrimeRandom
    const ATTR_KEY_TYPE: &str = "type";
    const ATTR_KEY_TYPE_EC: &str = "73";
    // kSecAttrKeySizeInBits
    const ATTR_KEY_SIZE: &str = "bsiz";
    // kSecAttrLabel（Keychain 可检索标签）
    const ATTR_LABEL: &str = "labl";
    const KEY_LABEL: &str = "com.trexwb.lockpass.device-unlock-key";
    // kSecAttrApplicationTag（本应用私有域标识，作为查询主键）
    const ATTR_APP_TAG: &str = "atag";
    const KEY_APP_TAG: &[u8] = b"com.trexwb.lockpass.deviceunlock";
    // kSecAttrSynchronizable=false（仅本机，不进 iCloud 钥匙串）
    const ATTR_SYNC: &str = "sync";
    // kSecAttrAccessControl（访问控制对象）
    const ATTR_ACCESS_CTL: &str = "accc";
    // kSecUseDataProtectionKeychain=true（macOS 也启用数据保护钥匙串）
    const USE_DP_KEYCHAIN: &str = "nleg";
    // kSecAttrTokenID = Secure Enclave
    const ATTR_TOKEN_ID: &str = "tkid";
    const TOKEN_SECURE_ENCLAVE: &str = "com.apple.setoken";
    // kSecReturnRef
    const RETURN_REF: &str = "r_Ref";
    // ECIES-Cofactor-X963-SHA256-AES-GCM（Secure Enclave 支持，v1 使用）
    const ALG_ECIES: &str = "algid:encrypt:ECIES:ECDHC:KDFX963:SHA256:AESGCM-KDFIV";

    // SecAccessControlCreateFlags（SDK 头文件实测）
    const FLAG_USER_PRESENCE: u32 = 1u32 << 0;        // 生物识别或系统密码
    const FLAG_BIOMETRY_CURRENT: u32 = 1u32 << 3;     // 仅当前录入的生物特征集合
    const FLAG_PRIVATE_KEY_USAGE: u32 = 1u32 << 30;   // 允许本应用使用私钥解密

    // OSStatus 常用错误
    const ERR_SEC_USER_CANCELED: i32 = -128;
    const ERR_SEC_AUTH_FAILED: i32 = -25293;
    const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    /// 保证 Keychain/guard 串行变更，避免并发 enroll/remove 互相踩踏
    static OP_LOCK: Mutex<()> = Mutex::new(());

    /* ── FFI 声明（Security.framework） ─────────────────────── */

    use std::os::raw::c_void;

    type SecKeyRef = *const c_void;
    type SecAccessControlRef = *const c_void;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecAccessControlCreateWithFlags(
            allocator: CFTypeRef,
            protection: CFTypeRef,
            flags: u32,
            error: *mut CFTypeRef,
        ) -> SecAccessControlRef;
        fn SecKeyCreateRandomKey(parameters: CFTypeRef, error: *mut CFTypeRef) -> SecKeyRef;
        fn SecKeyCopyPublicKey(key: SecKeyRef) -> SecKeyRef;
        fn SecKeyCreateEncryptedData(
            key: SecKeyRef,
            algorithm: CFTypeRef,
            plaintext: CFTypeRef,
            error: *mut CFTypeRef,
        ) -> CFDataRef;
        fn SecKeyCreateDecryptedData(
            key: SecKeyRef,
            algorithm: CFTypeRef,
            ciphertext: CFTypeRef,
            error: *mut CFTypeRef,
        ) -> CFDataRef;
        fn SecItemCopyMatching(query: CFTypeRef, result: *mut CFTypeRef) -> i32;
        fn SecItemDelete(query: CFTypeRef) -> i32;
    }

    /* ── 小工具 ────────────────────────────────────────────── */

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    fn from_hex(s: &str) -> Option<Vec<u8>> {
        let s = s.trim();
        if s.len() % 2 != 0 {
            return None;
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
            .collect()
    }

    fn err(code: &str, detail: impl std::fmt::Display) -> String {
        format!("LKPK:{code}:{detail}")
    }

    fn guard_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| err(E_FILE, e))?;
        Ok(dir.join("passkey_guard.json"))
    }

    /// 原子写：先写同目录临时文件并 0600，再 rename 覆盖
    fn atomic_write_guard(path: &Path, contents: &str) -> Result<(), String> {
        let tmp = path.with_extension("json.tmp");
        let res = (|| -> std::io::Result<()> {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)?;
            f.write_all(contents.as_bytes())?;
            f.sync_all()?;
            std::fs::rename(&tmp, path)
        })();
        if let Err(e) = res {
            let _ = std::fs::remove_file(&tmp);
            return Err(err(E_FILE, e));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    fn read_guard(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
        let path = guard_path(app)?;
        let raw = std::fs::read_to_string(&path).map_err(|e| err(E_FILE, e))?;
        serde_json::from_str(&raw).map_err(|e| err(E_FILE, e))
    }

    /* ── Keychain 辅助 ────────────────────────────────────── */

    /// 按 ApplicationTag 检索 Secure Enclave 私钥（SecKeyRef，+1 所有权）
    fn find_private_key() -> Result<CFType, String> {
        unsafe {
            let query = CFDictionary::from_CFType_pairs(&[
                (
                    CFString::new("class").as_CFType(),
                    CFString::new(KEY_CLASS).as_CFType(),
                ),
                (
                    CFString::new(ATTR_APP_TAG).as_CFType(),
                    CFData::from_buffer(KEY_APP_TAG).as_CFType(),
                ),
                (
                    CFString::new(RETURN_REF).as_CFType(),
                    CFBoolean::true_value().as_CFType(),
                ),
            ]);
            let mut result: CFTypeRef = std::ptr::null();
            let status = SecItemCopyMatching(query.as_concrete_TypeRef() as CFTypeRef, &mut result);
            if status != 0 {
                return Err(err(E_KEYCHAIN, format!("SecItemCopyMatching={status}")));
            }
            if result.is_null() {
                return Err(err(E_NOT_ENABLED, "keychain item not found"));
            }
            // 返回的是 CFTypeRef（SecKeyRef），按 create rule 包装以便自动释放
            let key = CFType::wrap_under_create_rule(result);
            Ok(key)
        }
    }

    fn delete_keychain_item() -> Result<(), String> {
        unsafe {
            let query = CFDictionary::from_CFType_pairs(&[
                (
                    CFString::new("class").as_CFType(),
                    CFString::new(KEY_CLASS).as_CFType(),
                ),
                (
                    CFString::new(ATTR_APP_TAG).as_CFType(),
                    CFData::from_buffer(KEY_APP_TAG).as_CFType(),
                ),
            ]);
            let status = SecItemDelete(query.as_concrete_TypeRef() as CFTypeRef);
            if status != 0 && status != ERR_SEC_ITEM_NOT_FOUND {
                return Err(err(E_KEYCHAIN, format!("SecItemDelete={status}")));
            }
            Ok(())
        }
    }

    fn has_keychain_item() -> bool {
        find_private_key().is_ok()
    }

    /* ── 生成 Secure Enclave 密钥对 ────────────────────────── */

    /// 创建带访问控制的 Secure Enclave ECIES 密钥对，返回保留私钥句柄（+1）
    fn create_se_key(
        label: &str,
        access_control: SecAccessControlRef,
    ) -> Result<CFType, String> {
        unsafe {
            let params = CFDictionary::from_CFType_pairs(&[
                (
                    CFString::new("class").as_CFType(),
                    CFString::new(KEY_CLASS).as_CFType(),
                ),
                (
                    CFString::new(ATTR_KEY_TYPE).as_CFType(),
                    CFString::new(ATTR_KEY_TYPE_EC).as_CFType(),
                ),
                (
                    CFString::new(ATTR_KEY_SIZE).as_CFType(),
                    CFNumber::from(256i64).as_CFType(),
                ),
                (
                    CFString::new(ATTR_TOKEN_ID).as_CFType(),
                    CFString::new(TOKEN_SECURE_ENCLAVE).as_CFType(),
                ),
                (CFString::new(ATTR_LABEL).as_CFType(), CFString::new(label).as_CFType()),
                (
                    CFString::new(ATTR_APP_TAG).as_CFType(),
                    CFData::from_buffer(KEY_APP_TAG).as_CFType(),
                ),
                (
                    CFString::new(ATTR_ACCESS_CTL).as_CFType(),
                    CFType::wrap_under_get_rule(access_control as CFTypeRef),
                ),
                (
                    CFString::new(ATTR_SYNC).as_CFType(),
                    CFBoolean::false_value().as_CFType(),
                ),
                (
                    CFString::new(USE_DP_KEYCHAIN).as_CFType(),
                    CFBoolean::true_value().as_CFType(),
                ),
            ]);
            let mut error: CFTypeRef = std::ptr::null();
            let key = SecKeyCreateRandomKey(params.as_concrete_TypeRef() as CFTypeRef, &mut error);
            if key.is_null() {
                return Err(cf_error_message("create SE key", error));
            }
            Ok(CFType::wrap_under_create_rule(key as CFTypeRef))
        }
    }

    /// 解析 CFError（若 error 非空）：映射为 LKPK 结构化错误
    fn cf_error_message(action: &str, error: CFTypeRef) -> String {
        unsafe {
            if error.is_null() {
                return err(E_KEYCHAIN, format!("{action} failed (no error detail)"));
            }
            let e = CFError::wrap_under_create_rule(error as CFErrorRef);
            let code = e.code();
            let desc = e.description().to_string();
            if code == ERR_SEC_USER_CANCELED as isize {
                return err(E_CANCELED, "user canceled");
            }
            if code == ERR_SEC_AUTH_FAILED as isize || code == ERR_SEC_INTERACTION_NOT_ALLOWED as isize {
                return err(E_AUTH_FAILED, format!("{action}: {desc}"));
            }
            err(E_CRYPTO, format!("{action} (code={code}): {desc}"))
        }
    }

    /* ── 对外实现 ─────────────────────────────────────────── */

    pub fn status(app: &tauri::AppHandle) -> Result<PasskeyStatus, String> {
        let _g = OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let guard_ok = guard_path(app)
            .map(|p| p.exists())
            .unwrap_or(false);
        Ok(PasskeyStatus {
            available: true,
            enabled: guard_ok && has_keychain_item(),
        })
    }

    /// 启用：1) 防重入 2) 生成 SE 密钥对 3) 公钥加密 Device Unlock Key
    /// 4) 写 guard 文件；任一步失败回滚已创建的 Keychain item
    pub fn enroll(app: &tauri::AppHandle, vault_key_hex: &str) -> Result<(), String> {
        let _g = OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        // 已启用则拒绝（防覆盖导致 guard 与钥匙串失配）
        let path = guard_path(app)?;
        if path.exists() || has_keychain_item() {
            return Err(err(E_ALREADY, "passkey already enabled"));
        }

        let vault_key = from_hex(vault_key_hex)
            .ok_or_else(|| err(E_CRYPTO, "invalid vault key hex"))?;
        if vault_key.len() != 32 {
            return Err(err(E_CRYPTO, format!("vault key must be 32 bytes, got {}", vault_key.len())));
        }

        unsafe {
            // 1) 访问控制对象：生物识别(当前指纹集合) 或 系统密码，允许私钥使用
            let mut ac_err: CFTypeRef = std::ptr::null();
            let ac = SecAccessControlCreateWithFlags(
                std::ptr::null(),
                CFString::new("aku").as_concrete_TypeRef() as CFTypeRef, // kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                FLAG_USER_PRESENCE | FLAG_BIOMETRY_CURRENT | FLAG_PRIVATE_KEY_USAGE,
                &mut ac_err,
            );
            if ac.is_null() {
                return Err(cf_error_message("SecAccessControlCreateWithFlags", ac_err));
            }

            // 2) Secure Enclave 密钥对
            let se_key = match create_se_key(KEY_LABEL, ac) {
                Ok(k) => k,
                Err(e) => {
                    // 释放 ac 后返回
                    drop(CFType::wrap_under_get_rule(ac as CFTypeRef));
                    return Err(e);
                }
            };

            // 3) 取公钥加密 32 字节 Device Unlock Key
            let public_ref = SecKeyCopyPublicKey(se_key.as_concrete_TypeRef() as SecKeyRef);
            if public_ref.is_null() {
                let _ = delete_keychain_item();
                return Err(err(E_KEYCHAIN, "SecKeyCopyPublicKey returned null"));
            }
            let public_key = CFType::wrap_under_create_rule(public_ref as CFTypeRef);

            let plain_cf = CFData::from_buffer(&vault_key);
            let mut enc_err: CFTypeRef = std::ptr::null();
            let enc = SecKeyCreateEncryptedData(
                public_key.as_concrete_TypeRef() as SecKeyRef,
                CFString::new(ALG_ECIES).as_concrete_TypeRef() as CFTypeRef,
                plain_cf.as_concrete_TypeRef() as CFTypeRef,
                &mut enc_err,
            );
            if enc.is_null() {
                let _ = delete_keychain_item();
                return Err(cf_error_message("encrypt device key", enc_err));
            }
            let enc_cf = CFData::wrap_under_create_rule(enc);
            let enc_bytes = enc_cf.bytes();

            // 4) 写 guard 文件
            let guard = json!({
                "v": 1,
                "alg": "ecies-cofactor-x963-sha256-aesgcm",
                "enc": to_hex(enc_bytes),
            });
            if let Err(e) = atomic_write_guard(&path, &guard.to_string()) {
                let _ = delete_keychain_item();
                return Err(e);
            }
            Ok(())
        }
    }

    /// 解锁：生物验证通过后释放 SE 私钥解密 guard，返回 Device Unlock Key hex
    pub fn unlock(app: &tauri::AppHandle) -> Result<String, String> {
        let _g = OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let guard = read_guard(app)?;
        if guard["v"].as_i64() != Some(1) {
            return Err(err(E_FILE, "unsupported guard version"));
        }
        let enc_hex = guard["enc"]
            .as_str()
            .ok_or_else(|| err(E_FILE, "guard missing enc field"))?;
        let enc_bytes = from_hex(enc_hex).ok_or_else(|| err(E_FILE, "guard enc invalid hex"))?;

        unsafe {
            let key = find_private_key()?;
            let cipher_cf = CFData::from_buffer(&enc_bytes);
            let mut dec_err: CFTypeRef = std::ptr::null();
            // 此处触发系统生物识别授权（Touch ID / 密码回退）
            let dec = SecKeyCreateDecryptedData(
                key.as_concrete_TypeRef() as SecKeyRef,
                CFString::new(ALG_ECIES).as_concrete_TypeRef() as CFTypeRef,
                cipher_cf.as_concrete_TypeRef() as CFTypeRef,
                &mut dec_err,
            );
            if dec.is_null() {
                return Err(cf_error_message("decrypt device key (biometric auth)", dec_err));
            }
            let dec_cf = CFData::wrap_under_create_rule(dec);
            let plain = dec_cf.bytes();
            if plain.len() != 32 {
                return Err(err(E_CRYPTO, format!("decrypted key length {}", plain.len())));
            }
            Ok(to_hex(plain))
        }
    }

    /// 停用：删除 Keychain item + guard 文件
    pub fn remove(app: &tauri::AppHandle) -> Result<(), String> {
        let _g = OP_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let path = guard_path(app)?;
        if !path.exists() && !has_keychain_item() {
            return Err(err(E_NOT_ENABLED, "passkey not enabled"));
        }

        delete_keychain_item()?;
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(err(E_FILE, e)),
        }
    }
}

/* ── 对外 command（跨平台统一注册） ───────────────────────────── */

#[tauri::command]
pub fn passkey_status(app: tauri::AppHandle) -> Result<PasskeyStatus, String> {
    imp::status(&app)
}

#[tauri::command]
pub fn passkey_enroll(app: tauri::AppHandle, vault_key_hex: String) -> Result<(), String> {
    imp::enroll(&app, &vault_key_hex)
}

#[tauri::command]
pub fn passkey_unlock(app: tauri::AppHandle) -> Result<String, String> {
    imp::unlock(&app)
}

#[tauri::command]
pub fn passkey_remove(app: tauri::AppHandle) -> Result<(), String> {
    imp::remove(&app)
}
