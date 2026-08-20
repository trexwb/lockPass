/* ═══════════════════════════════════════════════════════════════════
   LockPass — 密码生成器模块
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 字符集定义
 */
const CHARSETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  
  // 无歧义版本
  uppercaseNoAmbig: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercaseNoAmbig: 'abcdefghjkmnpqrstuvwxyz',
  numbersNoAmbig: '23456789'
};

/**
 * 生成密码
 * @param {Object} options - 配置选项
 * @param {number} options.length - 密码长度 (8-64)
 * @param {boolean} options.uppercase - 包含大写字母
 * @param {boolean} options.lowercase - 包含小写字母
 * @param {boolean} options.numbers - 包含数字
 * @param {boolean} options.symbols - 包含符号
 * @param {boolean} options.noAmbiguous - 排除歧义字符 (0/O/l/1/I)
 * @returns {string} 生成的密码
 */
function generatePassword(options = {}) {
  const {
    length = 16,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
    noAmbiguous = false
  } = options;
  
  // 构建字符集
  let charset = '';
  
  if (uppercase) {
    charset += noAmbiguous ? CHARSETS.uppercaseNoAmbig : CHARSETS.uppercase;
  }
  if (lowercase) {
    charset += noAmbiguous ? CHARSETS.lowercaseNoAmbig : CHARSETS.lowercase;
  }
  if (numbers) {
    charset += noAmbiguous ? CHARSETS.numbersNoAmbig : CHARSETS.numbers;
  }
  if (symbols) {
    charset += CHARSETS.symbols;
  }
  
  // 如果没有选择任何字符集，使用默认小写字母
  if (!charset) {
    charset = CHARSETS.lowercase;
  }
  
  // 生成密码
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  
  return password;
}

/**
 * 计算密码强度
 * @param {string} password - 密码
 * @returns {Object} { entropy, label, color, pct }
 */
function calcStrength(password) {
  if (!password) {
    return { entropy: 0, label: '未输入', color: '#8b949e', pct: 0 };
  }
  
  // 计算字符集大小
  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;
  
  if (charsetSize === 0) charsetSize = 26;
  
  // 计算熵值
  const entropy = password.length * Math.log2(charsetSize);
  
  // 确定强度等级
  let label, color, pct;
  
  if (entropy < 40) {
    label = '弱';
    color = '#f85149';
    pct = 20;
  } else if (entropy < 60) {
    label = '中';
    color = '#d29922';
    pct = 50;
  } else if (entropy < 80) {
    label = '强';
    color = '#58a6ff';
    pct = 75;
  } else {
    label = '极强';
    color = '#3fb950';
    pct = 100;
  }
  
  return { entropy, label, color, pct };
}

// 导出模块
window.PasswordGenerator = {
  generatePassword,
  calcStrength,
  CHARSETS
};
