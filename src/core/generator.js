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
 * 拒绝采样随机整数：返回 [0, n) 的均匀整数（消除模运算偏差）
 * @param {number} n - 上限（n > 0）
 * @returns {number}
 */
function randInt(n) {
  const max = Math.floor(0xFFFFFFFF / n) * n;
  const arr = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(arr);
    const v = arr[0];
    if (v < max) return v % n; // 落入拒绝区间则重抽
  }
}

/**
 * Fisher-Yates 原地洗牌（拒绝采样随机源）
 * @param {Array} arr
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/**
 * 校验是否违反「禁止连续重复」约束
 * @param {string} password
 * @param {number} maxRepeat - 允许的最大连续相同字符数（0 = 不限）
 * @returns {boolean}
 */
function hasExcessiveRepeat(password, maxRepeat) {
  if (!maxRepeat || maxRepeat < 1 || password.length < 2) return false;
  let run = 1;
  for (let i = 1; i < password.length; i++) {
    if (password[i] === password[i - 1]) {
      run++;
      if (run > maxRepeat) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * 生成密码
 * @param {Object} options - 配置选项
 * @param {number} options.length - 密码长度 (8-64)
 * @param {boolean} options.uppercase - 包含大写字母
 * @param {boolean} options.lowercase - 包含小写字母
 * @param {boolean} options.numbers - 包含数字
 * @param {boolean} options.symbols - 包含符号
 * @param {boolean} options.noAmbiguous - 排除歧义字符 (0/O/l/1/I)
 * @param {boolean} options.minEachSet - 每组字符集至少出现 1 个字符（默认开启）
 * @param {number} options.maxRepeat - 允许的最大连续相同字符数（默认 0 = 不限；1 = 禁止连续重复）
 * @returns {string} 生成的密码
 */
function generatePassword(options = {}) {
  const {
    length = 16,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
    noAmbiguous = false,
    minEachSet = true,
    maxRepeat = 0
  } = options;

  // 构建启用的字符集列表（保持每类独立，便于 minEachSet 逐组保证）
  const sets = [];
  if (uppercase) sets.push(noAmbiguous ? CHARSETS.uppercaseNoAmbig : CHARSETS.uppercase);
  if (lowercase) sets.push(noAmbiguous ? CHARSETS.lowercaseNoAmbig : CHARSETS.lowercase);
  if (numbers) sets.push(noAmbiguous ? CHARSETS.numbersNoAmbig : CHARSETS.numbers);
  if (symbols) sets.push(CHARSETS.symbols);

  // 全取消时回退小写（兼容旧调用方；弹窗层会在 UI 上禁用生成）
  if (!sets.length) sets.push(CHARSETS.lowercase);

  const charset = sets.join('');

  /**
   * 生成一次候选密码（不含 maxRepeat 校验）
   * - minEachSet：先为每个启用集合随机取 1 个字符，剩余位从全集中随机
   * - 最后洗牌，保证「每集至少 1 个」的字符分布随机而非固定前缀
   */
  const build = () => {
    const chars = [];
    if (minEachSet && length >= sets.length) {
      for (const set of sets) chars.push(set[randInt(set.length)]);
    }
    while (chars.length < length) chars.push(charset[randInt(charset.length)]);
    shuffle(chars);
    return chars.join('');
  };

  // 生成：maxRepeat 约束通过「整体重试」满足（长度 8~64、字符集 ≥ 4 类时失败概率极低）
  let password = build();
  if (maxRepeat && maxRepeat >= 1) {
    for (let attempt = 0; attempt < 24 && hasExcessiveRepeat(password, maxRepeat); attempt++) {
      password = build();
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
