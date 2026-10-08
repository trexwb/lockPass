/* ═══════════════════════════════════════════════════════════════════
   LockPass — 加密工具模块
   使用 Web Crypto API 实现 AES-256-GCM 加密
   ═══════════════════════════════════════════════════════════════════ */

/**
 * PBKDF2 迭代次数常量
 * - DEFAULT_ITERATIONS: 新建保险箱使用（OWASP 2023 推荐 600000）
 * - LEGACY_ITERATIONS:  兼容旧数据（无 iterations 记录时回退）
 */
const DEFAULT_ITERATIONS = 600000;
const LEGACY_ITERATIONS = 100000;

/**
 * 从主密码派生 AES-256-GCM 密钥
 * @param {string} password - 用户主密码
 * @param {Uint8Array} salt - 盐值（32字节）
 * @param {number} [iterations=DEFAULT_ITERATIONS] - PBKDF2 迭代次数（与保险箱 meta 中的 iterations 保持一致）
 * @returns {Promise<CryptoKey>} AES-256-GCM 密钥
 */
async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密数据
 * @param {any} data - 要加密的数据（会被 JSON 序列化）
 * @param {CryptoKey} key - AES-256-GCM 密钥
 * @returns {Promise<{iv: string, data: string}>} Base64 编码的 IV 和密文
 */
async function encrypt(data, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(JSON.stringify(data))
  );
  
  return {
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(ciphertext)
  };
}

/**
 * 解密数据
 * @param {string} ciphertextB64 - Base64 编码的密文
 * @param {string} ivB64 - Base64 编码的 IV
 * @param {CryptoKey} key - AES-256-GCM 密钥
 * @returns {Promise<any>} 解密后的数据
 */
async function decrypt(ciphertextB64, ivB64, key) {
  const decoder = new TextDecoder();
  const ciphertext = base64ToArrayBuffer(ciphertextB64);
  const iv = base64ToArrayBuffer(ivB64);
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  );
  
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * ArrayBuffer 转 Base64
 * @param {ArrayBuffer} buffer
 * @returns {string} Base64 字符串
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 * @param {string} b64 - Base64 字符串
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 生成 UUID
 * @returns {string} UUID 字符串
 */
function uuid() {
  // 优先使用 Web Crypto 的加密安全随机 UUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兼容旧环境：基于 CSPRNG 生成（不再使用 Math.random）
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 生成随机盐值
 * @returns {Uint8Array} 32字节盐值
 */
function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * 从主密码派生 32 字节原始密钥（生物识别解锁 enroll 专用）
 * 与 deriveKey 同参数同算法（PBKDF2-SHA256 → 256bit），仅输出 raw bytes
 * 而非 CryptoKey，供 Rust 侧封装为 Device Unlock Key 加密保存。
 * @param {string} password - 用户主密码
 * @param {Uint8Array} salt - 盐值（32字节）
 * @param {number} [iterations=DEFAULT_ITERATIONS] - PBKDF2 迭代次数
 * @returns {Promise<ArrayBuffer>} 32 字节原始密钥（仅内存，不落盘）
 */
async function deriveKeyBytes(password, salt, iterations = DEFAULT_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
}

/**
 * 以原始字节导入 AES-256-GCM 密钥（生物识别解锁后还原 Vault Key 专用）
 * extractable=false：密钥永不可导出，仅本次会话内存可用。
 * @param {BufferSource} bytes - 32 字节原始密钥
 * @returns {Promise<CryptoKey>} AES-256-GCM 会话密钥
 */
async function importRawAesKey(bytes) {
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 字节数组转小写 hex 字符串（enroll 传参用；不落盘）
 * @param {BufferSource} buf - 任意字节缓冲区
 * @returns {string} hex 字符串
 */
function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

// 导出模块
window.CryptoUtils = {
  DEFAULT_ITERATIONS,
  LEGACY_ITERATIONS,
  deriveKey,
  deriveKeyBytes,
  importRawAesKey,
  bytesToHex,
  encrypt,
  decrypt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  uuid,
  generateSalt
};
