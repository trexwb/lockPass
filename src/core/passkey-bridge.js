/* ═══════════════════════════════════════════════════════════════════
   LockPass — 生物识别解锁桥（Passkey，macOS 单端 MVP）
   ───────────────────────────────────────────────────────────────────
   方案 A：设备生物识别解锁（Secure Enclave 封装 Vault Key）
   本模块仅负责 Tauri 桌面命令（passkey_status/enroll/unlock/remove）
   的前端委托与结构化错误归一，不持有任何密钥材料：
     • enroll(vaultKeyHex)：把主密码会话派生的 32B Vault Key 交给 Rust，
       Rust 以 Keychain 内 Secure Enclave 公钥加密后写 guard 文件；
     • unlock()：触发系统生物验证，返回解密后的 Device Key hex，
       由调用方（useVault）仅在内存还原 Web Crypto 会话密钥；
     • remove()：删除 Keychain item 与 guard 文件；
     • status()：查询本机支持性与启用状态。
   非 macOS / 浏览器环境一律返回 available:false，UI 隐藏入口。
   失败统一映射为 { ok:false, code, detail }，code 供 i18n 文案选择，
   禁止静默降级（生物验证失败绝不自动跳过安全校验）。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const LT = window.LockTauri || {};
  const isTauri = !!LT.isTauri;
  const isMac = /mac/i.test(navigator.userAgent);
  const isDesktopMac = isTauri && isMac;

  /** 解析 Rust 结构化错误 "LKPK:<CODE>:<detail>" → { code, detail } */
  function parseError(e) {
    const raw = (e && (e.message || e)) || '';
    const m = /^LKPK:([A-Z_]+):(.*)$/s.exec(String(raw));
    if (m) return { code: m[1], detail: m[2] };
    return { code: 'UNKNOWN', detail: String(raw) };
  }

  /** 统一把 invoke 拒绝转成 { ok:false, code, detail } */
  async function call(name, args) {
    try {
      const out = await LT.invoke(name, args || {});
      if (out && typeof out === 'object' && out.ok === false) return out;
      return { ok: true, value: out };
    } catch (e) {
      const parsed = parseError(e);
      return { ok: false, code: parsed.code, detail: parsed.detail };
    }
  }

  window.LockPasskey = {
    /** 是否桌面 macOS（本功能唯一支持环境） */
    isDesktopMac: isDesktopMac,

    /** 状态查询：{ available, enabled }；失败视为不可用 */
    async status() {
      if (!isDesktopMac) return { available: false, enabled: false };
      const res = await call('passkey_status');
      if (!res.ok || !res.value) return { available: false, enabled: false };
      return { available: !!res.value.available, enabled: !!res.value.enabled };
    },

    /** 启用：传入主密码会话派生的 32B Vault Key hex */
    async enroll(vaultKeyHex) {
      if (!isDesktopMac) {
        return { ok: false, code: 'UNSUPPORTED', detail: 'biometric unlock requires macOS desktop' };
      }
      return call('passkey_enroll', { vaultKeyHex: String(vaultKeyHex || '') });
    },

    /** 解锁：系统生物验证 → 返回 Device Key hex（仅内存使用） */
    async unlock() {
      if (!isDesktopMac) {
        return { ok: false, code: 'UNSUPPORTED', detail: 'biometric unlock requires macOS desktop' };
      }
      return call('passkey_unlock');
    },

    /** 停用：删除 Keychain item 与 guard 文件 */
    async remove() {
      if (!isDesktopMac) {
        return { ok: false, code: 'UNSUPPORTED', detail: 'biometric unlock requires macOS desktop' };
      }
      return call('passkey_remove');
    },
  };
})();
