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
  
  // 生成密码（拒绝采样消除模运算偏差：丢弃落入拒绝区间的随机数）
  const array = new Uint32Array(length);
  const charsetLen = charset.length;
  const max = Math.floor(0xFFFFFFFF / charsetLen) * charsetLen;

  let password = '';
  let i = 0;
  while (i < length) {
    crypto.getRandomValues(array);
    for (let j = 0; j < length && i < length; j++) {
      const v = array[j];
      if (v >= max) continue; // 拒绝采样：落入拒绝区间则丢弃
      password += charset[v % charsetLen];
      i++;
    }
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
    // N7：颜色走设计令牌，与主题切换联动（内联 style 支持 var()）
    return { entropy: 0, label: window.I18n ? window.I18n.t('editor.strength.none') : '未输入', color: 'var(--text-muted)', pct: 0 };
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

  // 确定强度等级（N7：颜色统一走设计令牌，避免深浅主题对比度漂移）
  let label, color, pct;

  if (entropy < 40) {
    label = window.I18n ? window.I18n.t('editor.strength.weak') : '弱';
    color = 'var(--danger)';
    pct = 20;
  } else if (entropy < 60) {
    label = window.I18n ? window.I18n.t('editor.strength.medium') : '中';
    color = 'var(--warning)';
    pct = 50;
  } else if (entropy < 80) {
    label = window.I18n ? window.I18n.t('editor.strength.strong') : '强';
    color = 'var(--accent)';
    pct = 75;
  } else {
    label = window.I18n ? window.I18n.t('editor.strength.veryStrong') : '极强';
    color = 'var(--success)';
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
