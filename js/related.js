/* ═══════════════════════════════════════════════════════════════════
   LockPass — 关联密码模块
   根据网址（同 IP / 同根域名 / 同主机名）和用户名自动建立密码关联，
   在详情面板中展示，点击可快速跳转查看。
   关联关系为动态计算，不落盘存储，条目增删改后始终最新。
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 常见多级公共后缀（离线内置精简版，用于根域名提取）
 * 泛域名如 a.example.com / b.example.com 归一为 example.com
 */
const MULTI_PART_TLDS = new Set([
  // 英国
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  // 中国大陆 / 港澳台
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk', 'com.mo',
  'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  // 日韩
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp',
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'go.kr',
  // 东南亚
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  'co.id', 'or.id', 'web.id', 'ac.id', 'go.id',
  'com.th', 'co.th', 'in.th', 'ac.th', 'go.th',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'com.ph', 'net.ph', 'org.ph', 'com.pk', 'net.pk', 'org.pk',
  // 大洋洲
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  // 美洲
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'net.mx', 'org.mx',
  'com.ar', 'net.ar', 'org.ar',
  'com.co', 'net.co', 'org.co',
  // 欧洲 / 中东 / 非洲
  'com.ru', 'net.ru', 'org.ru',
  'co.za', 'org.za', 'net.za', 'web.za',
  'com.ua', 'net.ua', 'org.ua',
  'com.pl', 'net.pl', 'org.pl',
  'com.tr', 'net.tr', 'org.tr',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il',
  'com.sa', 'net.sa', 'org.sa',
  'com.eg', 'com.ng', 'com.ke',
  // 印度
  'co.in', 'com.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in'
]);

/** IPv4 地址正则 */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 解析网址中的主机名（小写）
 * 兼容无协议写法：192.168.1.1、vpn.example.com:8080、[::1]:8080
 * @param {string} url - 网址字符串
 * @returns {string|null} 主机名，解析失败返回 null
 */
function parseUrlHost(url) {
  if (!url) return null;
  let raw = String(url).trim().toLowerCase();
  if (!raw) return null;

  // 仅 scheme:// 形式视为已带协议，其余（含 host:port 裸写法）补 http:// 再解析
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    raw = 'http://' + raw;
  }

  try {
    const parsed = new URL(raw);
    let host = parsed.hostname || '';
    // IPv6 形如 [::1]，去掉方括号
    if (host.indexOf('[') === 0) {
      host = host.replace(/^\[|\]$/g, '');
    }
    return host || null;
  } catch (e) {
    return null;
  }
}

/**
 * 提取根域名（registrable domain）
 * a.vpn.example.com → example.com；a.example.co.uk → example.co.uk
 * @param {string} hostname - 主机名
 * @returns {string} 根域名（两段以内原样返回）
 */
function getRootDomain(hostname) {
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * 判断主机名是否为 IPv4 地址
 * @param {string} host
 * @returns {boolean}
 */
function isIPv4Host(host) {
  if (!IPV4_RE.test(host)) return false;
  return host.split('.').every(part => parseInt(part, 10) <= 255);
}

/**
 * 计算条目的关联键集合
 * 键格式：ip:<地址> | domain:<根域名> | host:<单标签主机名> | user:<用户名>
 * @param {Object} entry - 密码条目
 * @returns {{urlKeys: Set<string>, usernameKeys: Set<string>}}
 */
function collectEntryKeys(entry) {
  const urlKeys = new Set();
  const usernameKeys = new Set();

  const host = parseUrlHost(entry.url);
  if (host) {
    if (isIPv4Host(host)) {
      urlKeys.add('ip:' + host);
    } else if (host.indexOf('.') === -1) {
      // 内网单标签主机名，如 fileserver / localhost
      urlKeys.add('host:' + host);
    } else {
      urlKeys.add('domain:' + getRootDomain(host));
    }
  }

  const username = (entry.username || '').trim().toLowerCase();
  if (username) {
    usernameKeys.add('user:' + username);
  }

  return { urlKeys: urlKeys, usernameKeys: usernameKeys };
}

/**
 * 根据关联键构建展示原因
 * @param {string} key - 关联键
 * @returns {{type: string, label: string, detail: string}}
 */
function buildRelatedReason(key) {
  const sep = key.indexOf(':');
  const type = key.slice(0, sep);
  const value = key.slice(sep + 1);
  const labels = {
    ip: '同 IP',
    domain: '同域名',
    host: '同主机',
    user: '同账号'
  };
  return {
    type: type,
    label: labels[type] || '关联',
    detail: value
  };
}

/**
 * 获取与指定条目关联的其他密码条目
 * @param {Object} entry - 当前条目
 * @returns {Array<{entry: Object, reasons: Array<{type,label,detail}>}>} 按原因数、更新时间排序
 */
function getRelatedEntries(entry) {
  if (!entry || !App.state.entries) return [];

  const self = collectEntryKeys(entry);
  if (self.urlKeys.size === 0 && self.usernameKeys.size === 0) return [];

  const related = [];
  App.state.entries.forEach(other => {
    if (other.id === entry.id) return;

    const keys = collectEntryKeys(other);
    const reasons = [];

    self.urlKeys.forEach(key => {
      if (keys.urlKeys.has(key)) {
        reasons.push(buildRelatedReason(key));
      }
    });
    self.usernameKeys.forEach(key => {
      if (keys.usernameKeys.has(key)) {
        reasons.push(buildRelatedReason(key));
      }
    });

    if (reasons.length > 0) {
      related.push({ entry: other, reasons: reasons });
    }
  });

  // 排序：关联原因多者优先，其次按更新时间倒序
  related.sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) {
      return b.reasons.length - a.reasons.length;
    }
    return new Date(b.entry.updatedAt || b.entry.createdAt) - new Date(a.entry.updatedAt || a.entry.createdAt);
  });

  return related;
}

/**
 * 渲染详情面板中的「关联密码」区块（无关联时返回空字符串）
 * @param {Object} entry - 当前条目
 * @returns {string} HTML
 */
function renderRelatedSection(entry) {
  const related = getRelatedEntries(entry);
  if (related.length === 0) return '';

  const tagDefs = App.state.tagDefs || {};
  const items = related.map(item => {
    // 使用 entryType 显示正确的类型图标
    const type = item.entry.entryType || 'website';
    const typeIcon = Utils.SvgIcons.typeIcon(12, type);

    const reasonTags = item.reasons.map(reason =>
      `<span class="related-reason ${reason.type}" title="${Utils.escHtml(reason.detail)}">${reason.label}</span>`
    ).join('');

    return `
      <div class="related-item" onclick="selectEntry('${Utils.escHtml(item.entry.id)}', event)">
        <div class="entry-icon">${typeIcon}</div>
        <div class="entry-info">
          <div class="entry-title">${Utils.escHtml(item.entry.title)}</div>
          <div class="entry-meta">
            ${item.entry.username ? `<span>${Utils.escHtml(item.entry.username)}</span>` : ''}
            <span class="entry-date">${Utils.formatDate(item.entry.updatedAt || item.entry.createdAt)}</span>
          </div>
        </div>
        <div class="related-reasons">${reasonTags}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="detail-field related-section">
      <div class="detail-field-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        关联密码（${related.length}）
      </div>
      <div class="related-list">${items}</div>
    </div>
  `;
}

// 导出模块
window.RelatedEntries = {
  parseUrlHost,
  getRootDomain,
  getRelatedEntries,
  renderRelatedSection
};
