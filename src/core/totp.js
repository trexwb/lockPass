/* ═══════════════════════════════════════════════════════════════════
   LockPass — TOTP 双因素认证模块
   基于 RFC 6238 (TOTP) 和 RFC 4226 (HOTP) 实现
   使用 Web Crypto API 的 HMAC-SHA1，零外部依赖
   ═══════════════════════════════════════════════════════════════════ */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 解码为 Uint8Array
 * @param {string} str - Base32 编码字符串（自动去除空格和补位符）
 * @returns {Uint8Array} 解码后的字节数组
 */
function base32Decode(str) {
  const cleaned = str.toUpperCase().replace(/[\s=-]+/g, '');
  if (!cleaned) return new Uint8Array(0);

  for (const ch of cleaned) {
    if (BASE32_ALPHABET.indexOf(ch) === -1) {
      throw new Error(`Invalid Base32 character: ${ch}`);
    }
  }

  const bits = [];
  for (const ch of cleaned) {
    const val = BASE32_ALPHABET.indexOf(ch);
    bits.push(...[
      (val >> 4) & 1, (val >> 3) & 1, (val >> 2) & 1, (val >> 1) & 1, val & 1
    ]);
  }

  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * 计算 HMAC-SHA1
 * @param {Uint8Array} key - 密钥字节数组
 * @param {Uint8Array} data - 数据字节数组
 * @returns {Promise<ArrayBuffer>} HMAC-SHA1 结果（20 字节）
 */
async function hmacSha1(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, data);
}

/**
 * 将 8 字节计数器编码为大端 Uint8Array
 * @param {number} counter - 计数器值
 * @returns {Uint8Array} 8 字节大端编码
 */
function encodeCounter(counter) {
  const buf = new Uint8Array(8);
  let val = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = val & 0xff;
    val = Math.floor(val / 256);
  }
  return buf;
}

/**
 * 生成 TOTP 动态码
 * @param {string} secret - Base32 编码的密钥
 * @param {object} [options] - 配置项
 * @param {number} [options.period=30] - 时间步长（秒）
 * @param {number} [options.digits=6] - 动态码位数（6 或 8）
 * @param {string} [options.algorithm='SHA1'] - 哈希算法（当前仅支持 SHA1）
 * @param {number} [options.time] - 指定时间戳（毫秒），默认 Date.now()
 * @returns {Promise<string>} 动态码字符串（补零到指定位数）
 */
async function generateTOTP(secret, options = {}) {
  const { period = 30, digits = 6, time = Date.now() } = options;

  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) {
    throw new Error('TOTP secret is empty');
  }

  const counter = Math.floor(time / 1000 / period);
  const counterBytes = encodeCounter(counter);

  const hmacResult = await hmacSha1(keyBytes, counterBytes);
  const hmacBytes = new Uint8Array(hmacResult);

  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

/**
 * 解析 otpauth:// URI
 * 格式: otpauth://totp/Issuer:account?secret=XXX&issuer=YYY&period=30&digits=6&algorithm=SHA1
 * @param {string} uri - otpauth URI
 * @returns {object} 解析结果 { secret, issuer, account, period, digits, algorithm }
 */
function parseOTPAuthURI(uri) {
  if (!uri || !uri.startsWith('otpauth://')) {
    throw new Error('Invalid otpauth:// URI');
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('Malformed URI');
  }

  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') {
    throw new Error('Only otpauth://totp/ is supported');
  }

  const path = decodeURIComponent(url.pathname.slice(2));
  let issuer = '';
  let account = path;

  const colonIdx = path.indexOf(':');
  if (colonIdx > 0) {
    issuer = path.substring(0, colonIdx);
    account = path.substring(colonIdx + 1).trim();
  }

  const params = url.searchParams;
  const secret = params.get('secret');
  if (!secret) {
    throw new Error('Missing secret parameter');
  }

  if (params.get('issuer')) {
    issuer = params.get('issuer');
  }

  return {
    secret: secret.toUpperCase().replace(/\s/g, ''),
    issuer,
    account,
    period: parseInt(params.get('period') || '30', 10),
    digits: parseInt(params.get('digits') || '6', 10),
    algorithm: (params.get('algorithm') || 'SHA1').toUpperCase()
  };
}

/**
 * 构建 otpauth:// URI
 * @param {object} totp - TOTP 配置 { secret, issuer, account, period, digits, algorithm }
 * @returns {string} otpauth URI
 */
function buildOTPAuthURI(totp) {
  const { secret, issuer, account, period = 30, digits = 6, algorithm = 'SHA1' } = totp;
  const label = issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account || '')}` : encodeURIComponent(account || '');
  const params = new URLSearchParams();
  params.set('secret', secret);
  if (issuer) params.set('issuer', issuer);
  if (period !== 30) params.set('period', String(period));
  if (digits !== 6) params.set('digits', String(digits));
  if (algorithm !== 'SHA1') params.set('algorithm', algorithm);
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * 获取当前 TOTP 周期剩余秒数
 * @param {number} [period=30] - 时间步长（秒）
 * @returns {number} 剩余秒数（0 ~ period-1）
 */
function getRemainingSeconds(period = 30) {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * 验证 TOTP 密钥是否有效（尝试解码 Base32）
 * @param {string} secret - Base32 编码的密钥
 * @returns {boolean} 是否有效
 */
function validateSecret(secret) {
  try {
    const bytes = base32Decode(secret);
    return bytes.length >= 10;
  } catch {
    return false;
  }
}

window.TOTPUtils = {
  base32Decode,
  generateTOTP,
  parseOTPAuthURI,
  buildOTPAuthURI,
  getRemainingSeconds,
  validateSecret
};
