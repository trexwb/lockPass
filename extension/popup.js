/*
 * @Author: ${git_name}
 * @Date: 2026-08-25 12:22:08
 * @LastEditors: ${git_name}
 * @LastEditTime: 2026-08-25 13:29:19
 * @FilePath: /lockPass/extension/popup.js
 * @Description: 
 * 一花一世界，一叶一如来
 * Copyright (c) 2026 by 杭州大美, All Rights Reserved. 
 */
/* LockPass 自动填充 — 弹窗
   打开时向后台要状态与条目列表（不含密码）；
   点击条目 → 后台取密码并转发当前标签页填充。 */
const $ = (id) => document.getElementById(id)

const stateLocked = $('state-locked')
const stateEmpty = $('state-empty')
const stateReady = $('state-ready')
const search = $('search')
const entryList = $('entry-list')
const noMatch = $('no-match')
const statusText = $('status-text')

let allEntries = []

function setStatus(text, cls) {
  statusText.textContent = text
  statusText.className = 'status' + (cls ? ' ' + cls : '')
}

function typeEmoji(type) {
  return { website: '🌐', server: '🖥', database: '🗄', ai: '🤖', app: '📦', other: '🔑' }[type] || '🔑'
}

function render(list) {
  entryList.innerHTML = ''
  if (!list.length) {
    noMatch.classList.remove('hidden')
    return
  }
  noMatch.classList.add('hidden')
  for (const e of list) {
    const li = document.createElement('li')
    li.className = 'entry-item'
    li.innerHTML =
      '<span class="type-badge">' + typeEmoji(e.entryType) + '</span>' +
      '<span class="info">' +
        '<div class="title"></div>' +
        '<div class="sub"></div>' +
      '</span>' +
      '<span class="fill-icon">↪</span>'
    li.querySelector('.title').textContent = e.title || '未命名'
    li.querySelector('.sub').textContent =
      [e.username, e.url].filter(Boolean).join(' · ') || '—'
    li.addEventListener('click', () => fill(e.id))
    entryList.appendChild(li)
  }
}

function filterEntries(q) {
  q = (q || '').trim().toLowerCase()
  if (!q) return allEntries
  return allEntries.filter((e) =>
    ((e.title || '') + ' ' + (e.username || '') + ' ' + (e.url || '')).toLowerCase().includes(q)
  )
}

async function fill(entryId) {
  setStatus('填充中…', '')
  const resp = await chrome.runtime.sendMessage({ type: 'POPUP_FILL', entryId })
  if (resp && resp.ok) {
    setStatus('已填充，请确认后提交', 'ok')
    window.close()
  } else {
    setStatus((resp && resp.error) || '填充失败', 'warn')
  }
}

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' })
  if (!state || !state.ready) {
    stateLocked.classList.remove('hidden')
    setStatus('未解锁', 'warn')
    return
  }
  allEntries = state.entries || []
  if (!allEntries.length) {
    stateEmpty.classList.remove('hidden')
    setStatus('密码库为空', '')
    return
  }
  stateReady.classList.remove('hidden')
  setStatus(allEntries.length + ' 条可用', 'ok')
  render(allEntries)
}

$('btn-all').addEventListener('click', () => {
  stateEmpty.classList.add('hidden')
  stateReady.classList.remove('hidden')
  render(allEntries)
})

search.addEventListener('input', () => render(filterEntries(search.value)))

init()
