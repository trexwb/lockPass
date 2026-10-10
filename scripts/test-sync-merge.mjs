#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   LockPass — 同步合并引擎测试（设计文档 §10 P0 验收口径）
   运行：npm run test:sync
   覆盖：① 固定用例（新增/双改/删除复活/墓碑/标签冲突/历史合并/序号盖写/漂移与冲突表投影）
         ② 代数性质随机对拍（交换律、幂等律，普通模式与 strict 模式各一轮）
   ═══════════════════════════════════════════════════════════════════ */

import SyncMerge from '../src/core/sync-merge.js'

const {
  mergeState, stampRevs, digestIndex, tagDigestIndex, collectTombstones, fingerprint,
  clockSkewMs, rememberTombstone, pruneTombstones,
} = SyncMerge

const NOW = '2026-10-09T00:00:00.000Z'
let pass = 0
let fail = 0

/** 断言：失败不中断，汇总后再退出（一次跑完看全貌） */
function check(name, cond, extra) {
  if (cond) { pass++; return }
  fail++
  console.error('✗ ' + name + (extra ? '\n   ' + extra : ''))
}

/**
 * 把合并结果归一化成可比较的形态：
 * 列表按 id 排序、冲突副本用 conflictOf 作为稳定标识、对象键排序、忽略展示顺序。
 */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value).sort().forEach((k) => { out[k] = canon(value[k]) })
    return out
  }
  return value
}

function normalize(result) {
  const normEntry = (e) => {
    const out = canon(e)
    if (out.conflictOf) out.id = 'COPY_OF_' + out.conflictOf
    return out
  }
  const byId = (a, b) => String(a.id).localeCompare(String(b.id))
  /** 历史列表内同 at 的元素顺序不属于等价性：按序列化文本排一次 */
  const history = canon(result.state.history)
  Object.keys(history).forEach((k) => {
    history[k] = history[k].slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  })
  return JSON.stringify({
    entries: result.state.entries.map(normEntry).sort(byId),
    deleted: result.state.deleted.map(normEntry).sort(byId),
    tagDefs: canon(result.state.tagDefs),
    history,
    tombstones: canon(result.tombstones),
  })
}

/** 构造条目：fields 覆盖默认值 */
const entry = (id, rev, updatedAt, extra = {}) => ({
  id, title: 'T-' + id, entryType: 'website', username: 'u', password: 'p',
  url: '', notes: '', tags: [], customFields: [], rev, updatedAt, createdAt: updatedAt,
  ...extra,
})

/** 构造状态：alive/dead 两组条目 + 标签 + 历史 */
const state = (alive = [], dead = [], tagDefs = {}, history = {}) => ({
  entries: alive, deleted: dead, tagDefs, history, tags: [],
})

/* ═══════════════ ① 固定用例 ═══════════════ */

// 1 两边完全相同：零变更
{
  const a = state([entry('1', 3, '2026-01-01T00:00:00.000Z')])
  const r = mergeState({ local: a, remote: JSON.parse(JSON.stringify(a)), now: NOW })
  check('01 相同状态零变更', r.summary.added === 0 && r.summary.updated === 0 && r.summary.removed === 0 && r.summary.conflicts === 0)
  check('01 相同状态 rev 不进位', r.state.entries[0].rev === 3)
}

// 2 本机新增
{
  const l = state([entry('1', 1, '2026-01-01T00:00:00.000Z')])
  const r = mergeState({ local: l, remote: state(), now: NOW })
  check('02 本机新增保留', r.state.entries.length === 1 && r.summary.added === 0)
}

// 3 对端新增
{
  const l = state()
  const rr = state([entry('2', 1, '2026-01-02T00:00:00.000Z')])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('03 对端新增并入并计数', r.state.entries.length === 1 && r.summary.added === 1)
}

// 4 对端更新（rev 更高）
{
  const l = state([entry('1', 2, '2026-01-01T00:00:00.000Z', { password: 'old' })])
  const rr = state([entry('1', 5, '2026-01-02T00:00:00.000Z', { password: 'new' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('04 高 rev 胜出且 rev 原样保留', r.state.entries[0].password === 'new' && r.state.entries[0].rev === 5)
  check('04 本机视角计为更新', r.summary.updated === 1)
}

// 5 本机更新（rev 更高）
{
  const l = state([entry('1', 9, '2026-01-09T00:00:00.000Z', { password: 'mine' })])
  const rr = state([entry('1', 3, '2026-01-03T00:00:00.000Z', { password: 'theirs' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('05 本机高 rev 胜出', r.state.entries[0].password === 'mine' && r.summary.updated === 0)
}

// 6 两边都改、rev 相等、时间不同 → 时间新者胜 + 落版进回收站
{
  const l = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'L' })])
  const rr = state([entry('1', 4, '2026-01-06T00:00:00.000Z', { password: 'R' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('06 并列时 updatedAt 新者胜', r.state.entries[0].password === 'R')
  check('06 胜版 rev 进位', r.state.entries[0].rev === 5)
  check('06 落版进回收站', r.state.deleted.length === 1 && r.state.deleted[0].password === 'L')
  check('06 落版带 conflictOf 与新 id', r.state.deleted[0].conflictOf === '1' && r.state.deleted[0].id !== '1')
  check('06 冲突计数 1', r.summary.conflicts === 1)
}

// 7 两边都改、rev 与时间都相等 → 确定性指纹序（不依赖谁是本机）
{
  const l = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'AAA' })])
  const rr = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'ZZZ' })])
  const a = mergeState({ local: l, remote: rr, now: NOW })
  const b = mergeState({ local: rr, remote: l, now: NOW })
  check('07 完全并列由指纹决定且与方向无关', a.state.entries[0].password === b.state.entries[0].password)
}

// 8 时钟漂移：更新时间早但 rev 更高的一方仍胜（时间不是主判据）
{
  const l = state([entry('1', 8, '2025-01-01T00:00:00.000Z', { password: 'slow-clock-but-later' })])
  const rr = state([entry('1', 2, '2030-01-01T00:00:00.000Z', { password: 'fast-clock-but-older' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('08 rev 压过 updatedAt', r.state.entries[0].password === 'slow-clock-but-later')
}

// 9 本机删除（rev 更高）→ 结果删除
{
  const l = state([], [entry('1', 6, '2026-01-01T00:00:00.000Z', { deletedAt: '2026-01-06T00:00:00.000Z' })])
  const rr = state([entry('1', 3, '2026-01-01T00:00:00.000Z')])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('09 删除序号更高则删除生效', r.state.entries.length === 0 && r.state.deleted.length === 1)
}

// 10 对端删除（rev 更高）→ 本机条目被移入回收站
{
  const l = state([entry('1', 3, '2026-01-01T00:00:00.000Z')])
  const rr = state([], [entry('1', 7, '2026-01-01T00:00:00.000Z', { deletedAt: '2026-01-07T00:00:00.000Z' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('10 对端删除同步生效', r.state.entries.length === 0 && r.summary.removed === 1)
}

// 11 删除后又编辑（本机 rev 更高）→ 复活
{
  const l = state([entry('1', 8, '2026-01-08T00:00:00.000Z', { password: 'edited-after-delete' })])
  const rr = state([], [entry('1', 5, '2026-01-05T00:00:00.000Z', { deletedAt: '2026-01-05T00:00:00.000Z' })])
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('11 删除后的编辑复活条目', r.state.entries.length === 1 && r.state.entries[0].password === 'edited-after-delete')
}

// 12 墓碑压制对端旧副本（彻底删除不得复活）
{
  const l = state()
  const rr = state([entry('1', 4, '2026-01-01T00:00:00.000Z')])
  const t = { '1': { rev: 6, deletedAt: '2026-01-06T00:00:00.000Z' } }
  const r = mergeState({ local: l, remote: rr, tombstones: t, now: NOW })
  check('12 墓碑序号更高则不复活', r.state.entries.length === 0 && r.tombstones['1'].rev === 6)
}

// 13 墓碑之后本机又改（rev 更高）→ 允许复活
{
  const l = state([entry('1', 9, '2026-01-09T00:00:00.000Z')])
  const t = { '1': { rev: 6, deletedAt: '2026-01-06T00:00:00.000Z' } }
  const r = mergeState({ local: l, remote: state(), tombstones: t, now: NOW })
  check('13 墓碑后更高序号可复活', r.state.entries.length === 1)
}

// 14 两边都没有 + 墓碑在 → 墓碑保留
{
  const t = { '1': { rev: 6, deletedAt: '2026-01-06T00:00:00.000Z' } }
  const r = mergeState({ local: state(), remote: state(), tombstones: t, now: NOW })
  check('14 墓碑跨同步保留', Object.keys(r.tombstones).length === 1 && r.state.entries.length === 0)
}

// 15 标签并集
{
  const l = state([], [], { 工作: { color: 'red', icon: 'i', isDefault: false, rev: 2 } })
  const rr = state([], [], { 个人: { color: 'blue', icon: 'j', isDefault: false, rev: 1 } })
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('15 标签取并集', Object.keys(r.state.tagDefs).length === 2)
}

// 16 标签同名同属性不同 rev → 取 max，不算冲突
{
  const l = state([], [], { 工作: { color: 'red', icon: 'i', isDefault: false, rev: 2 } })
  const rr = state([], [], { 工作: { color: 'red', icon: 'i', isDefault: false, rev: 7 } })
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('16 同属性标签 rev 取大且无冲突', r.state.tagDefs['工作'].rev === 7 && r.summary.tagConflicts === 0)
}

// 17 标签同名异属性 → 高 rev 胜
{
  const l = state([], [], { 工作: { color: 'red', icon: 'i', isDefault: false, rev: 2 } })
  const rr = state([], [], { 工作: { color: 'green', icon: 'k', isDefault: false, rev: 5 } })
  const r = mergeState({ local: l, remote: rr, now: NOW })
  check('17 标签按 rev 取胜', r.state.tagDefs['工作'].color === 'green')
}

// 18 标签同名异属性且 rev 相等 → 确定性选择 + 计数，且与方向无关
{
  const a = { 工作: { color: 'red', icon: 'i', isDefault: false, rev: 3 } }
  const b = { 工作: { color: 'green', icon: 'k', isDefault: false, rev: 3 } }
  // 标签被条目用到才算需要用户裁决；两边同内容同 rev，条目侧不产生冲突
  const used = [entry('u1', 2, '2026-01-05T00:00:00.000Z', { tags: ['工作'] })]
  const r1 = mergeState({ local: state(used.map(e => ({ ...e })), [], a), remote: state(used.map(e => ({ ...e })), [], b), now: NOW })
  const r2 = mergeState({ local: state(used.map(e => ({ ...e })), [], b), remote: state(used.map(e => ({ ...e })), [], a), now: NOW })
  check('18 标签冲突计数', r1.summary.tagConflicts === 1 && r1.summary.conflicts === 0)
  check('18 标签冲突选择与方向无关', r1.state.tagDefs['工作'].color === r2.state.tagDefs['工作'].color)
  // 新建库给热门标签随机配色：两边都有但没人用，取舍即可，不进冲突表
  const r3 = mergeState({ local: state([], [], a), remote: state([], [], b), now: NOW })
  check('18 未使用的标签差异不计冲突', r3.summary.tagConflicts === 0 && r3.summary.conflicts === 0)
  check('18 未使用的标签仍确定性取舍', r3.state.tagDefs['工作'].color === r1.state.tagDefs['工作'].color)
}

// 19 历史合并：去重、倒序、截断
{
  const hist = (id) => ({ [id]: [{ at: '2026-01-02T00:00:00.000Z', snap: { password: 'b' }, fields: ['password'] }] })
  const l = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'L' })], [], {}, {
    '1': [{ at: '2026-01-03T00:00:00.000Z', snap: { password: 'c' }, fields: ['password'] }],
  })
  const rr = state([entry('1', 4, '2026-01-06T00:00:00.000Z', { password: 'R' })], [], {}, hist('1'))
  const r = mergeState({ local: l, remote: rr, historyLimit: 5, now: NOW })
  const list = r.state.history['1']
  check('19 历史两边并集', list.length === 2)
  check('19 历史按时间倒序', list[0].at === '2026-01-03T00:00:00.000Z')
}

// 20 历史上限截断
{
  const many = Array.from({ length: 9 }, (_, i) => ({ at: `2026-01-0${(i % 8) + 1}T00:00:0${i}.000Z`, snap: {}, fields: [] }))
  const l = state([entry('1', 1, '2026-01-01T00:00:00.000Z')], [], {}, { '1': many })
  const r = mergeState({ local: l, remote: state([entry('1', 1, '2026-01-01T00:00:00.000Z')], [], {}, { '1': many }), historyLimit: 5, now: NOW })
  check('20 历史截断到上限', r.state.history['1'].length === 5)
}

// 21 stampRevs：新建/未变/变更/删除/纯 UI 态
{
  const st = { entries: [entry('a', 1, '2026-01-01T00:00:00.000Z'), entry('b', 4, '2026-01-01T00:00:00.000Z')], deleted: [], tagDefs: {} }
  let idx = digestIndex(st)
  stampRevs(st, idx, tagDigestIndex(st.tagDefs))
  check('21 未变更不进位', st.entries[0].rev === 1 && st.entries[1].rev === 4)

  st.entries[1].password = 'changed'
  stampRevs(st, idx, tagDigestIndex(st.tagDefs))
  check('21 变更条目 +1', st.entries[1].rev === 5)
  check('21 未变条目不动', st.entries[0].rev === 1)

  st.entries[0].showPassword = true
  idx = digestIndex(st)
  stampRevs(st, idx, tagDigestIndex(st.tagDefs))
  check('21 仅切显隐不进位', st.entries[0].rev === 1)

  st.entries[1].updatedAt = '2026-01-02T00:00:00.000Z'
  idx = digestIndex(st)
  st.deleted.push({ ...st.entries[1], deletedAt: NOW })
  st.entries.splice(1, 1)
  stampRevs(st, idx, tagDigestIndex(st.tagDefs))
  check('21 移入回收站算一次变更', st.deleted[0].rev === 6)

  const fresh = { entries: [entry('new', undefined, NOW)], deleted: [], tagDefs: {} }
  delete fresh.entries[0].rev
  stampRevs(fresh, new Map(), new Map())
  check('21 无 rev 的历史/新建数据落为起点', fresh.entries[0].rev === 1)

  const tagState = { entries: [], deleted: [], tagDefs: { 工作: { color: 'red', icon: 'i', rev: 2 } } }
  const tagIdx = tagDigestIndex(tagState.tagDefs)
  stampRevs(tagState, digestIndex(tagState), tagIdx)
  check('21 标签未变不进位', tagState.tagDefs['工作'].rev === 2)
  tagState.tagDefs['工作'].color = 'blue'
  stampRevs(tagState, digestIndex(tagState), tagIdx)
  check('21 标签变更进位', tagState.tagDefs['工作'].rev === 3)
}

// 22 collectTombstones：回收站并入并取高 rev
{
  const prev = { '1': { rev: 5, deletedAt: 'x' } }
  const st = { entries: [], deleted: [entry('2', 3, NOW, { deletedAt: NOW })] }
  const t = collectTombstones(st, prev)
  check('22 墓碑并入新删除', t['1'] && t['2'] && t['2'].rev === 3)
}

// 23 冲突副本自身不参与后续合并（新 id、rev 起点）
{
  const l = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'L' })])
  const rr = state([entry('1', 4, '2026-01-06T00:00:00.000Z', { password: 'R' })])
  const r1 = mergeState({ local: l, remote: rr, now: NOW, newId: () => 'copy-1' })
  const r2 = mergeState({ local: r1.state, remote: JSON.parse(JSON.stringify(rr)), now: NOW, newId: () => 'copy-2' })
  check('23 二次合并不再产生新冲突', r2.summary.conflicts === 0)
  check('23 二次合并结果与一次相同', normalize(r2).entries === normalize(r1).entries)
}

// 24 自合并（同机对自己）应完全无变化
{
  const l = state([entry('1', 2, NOW), entry('2', 3, NOW)], [entry('3', 1, NOW, { deletedAt: NOW })])
  const r = mergeState({ local: l, remote: JSON.parse(JSON.stringify(l)), now: NOW })
  check('24 自合并零变更', r.summary.added === 0 && r.summary.updated === 0 && r.summary.removed === 0 && r.state.entries.length === 2)
}

// 25 指纹稳定性：键序不同内容相同 → 指纹一致
{
  const a = { x: 1, y: { p: 2, q: [3, { m: 4, n: 5 }] } }
  const b = { y: { q: [3, { n: 5, m: 4 }], p: 2 }, x: 1 }
  check('25 指纹与键序无关', fingerprint(a) === fingerprint(b))
}

// 26 同 at 的不同历史快照都要保留，且结果与合并方向无关
{
  const at = '2026-01-01T00:00:00.000Z'
  const l = state([entry('1', 2, at)], [], {}, { '1': [{ at, snap: { password: 'a' }, fields: ['password'] }] })
  const rr = state([entry('1', 2, at)], [], {}, { '1': [{ at, snap: { password: 'b' }, fields: ['password'] }] })
  const a = mergeState({ local: l, remote: rr, now: NOW })
  const b = mergeState({ local: rr, remote: l, now: NOW })
  check('26 同时间戳历史并集', a.state.history['1'].length === 2)
  check('26 历史并集与方向无关', normalize(a) === normalize(b))
}

// 27 clockSkewMs：对端时间戳超前量
{
  const future = state([entry('1', 1, '2026-10-09T00:10:00.000Z')])
  const past = state([entry('1', 1, '2026-10-08T23:55:00.000Z')])
  check('27 超前 10 分钟 → 漂移 600000ms', clockSkewMs(future, NOW) === 10 * 60 * 1000)
  check('27 落后时间不计漂移', clockSkewMs(past, NOW) === 0)
  check('27 空状态不报错', clockSkewMs(state(), NOW) === 0)
}

// 28 strict：rev 占优也不自动合并，默认选中仍是 rev 大者
{
  const l = state([entry('1', 2, '2026-01-02T00:00:00.000Z', { password: 'L' })])
  const rr = state([entry('1', 9, '2026-01-09T00:00:00.000Z', { password: 'R' })])
  const soft = mergeState({ local: l, remote: rr, now: NOW })
  const hard = mergeState({ local: l, remote: rr, now: NOW, strict: true, newId: () => 'cp-28' })
  check('28 非 strict 按 rev 直取，零冲突', soft.summary.conflicts === 0 && hard.summary.conflicts === 1)
  check('28 strict 默认选中 rev 大者', hard.state.entries[0].password === 'R')
  check('28 strict 落选版本进回收站并指回原 id', hard.state.deleted.length === 1 && hard.state.deleted[0].conflictOf === '1')
  check('28 strict 胜版 rev 进位', hard.state.entries[0].rev === 10)
  check('28 冲突原因记为时钟漂移', hard.conflicts[0].reason === 'clock-skew')
}

// 29 strict：内容相同只是计数器不同 → 不制造冲突副本
{
  const at = '2026-01-09T00:00:00.000Z'
  const l = state([entry('1', 7, at)])
  const rr = state([entry('1', 3, at)])
  const hard = mergeState({ local: l, remote: rr, now: NOW, strict: true })
  check('29 strict 同内容零冲突', hard.summary.conflicts === 0 && hard.state.deleted.length === 0)
  check('29 strict 同内容取高 rev', hard.state.entries[0].rev === 7)
}

// 30 rememberTombstone：彻底删除即时记墓碑，低 rev 不覆盖高 rev
{
  const t = { '1': { rev: 6, deletedAt: '2026-01-01T00:00:00.000Z' } }
  rememberTombstone(t, entry('1', 4, '2026-01-09T00:00:00.000Z'), NOW)
  check('30 低 rev 不覆盖既有墓碑', t['1'].rev === 6)
  rememberTombstone(t, { id: '2', rev: 2, deletedAt: '2026-02-02T00:00:00.000Z' }, NOW)
  rememberTombstone(t, { id: '2' }, NOW)
  check('30 缺失 rev 按起点记入', t['2'].rev === 2 && t['2'].deletedAt === '2026-02-02T00:00:00.000Z')
  rememberTombstone(t, { id: '3' }, NOW)
  check('30 无 deletedAt 时补记当前时间', t['3'].deletedAt === NOW)
}

// 31 pruneTombstones：365 天窗口
{
  const inWindow = { a: { rev: 1, deletedAt: '2026-01-01T00:00:00.000Z' } }
  const outWindow = { b: { rev: 1, deletedAt: '2024-01-01T00:00:00.000Z' } }
  const broken = { c: { rev: 1, deletedAt: 'not-a-date' } }
  const merged = { ...inWindow, ...outWindow, ...broken }
  const pruned = pruneTombstones(merged, NOW)
  check('31 窗口内墓碑保留', !!pruned.a)
  check('31 超 365 天墓碑丢弃', !pruned.b)
  check('31 时间不可解析的墓碑丢弃', !pruned.c)
}

// 32 冲突表投影：带原 rev 与来源，不含密码等敏感字段
{
  const l = state([entry('1', 4, '2026-01-04T00:00:00.000Z', { password: 'L', privateKey: 'secret-L' })])
  const rr = state([entry('1', 4, '2026-01-06T00:00:00.000Z', { password: 'R' })])
  const hard = mergeState({ local: l, remote: rr, now: NOW, newId: () => 'cp-32' })
  const c = hard.conflicts[0]
  check('32 投影含原 rev 与时间', c.winner.rev === 4 && c.winner.updatedAt === '2026-01-06T00:00:00.000Z' && c.winner.side === 'remote')
  check('32 投影不含密码字段', !('password' in c.winner) && !('privateKey' in c.loser))
  check('32 本地版投影标记为 local', c.loser.side === 'local' && c.loser.alive === true)
}

// 33 两台电脑往返同步：B 的包被 A 拉取合并后，A 的合并包回写给 B → 两边收敛一致
{
  // 共同基线：1 双方都改（真冲突）、2 仅 A 删、3 未动、4 仅 B 改、5 仅 B 新增
  const A = state(
    [
      entry('1', 4, '2026-10-08T09:00:00.000Z', { password: 'A1' }),
      entry('3', 2, '2026-10-01T00:00:00.000Z'),
      entry('4', 1, '2026-10-01T00:00:00.000Z'),
    ],
    [entry('2', 5, '2026-10-07T00:00:00.000Z', { deletedAt: '2026-10-07T00:00:00.000Z' })],
    { 工作: { color: '#f00', icon: 'briefcase', isDefault: false, rev: 3 } },
  )
  const B = state(
    [
      entry('1', 4, '2026-10-08T10:00:00.000Z', { password: 'B1' }),
      entry('2', 4, '2026-10-01T00:00:00.000Z'),
      entry('3', 2, '2026-10-01T00:00:00.000Z'),
      entry('4', 2, '2026-10-08T08:00:00.000Z', { password: 'B4' }),
      entry('5', 1, '2026-10-08T07:00:00.000Z', { title: 'T-5-new' }),
    ],
    [],
    { 工作: { color: '#0f0', icon: 'briefcase', isDefault: false, rev: 4 } },
  )
  const tomb0 = { '9': { rev: 2, deletedAt: '2026-09-01T00:00:00.000Z' } }
  let seq = 0
  const pull = mergeState({ local: A, remote: B, tombstones: tomb0, now: NOW, newId: () => 'cp-' + (++seq) })
  const push = mergeState({ local: B, remote: pull.state, tombstones: pull.tombstones, now: NOW, newId: () => 'cp2-' + (++seq) })

  check('33 回写零新增冲突（absorption）', push.summary.conflicts === 0)
  check('33 往返后两边状态一致', normalize(pull) === normalize(push))
  check('33 真冲突只落一份副本且指回原条目', pull.state.deleted.filter(e => e.conflictOf === '1').length === 1)
  check('33 冲突默认保留较新一方', pull.state.entries.find(e => e.id === '1').password === 'B1')
  check('33 单边删除不被对端旧副本复活', !pull.state.entries.some(e => e.id === '2'))
  check('33 对端新增条目并入本机', pull.state.entries.some(e => e.id === '5'))
  check('33 标签定义按 rev 胜出', pull.state.tagDefs['工作'].color === '#0f0')
  check('33 既有墓碑在往返中不丢失', !!push.tombstones['9'] && push.tombstones['9'].rev === 2)
}

/* ═══════════════ ② 代数性质随机对拍 ═══════════════ */
/** 可复现的伪随机（固定种子，失败可原样重放） */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 随机生成一台机器的状态（同一 id 池，保证会出现交叉修改） */
function randomState(rnd, ids, label) {
  const entries = [], deleted = [], tagDefs = {}, history = {}
  ids.forEach((id) => {
    if (rnd() < 0.35) return // 这台机器没有这条
    const alive = rnd() > 0.25
    const e = entry(id, 1 + Math.floor(rnd() * 6), `2026-0${1 + Math.floor(rnd() * 8)}-01T00:00:0${Math.floor(rnd() * 9)}.000Z`, {
      password: label + '-' + id + '-' + Math.floor(rnd() * 4),
      title: 'T-' + id + (rnd() < 0.3 ? '-x' : ''),
    })
    if (!alive) e.deletedAt = `2026-0${1 + Math.floor(rnd() * 8)}-02T00:00:0${Math.floor(rnd() * 9)}.000Z`
    ;(alive ? entries : deleted).push(e)
    if (rnd() < 0.4) history[id] = [{ at: e.updatedAt, snap: { password: 'h' + Math.floor(rnd() * 4) }, fields: ['password'] }]
  })
  ;['a', 'b', 'c'].forEach((n) => {
    if (rnd() < 0.5) tagDefs[n] = { color: 'c' + Math.floor(rnd() * 3), icon: 'i' + Math.floor(rnd() * 3), isDefault: false, rev: 1 + Math.floor(rnd() * 4) }
  })
  return { entries, deleted, tagDefs, history, tags: [] }
}

/** 随机墓碑表 */
function randomTombstones(rnd, ids) {
  const t = {}
  ids.forEach((id) => { if (rnd() < 0.2) t[id] = { rev: 1 + Math.floor(rnd() * 6), deletedAt: NOW } })
  return t
}

const ROUNDS = 1000
let commFail = 0, idemFail = 0, strictCommFail = 0
let copySeq = 0
for (let round = 0; round < ROUNDS; round++) {
  const rnd = mulberry32(1000 + round)
  const ids = ['1', '2', '3', '4', '5', '6']
  const x = randomState(rnd, ids, 'X')
  const y = randomState(mulberry32(5000 + round), ids, 'Y')
  const t = randomTombstones(mulberry32(9000 + round), ids)
  // 副本 id 必须唯一（生产环境是 UUID）；比较时由 conflictOf 归一化，方向无关
  const opts = { tombstones: t, now: NOW, newId: () => 'cp-' + (++copySeq) }

  const xy = mergeState({ local: x, remote: y, ...opts })
  const yx = mergeState({ local: y, remote: x, ...opts })
  // 交换律：冲突副本 id 由 conflictOf 归一化后再比
  if (normalize(xy) !== normalize(yx)) commFail++
  // 幂等律：合并结果再与对端合一次必须完全不变
  const again = mergeState({ local: xy.state, remote: y, ...opts, newId: () => 'cp2-' + (++copySeq) })
  if (normalize(again) !== normalize(xy)) idemFail++

  // strict（时钟不可信，全量进冲突表）同样必须是交换的，否则冲突表两边不一致
  const strictOpts = { ...opts, strict: true, newId: () => 'sp-' + (++copySeq) }
  const sxy = mergeState({ local: x, remote: y, ...strictOpts })
  const syx = mergeState({ local: y, remote: x, ...strictOpts })
  if (normalize(sxy) !== normalize(syx)) strictCommFail++
}
check(`交换律随机对拍 ${ROUNDS} 轮`, commFail === 0, `${commFail} 轮不满足交换律`)
check(`幂等律随机对拍 ${ROUNDS} 轮`, idemFail === 0, `${idemFail} 轮不满足幂等`)
check(`strict 模式交换律随机对拍 ${ROUNDS} 轮`, strictCommFail === 0, `${strictCommFail} 轮不满足交换律`)

/* ═══════════════ 汇总 ═══════════════ */
console.log(`\n同步合并引擎：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
