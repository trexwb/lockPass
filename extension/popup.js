/*
 * @Author: ${git_name}
 * @Date: 2026-08-25 12:22:08
 * @LastEditors: ${git_name}
 * @LastEditTime: 2026-08-25 16:20:00
 * @FilePath: /lockPass/extension/popup.js
 * @Description:
 * 一花一世界，一叶一如来
 * Copyright (c) 2026 by 杭州大美, All Rights Reserved.
 */
/* LockPass 自动填充 — 弹窗
   打开时向后台要状态与条目列表（HTTP 通道条目含密码缓存于后台会话内存，不落盘）；
   点击条目 → 后台取密码并转发当前标签页填充。
   桌面版未配对时展示「连接桌面版」按钮，走一键配对（POST /pair → 桌面端弹窗确认）。 */
const $ = (id) => document.getElementById(id)

const stateLocked = $('state-locked')
const statePairing = $('state-pairing')
const stateEmpty = $('state-empty')
const stateReady = $('state-ready')
const lockedTitle = $('locked-title')
const lockedHint = $('locked-hint')
const btnPair = $('btn-pair')
const pairNonce = $('pair-nonce')
const emptyTitle = $('empty-title')
const emptyHint = $('empty-hint')
const btnAll = $('btn-all')
const search = $('search')
const entryList = $('entry-list')
const noMatch = $('no-match')
const statusText = $('status-text')

let allEntries = []
let currentSource = null

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

function showState(el) {
  stateLocked.classList.add('hidden')
  statePairing.classList.add('hidden')
  stateEmpty.classList.add('hidden')
  stateReady.classList.add('hidden')
  el.classList.remove('hidden')
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

async function getState() {
  return await chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' })
}

function renderState(state) {
  // 配对进行中：显示 nonce，等待桌面端确认
  if (state.pairing) {
    showState(statePairing)
    pairNonce.textContent = state.pairNonce || '——'
    setStatus('等待桌面端确认…', 'warn')
    scheduleRefresh(2000)
    return
  }

  if (state.ready) {
    currentSource = state.source
    allEntries = state.entries || []
    if (!allEntries.length) {
      showState(stateEmpty)
      if (state.source === 'http') {
        emptyTitle.textContent = '当前网站没有匹配条目'
        emptyHint.textContent = '桌面版按当前网站域名匹配，未找到可用凭据。'
        btnAll.classList.add('hidden')
      } else {
        emptyTitle.textContent = '没有匹配的密码条目'
        emptyHint.textContent = '当前密码库为空，或当前网站没有可关联的条目。点击下方按钮查看全部条目。'
        btnAll.classList.remove('hidden')
      }
      setStatus(state.source === 'http' ? '已连接桌面版' : '已解锁', 'ok')
    } else {
      showState(stateReady)
      setStatus(allEntries.length + ' 条可用', 'ok')
      render(allEntries)
    }
    scheduleRefresh(5000)
    return
  }

  // 未就绪
  showState(stateLocked)
  if (state.serviceAlive) {
    // 桌面版本地服务可达
    if (!state.httpUnlocked) {
      lockedTitle.textContent = 'LockPass 桌面版未解锁'
      lockedHint.textContent = '请先在桌面应用中解锁密码库，本扩展将自动就绪。'
    } else {
      lockedTitle.textContent = 'LockPass 桌面版已解锁'
      lockedHint.textContent = '本扩展尚未配对，点击下方按钮一键连接。'
    }
    if (!state.httpPaired) {
      btnPair.classList.remove('hidden')
    } else {
      btnPair.classList.add('hidden')
    }
  } else {
    lockedTitle.textContent = 'LockPass 未解锁'
    lockedHint.textContent = '请先打开并解锁 LockPass 主应用（浏览器版 / 在线版），解锁后本扩展自动就绪。'
    btnPair.classList.add('hidden')
  }
  setStatus('未解锁', 'warn')
  scheduleRefresh(5000)
}

let refreshTimer = null
function scheduleRefresh(ms) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    const state = await getState()
    if (document.hidden) return
    renderState(state)
  }, ms)
}

async function startPair() {
  setStatus('正在发起配对…', '')
  const resp = await chrome.runtime.sendMessage({ type: 'POPUP_PAIR' })
  if (resp && resp.ok) {
    const state = await getState()
    renderState(state)
  } else {
    setStatus((resp && resp.error) || '配对失败，请确认桌面版已运行', 'warn')
    btnPair.classList.remove('hidden')
  }
}

btnPair.addEventListener('click', () => {
  btnPair.classList.add('hidden')
  startPair()
})

$('btn-all').addEventListener('click', () => {
  stateEmpty.classList.add('hidden')
  stateReady.classList.remove('hidden')
  render(allEntries)
})

search.addEventListener('input', () => render(filterEntries(search.value)))

async function init() {
  const state = await getState()
  renderState(state)
}

init()
