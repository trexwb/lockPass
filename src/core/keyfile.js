/* ═══════════════════════════════════════════════════════════════════
   LockPass — 密钥文件双因素模块（v1.1.1，window.KeyFileUtils）
   ───────────────────────────────────────────────────────────────────
   职责：.key 密钥文件的生成 / 解析 / 校验 / 指纹计算，不持有任何密钥材料；
   派生链路（PBKDF2(password ‖ keyFileBytes)）由 CryptoUtils 提供。
   文件格式（JSON 信封，便于校验与未来演进）：
     { "format": "LockPass-KeyFile v1", "key": "<base64 32B>" }
   安全边界：
     • 解锁时校验文件 SHA-256 指纹与 meta.kfFp 一致，防拿错文件；
     • 密钥文件丢失将无法解锁（离线加密无找回可能），启用前强制确认；
     • 指纹（哈希）可随 meta / 导出 / 同步文件存储，密钥本体绝不落盘。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const KEYFILE_FORMAT = 'LockPass-KeyFile v1';

  /**
   * 生成新密钥文件内容（32 字节 CSPRNG 随机数，JSON 信封）
   * @returns {{ text: string, bytes: Uint8Array, fingerprint: string }} 文件文本 / 原始字节 / SHA-256 指纹
   */
  async function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const text = JSON.stringify({ format: KEYFILE_FORMAT, key: window.CryptoUtils.arrayBufferToBase64(bytes) }, null, 2);
    const fingerprint = await fingerprintBytes(bytes);
    return { text, bytes, fingerprint };
  }

  /**
   * 计算字节缓冲区的 SHA-256 指纹（小写 hex）
   * @param {BufferSource} bytes - 任意字节
   * @returns {Promise<string>} hex 指纹
   */
  async function fingerprintBytes(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return window.CryptoUtils.bytesToHex(digest);
  }

  /**
   * 解析并校验用户选择的 .key 文件
   * @param {File} file - 用户选择的文件
   * @param {string} [expectFingerprint] - 期望指纹（meta.kfFp，提供时不匹配即拒绝）
   * @returns {Promise<{ok: boolean, bytes?: Uint8Array, fingerprint?: string, errorKey?: string}>}
   *   errorKey 为 i18n 键（keyfile.err.*），由调用方转 Toast
   */
  async function parseFile(file, expectFingerprint) {
    let text = '';
    try {
      text = await file.text();
    } catch (e) {
      return { ok: false, errorKey: 'keyfile.err.read' };
    }
    let keyB64 = null;
    const trimmed = String(text).trim();
    try {
      const envelope = JSON.parse(trimmed);
      if (envelope && envelope.format === KEYFILE_FORMAT && typeof envelope.key === 'string') {
        keyB64 = envelope.key;
      }
    } catch (e) { /* 非 JSON：回退按纯 base64 文件解析（兼容手工生成的密钥文件） */ }
    if (keyB64 === null) {
      // 回退：文件本身即 base64（允许含空白）
      const candidate = trimmed.replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/=]{43,88}$/.test(candidate)) keyB64 = candidate;
    }
    if (keyB64 === null) {
      return { ok: false, errorKey: 'keyfile.err.format' };
    }
    let bytes;
    try {
      bytes = new Uint8Array(window.CryptoUtils.base64ToArrayBuffer(keyB64));
    } catch (e) {
      return { ok: false, errorKey: 'keyfile.err.format' };
    }
    if (bytes.byteLength !== 32) {
      return { ok: false, errorKey: 'keyfile.err.format' };
    }
    const fingerprint = await fingerprintBytes(bytes);
    if (expectFingerprint && fingerprint !== String(expectFingerprint).toLowerCase()) {
      return { ok: false, errorKey: 'keyfile.err.mismatch' };
    }
    return { ok: true, bytes, fingerprint };
  }

  window.KeyFileUtils = {
    KEYFILE_FORMAT,
    generate,
    fingerprintBytes,
    parseFile,
  };
})();
