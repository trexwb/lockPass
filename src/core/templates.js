/* ═══════════════════════════════════════════════════════════════════
   LockPass — 自定义字段模板（upgrade-design.md §1.2）
   ───────────────────────────────────────────────────────────────────
   内置类型模板：选择类型后自动带入模板字段（label/value 可编辑），
   用户仍可自由增删。模板 label 为数据初始值（可编辑、随条目加密存储），
   非界面文案；界面按钮/类型名文案走 I18n.t。
   ═══════════════════════════════════════════════════════════════════ */

// 字段 type 枚举（供浏览器扩展识别填充：email/phone/otp 可被自动填充）
export const CUSTOM_FIELD_TYPES = ['text', 'pin', 'email', 'phone', 'otp', 'url', 'notes']

// 内置模板：fields 为 [{ label, type }]，创建时 value 置空、sensitive 默认 false
export const FIELD_TEMPLATES = {
  bank: {
    id: 'bank',
    fields: [
      { label: '卡号', type: 'text' },
      { label: '持卡人', type: 'text' },
      { label: '支行', type: 'text' },
      { label: '预留手机', type: 'phone' },
    ],
  },
  email: {
    id: 'email',
    fields: [
      { label: '邮箱地址', type: 'email' },
      { label: '登录密码', type: 'pin' },
    ],
  },
  wifi: {
    id: 'wifi',
    fields: [
      { label: 'SSID', type: 'text' },
      { label: '密码', type: 'pin' },
      { label: '加密方式', type: 'text' },
    ],
  },
  server: {
    id: 'server',
    fields: [
      { label: '地址', type: 'text' },
      { label: '端口', type: 'text' },
      { label: '用户名', type: 'text' },
      { label: '密码', type: 'pin' },
    ],
  },
  social: {
    id: 'social',
    fields: [
      { label: '账号', type: 'text' },
      { label: '密码', type: 'pin' },
      { label: '恢复码', type: 'notes' },
    ],
  },
  custom: {
    id: 'custom',
    fields: [],
  },
}

let _cfSeq = 0

/**
 * 创建自定义字段对象
 * @param {string} label - 字段标签（可编辑）
 * @param {string} [type='text'] - 字段类型，CUSTOM_FIELD_TYPES 枚举之一
 * @returns {{id:string,label:string,value:string,sensitive:boolean,type:string}}
 */
export function createCustomField(label, type = 'text') {
  _cfSeq += 1
  return {
    id: `cf_${Date.now().toString(36)}_${_cfSeq}`,
    label: label || '',
    value: '',
    sensitive: type === 'pin',
    type: CUSTOM_FIELD_TYPES.includes(type) ? type : 'text',
  }
}

// 窗口挂载（main.js 顶部 import 副作用）
if (typeof window !== 'undefined') {
  window.CustomFieldTemplates = { CUSTOM_FIELD_TYPES, FIELD_TEMPLATES, createCustomField }
}
