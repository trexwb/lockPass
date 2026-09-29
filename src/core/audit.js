/* ═══════════════════════════════════════════════════════════════════
   LockPass — 密码健康审计模块
   遍历所有条目，计算安全评分 + 分项问题列表
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 计算条目安全评分（0-100）
 * 弱密码扣分最重，重复次之，空密码再次，长期未更新轻微
 * @param {Array} entries - 所有条目
 * @returns {object} { score, weak, reused, empty, stale, total, details }
 */
function auditVault(entries) {
  const total = entries.length
  if (total === 0) {
    return { score: 100, weak: [], reused: [], empty: [], stale: [], expired: [], total: 0, details: [] }
  }

  const weak = []
  const reused = []
  const empty = []
  const stale = []
  const expired = []

  // 密码哈希映射（用于检测重复）
  const pwMap = new Map() // hash -> [entryIds]

  for (const entry of entries) {
    const id = entry.id
    const pw = entry.password || ''

    // 空密码
    if (!pw) {
      empty.push({ id, title: entry.title || '未命名', entryType: entry.entryType })
    } else {
      // 弱密码检测（复用 calcStrength 逻辑，熵 < 40 为弱）
      let charsetSize = 0
      if (/[a-z]/.test(pw)) charsetSize += 26
      if (/[A-Z]/.test(pw)) charsetSize += 26
      if (/[0-9]/.test(pw)) charsetSize += 10
      if (/[^a-zA-Z0-9]/.test(pw)) charsetSize += 32
      if (charsetSize === 0) charsetSize = 26
      const entropy = pw.length * Math.log2(charsetSize)

      if (entropy < 40) {
        weak.push({ id, title: entry.title || '未命名', entryType: entry.entryType, entropy: Math.round(entropy) })
      }

      // 重复密码检测（简单字符串比对，离线场景足够）
      if (pwMap.has(pw)) {
        pwMap.get(pw).push(id)
      } else {
        pwMap.set(pw, [id])
      }
    }

    // 长期未更新检测（> 365 天）
    if (entry.updatedAt) {
      const daysSinceUpdate = Math.floor((Date.now() - new Date(entry.updatedAt).getTime()) / 86400000)
      if (daysSinceUpdate > 365) {
        stale.push({ id, title: entry.title || '未命名', entryType: entry.entryType, days: daysSinceUpdate })
      }
    }

    // 过期检测（v1.1.2）
    if (entry.expiresAt) {
      const exp = new Date(entry.expiresAt).getTime()
      if (exp < Date.now()) {
        const daysAgo = Math.floor((Date.now() - exp) / 86400000)
        expired.push({ id, title: entry.title || '未命名', entryType: entry.entryType, expiresAt: entry.expiresAt, days: daysAgo })
      }
    }
  }

  // 收集重复密码组
  const reusedGroups = []
  for (const [, ids] of pwMap) {
    if (ids.length > 1) {
      const groupEntries = ids.map(id => {
        const e = entries.find(x => x.id === id)
        return { id, title: e?.title || '未命名', entryType: e?.entryType }
      })
      reusedGroups.push(groupEntries)
      for (const item of groupEntries) {
        if (!reused.find(r => r.id === item.id)) {
          reused.push(item)
        }
      }
    }
  }

  // 安全评分计算（加权扣分）
  let score = 100
  score -= empty.length * 15       // 空密码：每条 -15
  score -= weak.length * 10        // 弱密码：每条 -10
  score -= reused.length * 5       // 重复密码：每条 -5
  score -= expired.length * 12     // 已过期：每条 -12
  score -= stale.length * 2        // 长期未更新：每条 -2
  score = Math.max(0, Math.min(100, score))

  return { score, weak, reused: reusedGroups, empty, stale, expired, total, details: { reusedCount: reused.length } }
}

/**
 * 获取条目过期状态
 * @param {object} entry - 条目
 * @param {number} warnDays - 提前警告天数（默认 30）
 * @returns {null | 'expired' | 'expiring'} null=未设置/正常, expired=已过期, expiring=即将过期
 */
function getExpiryStatus(entry, warnDays = 30) {
  if (!entry.expiresAt) return null
  const now = Date.now()
  const exp = new Date(entry.expiresAt).getTime()
  const diff = exp - now
  if (diff < 0) return 'expired'
  if (diff < warnDays * 86400000) return 'expiring'
  return null
}

/**
 * 获取所有过期/即将过期的条目
 * @param {Array} entries - 所有条目
 * @param {number} warnDays - 提前警告天数
 * @returns {object} { expired: [], expiring: [] }
 */
function getExpiringEntries(entries, warnDays = 30) {
  const expired = []
  const expiring = []
  for (const entry of entries) {
    const status = getExpiryStatus(entry, warnDays)
    if (status === 'expired') {
      expired.push({ id: entry.id, title: entry.title || '未命名', entryType: entry.entryType, expiresAt: entry.expiresAt })
    } else if (status === 'expiring') {
      expiring.push({ id: entry.id, title: entry.title || '未命名', entryType: entry.entryType, expiresAt: entry.expiresAt })
    }
  }
  return { expired, expiring }
}

window.VaultAudit = {
  auditVault,
  getExpiryStatus,
  getExpiringEntries,
}
