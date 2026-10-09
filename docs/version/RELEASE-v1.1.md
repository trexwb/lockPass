# LockPass 版本日志 · v1.1

> 本文件记录 LockPass 每个次版本（v1.1.x）的发布日志，最新在前。

---

## 2026-10-09 · v1.1.4 发布汇总 —— 版本号推进 PATCH：v1.1.3 → v1.1.4（用户明确授权）

本轮浏览器扩展「保存新密码到桌面端」链路经多轮修复与增强，已具备完整可用闭环，经用户授权推进末位版本号至 **v1.1.4**（`npm run version:set 1.1.4` 已同步 package.json / tauri.conf.json / extension manifest / Cargo.toml / AGENTS.md / docs/spec.md 共 11 处，`version:check` 全绿）。以下分节为本版本包含的明细（最新在前，同日各节标注的「不推进版本号」为当时过程记录，统一由本节收尾）：

- **捕获浮层排查**（同日首节）：修复「保存一次后同页不再弹窗」的 dismiss 永久抑制与 TTL 贴边竞态；暂存 TTL 15s→25s、观察窗 14s→24s；补 `[LP_CAPTURE]` 形状诊断日志（不落凭据）。
- **标题增强**：新条目标题优先取网页 `document.title`（content → background → Rust `CapturePayload.title` 宽松清洗 → useVault 入库，缺省回退域名；`cargo test --lib` 14/14）。
- **SPA 免刷新弹层**：submit 后 frame 内观察器（地址变化/密码框消失启发式）主动触发确认，登录框在 iframe 内时经 `forwardToTop` 由顶层 frame 弹层。
- **无主机名帧回归修复**：三级域名解析（帧 hostname → referrer → 顶层 tab URL），manifest 补 `tabs` 权限；file:// 真·无身份页由后台明确拒绝。
- **「返回异常」误报三处根因**：Rust 终态槽位不再被 TTL 误删、410 单独映射 `expired`、浮层看门狗 195s 对齐后台 185s；capabilities 无效权限项导致的构建失败已修复。

发布验证：`cargo test --lib` 14/14、`node --check` 全部通过、`npm run vite:build` 通过、`npm run version:check` 11 处一致。GitHub Release 正文见 [`RELEASE-v1.1.4-github.md`](RELEASE-v1.1.4-github.md)。

---

## 2026-10-09 · 交互反馈与节流防抖专项 —— 不推进版本号（仍为 v1.1.4）

系统级体验巡检（`src/` 全量静态审计）后，把「操作必须有反馈」「异步操作可被重复触发」「高频事件未做节流」三类缺口一次性补齐。同日同一模块的体验打磨，**不推进版本号**（仍为 v1.1.4）。

### 1. 新增节流防抖公共设施

- `src/core/utils.js`：新增 `Utils.debounce(fn, wait=200)`（带 `cancel()` / `flush()`）。此前全仓无任何通用实现，只有 `PasswordGeneratorModal` / `editorDraftStore` / `saveVault` 三处各自的 ad-hoc 定时器。
- 未同时落地 `Utils.throttle`：巡检出的高频点（搜索、滚动、resize）经比对后全部属于「等停顿再算一次」的尾部合并语义，rAF 门控与 debounce 已覆盖，留一个无调用点的节流函数即死代码，故不引入。

### 2. 保存 / 危险类异步操作的防重入与进行中反馈

统一沿用 `ChangePwModal` 既有约定（`busy` ref + 入口 `return` 守卫 + `:disabled` + 文案切换）：

- `EntryEditorModal`：新增 `saving`，保存按钮在「加密 + 写库 + 文件同步」期间禁用并显示「保存中…」；连点不再产生重复历史版本；保存期间取消按钮一并禁用。
- `TagsModal`：新增共享 `busy`，覆盖新建/改名、删除、合并三条落盘路径与列表行的删除/合并入口。
- `SettingsModal`：新增 `dirBusy`（绑定数据目录）、`destroyBusy`（销毁保险箱，二次确认后到删库完成期间锁死，含右键菜单入口）。
- `useVault.bindRestoreFromDirectory` + `AuthView`：新增 `vaultState.restoreDirBusy`，锁屏「绑定已有数据目录」不再叠加多个目录选择器。
- `QrShareModal`：`generate()` 增加 `generating` 互斥锁（`loading` 中途会被置 false 以渲染容器，不能作互斥）；生成中快速切换条目改为合并成「结束后按最新条目补算一次」，结果不再与选中项错位。

### 3. 落盘失败不再假报成功（反馈正确性）

`saveVault()` 返回 `Promise<boolean>` 且失败时已自行弹出错误 toast，但多处调用方忽略返回值、紧跟着再弹「已保存 / 已删除」成功 toast，形成自相矛盾的假成功。现统一以落盘结果为准：

- `useVault`：`softDelete` / `restoreEntry` / `permanentDelete` / `emptyRecycleBin` / `rollbackEntry`。
- 组件侧 12 处：`DetailPanel`(2)、`SidebarNav`(7)、`QrImportModal`(2)、`ImportModal`(1)。
- `ImportModal.confirmImport` 额外复位 `importing` / `progress`，否则导入写入失败会把弹窗永久卡在「导入中」无法重试。

### 4. 高频事件节流 / 防抖

- `HeaderBar` 搜索：输入框文本与全局 `searchQuery` 解耦，180ms 停顿后才提交，消掉「每敲一个字符 → 整表重过滤 + 列表 epoch 重挂载 + 滚动复位/行高重测」；外部改写 `searchQuery`（清空 / Escape / 切筛选）仍会同步回输入框。
- `AppShell.onContentScroll`：改为 rAF 门控（每帧最多写一次响应式状态），与 `BaseSelect.requestLayout` 既有写法对齐。
- `AppShell` 视口 resize：200ms 防抖后再重算视口与行高（拖拽窗口不再逐帧触发 `measureRowHeight`），注册/解绑两侧同步替换。
- `particles.js`：`resize` 监听 150ms 防抖，`destroy()` 一并 `cancel()` 并解绑同一函数引用（原 `resize` 裸绑会泄漏）。

### 5. 交互态样式补全

- `base.css`：新增 `--btn-disabled-opacity` 令牌与全局 `.btn:disabled` / `.btn-icon:disabled` / `.btn-link-plain:disabled`（降透明度 + `not-allowed` + 按变体抵消 hover 抬升）。此前**不存在任何 `.btn:disabled` 规则**，散落在 `editor.css` / `entries.css` / `components.css` 的局部 `:disabled` 是唯一例外——这意味着代码里原本就写对的 `:disabled` 绑定在视觉上是不可见的。
- `base.css`：新增 `.btn.is-loading::before` 内联 spinner（`currentColor` + `prefers-reduced-motion` 降级），沿用 `ChangePwModal` 的文案切换，不引入新组件。
- `base.css`：`.btn-link-plain` 补 `:active` / `:focus-visible`；`modal.css` 补 `.modal-close:active` 按压反馈。
- `i18n`：新增 `editor.saving`、`tags.busying`、`sync.binding`、`settings.data.destroying`、`lock.bindingDirectory`（zh-CN / en-US 双语，按字典既有排序插入，未硬编码任何中文）。

### 有意未改动的项（安全 / 时序敏感）

- 自动锁屏定时器、剪贴板 30s 自清链路：属安全时序，不做节流。
- `saveVault` 的 150ms 写入合并与 `Promise<boolean>` 语义：保持不动，避免「硬保存」路径提前返回。
- `lockVault()` 未加成功 toast：界面切到锁屏本身已是明确反馈，自动锁屏场景弹 toast 反而会误报是用户手动触发。
- `toggleFavorite` 的乐观 UI：`saveVault` 失败已有错误 toast 兜底，不追加回滚。

### 验证状态

- `npm run vite:build` 通过（77 modules，`dist/assets/js/index.js` 647.93 kB / gzip 201.31 kB）。
- `npm run version:check` 11 处版本号一致，仍为 v1.1.4（三处真源未改动）。
- `src/i18n/zh.json` / `en.json` `JSON.parse` 通过。
- **未做人工 UI 回归**（需真实浏览器 / 桌面版操作）：重点待验证项为①保存按钮连点不再产生重复历史、②搜索输入停顿后列表才刷新、③拖拽窗口时列表不抖动、④落盘失败时只出现错误 toast 不再出现成功 toast、⑤销毁保险箱与目录绑定期间按钮为禁用态。
- 同类问题的持续打磨，**不推进版本号**；未执行任何 Git 提交类操作，全部改动留在工作树。

---

## 2026-10-09 · 捕获浮层排查：保存一次后同页不再弹窗的两处根因 —— 不推进版本号（仍为 v1.1.3）

用户反馈：成功保存过一个密码后，同一页面里新的登录不再触发浮层。静态排查整条状态机（PENDING 暂存 / CHECK 消费 / SAVE 清理 / session 恢复 / TTL 定时器）后，浮层链路本身无残留态阻塞下一次暂存，可确认的抑制点有两处：

1. **`captureDismissed` 页面实例级抑制过强（`extension/content.js` `showCapturePrompt`）**：浮层被点「忽略/×」一次后，同一文档实例内**同域名+同账号**的后续捕获永久静默——用户在同一测试页换路径重测（域名账号相同），若此前关过一次浮层，就表现为「触发过一次就不再弹」。修复：每次新的显式 submit（后台 `LP_CAPTURE_PENDING` 回 `ok:true` 且回传解析后的 `domain`）即解除对应键的抑制，与浏览器密码管理器「重新登录 = 重新询问」口径一致；被抑制时页面 console 输出 `[LP_CAPTURE] prompt suppressed` 便于识别。
2. **观察窗与暂存 TTL 贴边竞态（14s vs 15s）**：慢登录场景（提交后表单驻留 >14s）观察器命中时 CHECK 经两次往返到达后台，可能恰好超过 `CAPTURE_TTL_MS=15s` 新鲜度判定 → 静默不过滤弹层。修复：后台暂存 TTL 15s→**25s**、前端观察窗 14s→**24s**（保持观察窗 < TTL 的约束，两侧注释同步更新）。

另补非敏感诊断日志（仅形状：tabId / 域名 / 布尔 / 长度，不落凭据）：后台 `[LP_CAPTURE] pending stored / check 无暂存或已过期 / check 命中 / check 未命中启发式`，前端 `[LP_CAPTURE] watch fired`。下次复现时 `chrome://extensions` SW 控制台 + 页面 Console 可直接判定卡在哪一环。

### 验证状态

- `node --check` content.js / background.js 通过。
- **需人工回归**：重载扩展 → 同页保存一条成功后（含此前点过忽略的账号）再次登录 → 浮层应重新弹出；若仍不弹，把 SW 控制台与页面 Console 的 `[LP_CAPTURE]` 输出贴回定位。
- 同类问题持续修复，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 捕获保存增强：新条目标题优先取网页 document.title —— 不推进版本号（仍为 v1.1.3）

扩展捕获入库新建的条目此前标题固定为域名（`title: domain`），可读性差。现贯通标题链路：网页 `document.title` → 扩展暂存 → 桌面端确认入库时优先作为新条目标题，取不到（空/全空白）回退域名。

### 改动

- `extension/content.js`：新增 `captureTitle()`——优先顶层 frame `document.title`（跨域不可读时退本 frame），去换行/制表符、trim、截 200 字符；`LP_CAPTURE_PENDING` 载荷带 `title`。
- `extension/background.js`：`LP_CAPTURE_PENDING` 暂存载荷记录 `title`（剔除控制字符、截 200）；桌面通道 `POST /capture` 请求体带 `title`。页面桥通道整体转发暂存载荷，`title` 自动随行，无需改动 `ext-bridge.js`。
- `src-tauri/src/server.rs`：`CapturePayload` 新增 `#[serde(default)] title`（旧版扩展缺字段仍兼容）；标题为展示性字段，**宽松清洗**（去控制符、截 200 字符）而非参与 400 拒绝；`lockpass:capture-request` 事件载荷透传 `title`。
- `src/composables/useVault.js`：`handleExtensionCapture` 新建条目 `title = 清洗后的 payload.title || domain`；`confirmDesktopCapture` 把 `detail.title` 传入。已有条目（updated 分支）不改标题，去重/旅行模式口径不变。

### 验证状态

- `cargo test --lib`：14/14 通过（新增 `capture_sanitizes_page_title_and_defaults_when_absent`：控制符剔除、200 字符截断、缺省兼容）。
- `node --check` content.js / background.js / useVault.js 通过；`npm run vite:build` 通过。
- **需人工回归**：重载扩展 + 重启 `tauri:dev` → 在带 `<title>` 的测试页登录并保存 → 桌面端新条目标题应显示页面标题（无标题页回退域名）。
- 同日同模块追加改进，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 捕获浮层补强：SPA 登录后无需刷新页面即弹「保存到 LockPass？」 —— 不推进版本号（仍为 v1.1.3）

回归确认：上一条修复后浮层恢复弹出，但**需要手动刷新页面才出现**。根因是浮层触发完全依赖「新页面加载时的 `LP_CAPTURE_CHECK`」——SPA / fetch 登录不重载页面、也不跳转时，加载时机永远不出现，只有用户刷新才命中；登录框在无主机名 iframe 内时同理（顶层 frame 未变）。

### 改动

- `extension/content.js`：`LP_CAPTURE_PENDING` 暂存成功（后台回 `ok:true`）后，在**发起 submit 的 frame 内**启动登录成功观察器 `armCaptureWatch()`——400ms 轮询、上限 14s（刻意小于后台 15s TTL），判定「本 frame 地址变化（含 pushState）或密码框消失」（与后台 CHECK 同一启发式；`findPasswordInput` 已过滤 0×0 渲染框，`display:none` 隐藏的登录卡按消失判定）。命中即主动发起确认请求。
- `extension/content.js`：顶层 frame 走既有 `checkCapturePrompt()`；非顶层 frame 带 `forwardToTop: true` 发 `LP_CAPTURE_CHECK`，并由新增消息 `LP_CAPTURE_SHOW` 在顶层 frame 弹浮层（登录框在 iframe 内时用户也能即时看到）。
- `extension/background.js`：`LP_CAPTURE_CHECK` 命中后，若 `forwardToTop` 则 `chrome.tabs.sendMessage(tabId, { type:'LP_CAPTURE_SHOW', payload }, { frameId:0 })` 把凭据转发给顶层 frame（凭据仍取自后台暂存，不信任页面传入）。
- 传统整页跳转登录不受影响：新页面加载时的 `LP_CAPTURE_CHECK` 路径原样保留，两条路径谁先到谁消费（pending 消费即删，不会双弹）。

### 验证状态

- `node --check` content.js / background.js 通过。
- **需人工回归**：重新加载扩展 → SPA 测试页提交登录（不刷新）→ 数秒内浮层应自动弹出；登录框在 iframe 内的场景，浮层应出现在顶层页面右上角；登录失败（密码框保留且不跳转）不应打扰。
- 同类问题持续修复，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 回归修复：无主机名帧且 referrer 为空时保存浮层完全不弹 —— 不推进版本号（仍为 v1.1.3）

上一条 `captureDomain()` 修复引入了回归：测试后扩展**完全不弹「保存到 LockPass？」浮层**。根因是 content.js 中 `if (!capDomain) return` 的静默抑制——登录框位于无主机名帧（`all_frames: true` 注入的 srcdoc/about:blank iframe）且 `document.referrer` 为空时（受限 referrer 策略下很常见），submit 上报被直接丢弃，后台从未暂存凭据，浮层判定（`LP_CAPTURE_CHECK`）无从触发。此前旧行为虽 domain 为空但仍暂存弹层（保存时才 400），故浮层消失即为本抑制分支所致。

### 改动

- `extension/content.js` `captureOnSubmit`：删除 `!capDomain` 静默抑制，取不到主机身份也照常上报 `LP_CAPTURE_PENDING`；站点身份判定下沉到后台。
- `extension/background.js` `LP_CAPTURE_PENDING`：三级解析 `msg.domain`（帧 hostname → referrer）→ `extractDomain(sender.tab.url)`（顶层 tab URL 兜底，依赖新增 `tabs` 权限）；解析后仍为空（真·无站点身份，如 file:// 顶层页）才拒绝暂存 = 不弹浮层，与浏览器自身不保存本地页密码一致。
- `captureViaLocalServer` 的 `no-domain` 预检保留，覆盖 session 恢复出的旧空域记录等竞态。

### 验证状态

- `node --check` content.js / background.js 通过；解析链以四种场景模拟验证：顶层 http 页 / referrer 可用 iframe / referrer 为空 iframe（回归场景，tab URL 兜底命中）均正常暂存弹层，仅 file:// 顶层页拒绝。
- **需人工回归**：`chrome://extensions` 重新加载扩展（首次需接受新增的「读取浏览历史」`tabs` 权限提示）→ 原测试页提交登录 → 浮层应恢复弹出，点「保存」后桌面端弹确认框并入库；表单在无主机名帧内时条目应落在**宿主站点**域名下。
- 同类问题持续修复，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 桌面捕获「返回异常」误报三处根因修复 —— 不推进版本号（仍为 v1.1.3）

用户反馈扩展点「保存」仍提示：`保存失败：桌面版 LockPass 返回异常，请确认桌面端已解锁后重试`（`desktop-error`）。代码审查确认 `desktop-error` 有四个出口（POST 400 / 响应缺 id / 轮询 404·410 / 桌面回报 `error`），其中三处存在误报。

### 根因与改动

1. **终态结果被 TTL 误丢（`src-tauri/src/server.rs` `prune_expired_captures`）**：槽位按 `created_at` 超时清理且不区分状态——用户在 180s TTL 边缘点「保存」成功后，结果可能在下一次轮询（700ms 后）前被清掉，扩展收到 410/404 判「保存失败」，而凭据其实已落盘。修复：仅 `pending` 槽位按 TTL 丢弃；终态槽位由轮询一次性领取或锁屏 `lock()` 清空，数量受 `MAX_PENDING_CAPTURES` 挤兑约束。
2. **410 expired 并入 desktop-error（`extension/background.js`）**：Rust 明确用 410+`{"status":"expired"}` 表达「凭据槽位超时」，此前与 404 一起映射 `desktop-error`，content.js 的 `failExpired` 文案对桌面通道永不可达。修复：410 单独回 `expired`，浮层显示「凭据已过期，请重新登录后再保存」。
3. **看门狗 50s 早于后台 185s 等待上限（`extension/content.js`）**：上轮把桌面确认等待从 45s 放宽到 185s，但浮层 `CAPTURE_RESULT_WATCHDOG_MS` 仍是 50s——用户在 50s~185s 间确认，浮层已先显示「未收到保存结果」，真实回执到达时被 `settle` 丢弃。修复：看门狗 195s，并同步两处过时注释（45s→185s）。
4. **诊断补强（`extension/background.js`）**：POST 非 200 与响应缺 id 时 `console.warn` 记录状态码，便于在 `chrome://extensions` SW 控制台区分「请求 400 被拒」与「确认后桌面写盘失败」。

### 验证状态

- `cargo test --lib`：13/13 通过（含 expired→410、锁屏清槽、并发挤兑用例；改动后即跑通过首次全量）。
- `node --check` background.js / content.js 通过。
- **打包版无 DevTools 的诊断补强**：用户以 `npm run build` 产物复测仍报「返回异常」，release 包看不到桌面端 console 日志。桌面捕获入库异常与结果回报失败两处新增可见 toast（`ext.capture.saveError` / `ext.capture.reportLost`，zh/en 双语键），点桌面「保存」后真实异常原因直接在窗口弹出，无需控制台。`npm run vite:build` 通过；需再次 `tauri:build` 打包后此增强才进包。
- **未实测（需人工回归）**：①桌面端确认弹窗正常弹出并入库、扩展回显成功；②静置 >180s 再确认，验证扩展提示为「凭据已过期」而非「返回异常」；③若仍报 `desktop-error`，看桌面端控制台 `[LockPass] 桌面捕获入库异常` 与 SW 控制台 `/capture 被拒 status=` 定位真实原因。
- ⚠️ 验证期间发现 `src-tauri/capabilities/default.json` 被并行改动加入 22 条 `lockpass:allow-*` 权限项，导致 `cargo build/test` 构建脚本校验失败。已修复：这些命令均为应用自身 `generate_handler!` 自定义命令，Tauri v2 中不经 capability ACL（仅插件命令有权限项），无对应 schema 的引用串只会卡死构建；已删除无效权限项恢复提交版列表，前端 invoke 调用行为不变。修复后 `cargo test --lib` 13/13 通过。
- 同类捕获链路问题持续修复，**不推进版本号**（仍为 v1.1.3）。
- 未执行任何 Git 提交类操作。

---

## 2026-10-09 · 「返回异常」根因更正：无主机名帧 + `tabs` 权限缺失导致兜底失效 —— 不推进版本号（仍为 v1.1.3）

用户澄清测试页**并非 file:// 打开**，上一条对「本地页面」的归因不成立，更正如下。`domain_len=0` 这一 Rust 日志证据仍然有效，完整根因链是两条叠加：

1. **content.js 以 `all_frames: true` 注入所有框架**：登录表单若位于无主机名的帧（`srcdoc` / `about:blank` 动态创建的内嵌登录框等，真实站点常见），帧内 `location.hostname` 为空。
2. **manifest 缺少 `tabs` 权限**：`background.js` 中 `domain: msg.domain || extractDomain(sender.tab.url)` 的兜底里 `sender.tab.url` 恒为 `undefined`，兜底形同虚设 → 载荷 domain 为空 → Rust 必拒 400 → 扩展显示「桌面版返回异常」。

### 改动

- `extension/content.js`：新增 `captureDomain()` 主机名解析链（当前帧 hostname → `document.referrer` 宿主页面 hostname → 空则不弹保存浮层），`captureOnSubmit` 改用其结果。
- `extension/manifest.json`：`permissions` 补 `"tabs"`，使既有的顶层 tab URL 兜底真正生效。**注意：重新加载扩展时 Chrome 会提示新增「读取浏览历史」权限，需确认一次；若不接受可回退此权限项，仅靠 referrer 链兜底。**
- 上一条的 `no-domain` 预检与文案保留，作为最后一道明确提示。

### 验证状态

- `node --check` content.js、manifest JSON 校验通过。
- **需人工回归**：`chrome://extensions` 重新加载扩展（接受新权限）→ 原测试页登录 → ①不再报「返回异常」，桌面端弹出确认框；②若该页表单在无主机名帧内，入库条目应落在**宿主站点**域名下。
- 同类问题持续修复，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 「返回异常」真实根因确诊：file:// 页面无主机名被 Rust 400 拒绝 —— 不推进版本号（仍为 v1.1.3）

dev 复测仍报 `保存失败：桌面版 LockPass 返回异常`。通过 Rust 侧新增的 `[capture]` 终端追踪日志确诊：`POST /capture -> 400 invalid payload: domain_len=0 username_len=4 password_len=9` —— 测试页以 **file:// 打开**，`location.hostname` 为空串，载荷在入口即被拒，与超时/回报/TTL 等此前修的所有分支无关。

### 改动（三层）

- `extension/content.js` `captureOnSubmit`：`location.hostname` 为空的页面（file:// 等无站点身份）不再弹保存浮层，与浏览器自身不保存本地页密码的行为一致。
- `extension/background.js` `captureViaLocalServer`：POST 前预检 `payload.domain`，为空直接回 `no-domain`，不再向 Rust 发注定 400 的请求。
- `extension/content.js`：新增 `failNoDomain` 文案与 `no-domain` 错误码映射：「当前页面没有主机名（如本地文件页面），无法保存到 LockPass」，desktop-error 文案此后只对应真实的 400（其他形状）/404/前端 error。

### 验证状态

- `node --check` content.js / background.js 通过；Rust 测试 13/13 保持通过（未改 Rust）。
- **需人工回归**：`chrome://extensions` 重新加载扩展后，①file:// 本地测试页：登录不再弹保存浮层；②http(s) 页面（如本地起 `python3 -m http.server` 的测试站）：登录→浮层保存→桌面确认→入库成功，扩展回显成功。
- 提示：捕获/保存功能仅适用于 http(s) 站点；用 file:// 双击打开的测试页验证会命中本条拦截，请改经本地 HTTP 服务访问。
- 同类问题根因确诊修复，**不推进版本号**（仍为 v1.1.3）；未执行任何 Git 提交类操作。

---

## 2026-10-09 · 捕获/填充链路未捕获 Promise：`No tab with id` 修复 —— 不推进版本号（仍为 v1.1.3）

扩展控制台报错 `Uncaught (in promise) Error: No tab with id: <id>`。

### 根因

- 修复上一条「保存失败（expired）」前，`LP_CAPTURE_SAVE` 在 `captureIssued` 为空时**直接返回 expired**，根本不会调用 `forwardCaptureToLockPassPage`。修复后流程进入该函数：它遍历 `appBridgeTabs` 向已握手的 LockPass 页面桥 tab 发 `LP_CAPTURE_FORWARD`。若这些 tab 已关闭（`chrome.tabs.onRemoved` 尚未回收登记、或 SW 重启残留旧握手的竞态），`chrome.tabs.sendMessage` 即 reject `No tab with id`。
- 多个异步入口的 `.then` 链 / 立即执行 async IIFE 没有 `.catch`，一旦内部 await 的 Promise reject 即泄漏为全局「Uncaught (in promise)」；`sessionSave`/`sessionRemove` 里的 `chrome.storage.session.set` 也未 `.catch` 其异步 reject。

### 改动（`extension/background.js`）

- `forwardCaptureToLockPassPage`：向页面桥发消息前先 `chrome.tabs.get(tabId)` 预校验 tab 存活，不存活则跳过并清理登记，从根上避免向已关闭 tab 发消息。
- `LP_CAPTURE_CHECK`、`LP_CAPTURE_SAVE` 两个 async IIFE 末尾补 `.catch` 兜底（仅 `console.warn`）。
- `SUGGESTION_FILL` 的 `sendMultiFill(...).then(...)` 链补 `.catch`（捕获后回 `sendResponse` 失败）。
- `sessionSave`/`sessionRemove` 的 `chrome.storage.session.set` 补 `.catch(() => {})`。

### 边界与验证状态

- `chrome.tabs.sendMessage` 对不存在 tab 的 reject 原本已在 `forwardCaptureToLockPassPage` 的 try/catch 内被吞，但预校验可彻底消除该次 API 调用，更干净；预校验存在 TOCTOU（极小概率校验后 tab 才关闭），此时仍由原有 try/catch 兜底。
- **未实测（需人工回归）**：在 `chrome://extensions` 重新加载后，确认控制台不再出现 `No tab with id` 报错；网页版（开 lockpass.html）与桌面版两种配对场景各保存一次。
- 版本号：同类捕获链路健壮性修复，**不推进**（仍为 v1.1.3）。
- 未执行任何 Git 提交类操作。

---

## 2026-10-09 · 桌面版配对场景保存失败（MV3 SW 回收丢失捕获态 + desktop-error 文案）—— 不推进版本号（仍为 v1.1.3）

用户反馈「浏览器扩展保存新密码时没有保存成功」，确认为**桌面版已配对**场景。此前已修复 TTL 倒挂与 expired/timeout 文案（网页版页面桥），但桌面版的核心断点不同：`capturePending`/`captureIssued` 是 MV3 Service Worker 纯内存 Map，SW 空闲约 30s 被回收后全部清零——用户看到的浮层还在，但点「保存」时 `captureIssued` 为空 → 判 `expired` → 显示「保存失败」。

### 根因

1. **MV3 Service Worker 回收丢失捕获态（主因）**：`capturePending`（`LP_CAPTURE_PENDING` 登记）和 `captureIssued`（`LP_CAPTURE_CHECK` 转移）均为 SW 内存 Map。SW 被回收后，这两个 Map 清零。用户在网页上看到保存浮层并点「保存」→ `LP_CAPTURE_SAVE` → `captureIssued.get(saveTabId)` 返回 `undefined` → 判 `expired` → 保存失败。
2. **`desktop-error` 错误码无文案映射**：`captureViaLocalServer` 返回的 `desktop-error`（Rust 侧 400/404/410 等）在 `captureFailText()` 里无对应分支，落入兜底「保存失败，请稍后重试」，掩盖桌面端真实异常。

### 改动

- `extension/background.js`：`capturePending`/`captureIssued` 双写到 `chrome.storage.session`（MV3 专有，跨 SW 重启存活，浏览器关闭自动清除）。正常路径走内存（同步快），SW 重启后的首次 `LP_CAPTURE_CHECK`/`LP_CAPTURE_SAVE` 才从 session 恢复到内存 Map。新增 `sessionSave`/`sessionRemove`/`sessionRestore` 三个辅助函数。
- `extension/background.js`：`LP_CAPTURE_CHECK` 和 `LP_CAPTURE_SAVE` 因 `await sessionRestore` 变为异步，改用 async IIFE + `return true` 保持 `sendResponse` 有效。
- `extension/content.js`：`CAPTURE_TEXTS` 新增 `failDesktopError`，`captureFailText()` 增加 `desktop-error` 分支。

### 边界与验证状态

- 安全边界未变：`chrome.storage.session` 只能由扩展写入，内容脚本无法伪造（与原内存 Map 安全模型一致）；凭据在浏览器关闭后自动清除。
- **未实测（需人工回归）**：需在 `chrome://extensions` 点「重新加载」后测：①登录后静置 ≥30s（等 SW 被回收）再点保存；②确认桌面端确认框弹出后点「保存」入库成功。
- 版本号：属 v1.1.3 同模块同类问题的延续修复，**不推进**（仍为 v1.1.3）。
- 未执行任何 Git 提交类操作，改动只留在工作树。

---

## 2026-10-09 · 浏览器扩展保存新密码失败（三处根因修复）—— 不推进版本号（仍为 v1.1.3）

用户反馈「浏览器扩展保存新密码时没有保存成功」。完整走查保存链路 `content.js`（submit 捕获）→ `background.js`（`LP_CAPTURE_SAVE`）→ `lockpass-bridge.js` → 页面 `ext-bridge.js`（`capture`）→ `useVault.handleExtensionCapture()` 落库，并核对桌面 HTTP 通道（`POST /capture` → Rust 槽位 → `server_capture_report` → `GET /capture/status`），确认**协议本身无缺陷**（requestId 回传、`capture-result` 均齐全；`is_report_status()` 白名单含 `error`；`server_capture_report(id, status)` 与前端 `invoke` 参数名一致）。问题出在凭据有效期、后台内存态两处硬伤，外加一处错误码被吞。

### 根因

1. **MV3 Service Worker 回收导致页面桥失联（主因）**：`background.js` 的 `appBridgeTabs` / `pageBridgeReady` 均为 Service Worker 内存态，空闲约 30s 被回收清零；而 `lockpass-bridge.js` 只在首次发现页面标记时 `post('probe')` 一次，LockPass 页面也只在解锁瞬间广播 `ready`。于是「先开着 LockPass 页面 → 过一会儿去网站登录 → 点保存」必然走到 `forwarded=false` → 回退桌面通道 → 未配对即返回 `no-lockpass`，浮层提示「请先打开并解锁 LockPass 页面后重试」，而用户视角里页面明明一直开着。
2. **浮层展示时长与凭据 TTL 倒挂（确定性缺陷）**：`LP_CAPTURE_CHECK` 登记 `captureIssued` 后，浮层可停留 20s 才自动收起，但 `LP_CAPTURE_SAVE` 仍按 `CAPTURE_TTL_MS`（15s）判定有效性 —— 用户在第 15–20s 之间点「保存」，必然拿到 `{ok:false, error:'expired'}`。
3. **错误码被吞**：`content.js` 的 `captureFailText()` 未处理 `'expired'`（后台实际会下发），落入兜底文案「保存失败，请稍后重试」，掩盖真实原因，使上述两类问题表现为同一句话。

### 改动

- `extension/lockpass-bridge.js`：末尾新增 `keepAliveBridge()`，令牌有效期间每 20s 重发 `LP_READY`，抵消 SW 回收导致的失联；无令牌时 5s 静默轮询等待，解锁后自动接上。
- `extension/background.js`：新增 `CAPTURE_ISSUED_TTL_MS = 90000`，`LP_CAPTURE_SAVE` 的有效期判定由 `CAPTURE_TTL_MS` 改为它；`capturePending`（用于「新页面加载时判定是否跳转/密码框消失」）仍沿用 15s，两者语义分离。
- `extension/background.js`：`LP_READY` 原先无条件 `cachedEntries = []` / `passwordCache = {}`，心跳每 20s 触发一次会反复清空已取条目、徒增取数往返；改为仅「首次握手 / 此前未就绪」时重置缓存。
- `extension/content.js`：`CAPTURE_TEXTS` 新增 `failExpired`，`captureFailText()` 增加 `expired` 分支，让真实失败原因可见。

### 边界与验证状态

- 安全边界未变：令牌仍是第一道闸（未解锁不广播心跳），凭据仍只在扩展进程内存短暂存在、不落盘；`file://` 本地页面信任开关、`sender.url` 白名单、一次性领取等机制均未改动。
- **未实测（需人工回归）**：本轮未在真实浏览器验证。需在 `chrome://extensions` 点「重新加载」后测：①解锁后静置 ≥1min 再去网站登录保存（心跳）；②浮层出现后等 20s 以上再点保存（TTL 倒挂）。仅执行了 `node --check` 语法校验与 IDE 诊断（`read_lints` 无输出）。
- 待用户确认实际通道：若为桌面版配对而非网页版页面桥，根因 1 不适用，需改沿桌面通道继续排查。
- 回归风险：仅改 `extension/` 下三个扩展脚本，不涉及 `dist/` 产物、保险箱数据模型与既有解锁方式。
- 版本号：属 v1.1.3「扩展捕获」同模块同类问题的延续修复，按规范**不推进**（仍为 v1.1.3）；是否单开 v1.1.4 由用户决定。未执行 `npm run version:set`，`version:check` 仍为 11 处一致。
- 未执行任何 Git 提交类操作，改动只留在工作树。

---

## 2026-10-08 · 生物识别解锁启用失败（「加密操作失败」）修复 —— 不推进版本号（仍为 v1.1.3）

用户在设置里打开「生物识别解锁（macOS 面容 / 触控 ID）」即提示「加密操作失败」。该文案是 `settings.security.bioErr.CRYPTO_ERR`，来自 Rust 兜底分支：任何未映射的 CFError 都被归为 `CRYPTO_ERR`，且前端把 `detail` 丢掉，于是系统侧真实原因完全不可见。用临时 `examples/probe_se.rs` 直接调 Security 框架复现后，确认是**两个相互独立的失败点**。

### 根因

1. **访问控制标志非法（代码缺陷，必现）**：`SecAccessControlCreateWithFlags(userPresence | BiometryCurrentSet | PrivateKeyUsage)` 返回 **OSStatus -50**，Apple 侧原文即 `kSecAccessControlUserPresence can be combined only with kSecAccessControlApplicationPassword and kSecAccessControlPrivateKeyUsage` —— `userPresence` 与 `biometryCurrentSet` 互斥，不能叠加。第一步就失败，SE 密钥根本不会创建。
2. **未签名构建拿不到钥匙串访问权限（环境前提）**：标志修正后（`biometryCurrentSet | PrivateKeyUsage`，本机实测创建成功）继续建 SE 密钥，返回 **errSecMissingEntitlement(-34018) “failed to add key to keychain”**。`src-tauri/entitlements.plist` 里已声明 `keychain-access-groups`，但本机 `codesign -dv` 显示产物是 `adhoc,linker-signed` / `TeamIdentifier=not set`，`security find-identity -v -p codesigning` 为 **0 valid identities**，entitlement 从未生效；给 ad-hoc 二进制手工注入该 entitlement 会被内核直接 kill（退出 137）。即**生物识别解锁只在用 Apple 开发者证书签名的构建里可用**。
3. 附带修正：`kSecAttrAccessControl` 原先写在创建字典顶层。Apple 文档的布局是私钥属性（访问控制 / 标签 / applicationTag / `kSecAttrIsPermanent`）置于 `kSecPrivateKeyAttrs` 子字典；顶层写法不属文档化布局，最坏情况是私钥没带上访问控制（使用不再要求生物验证）——安全上不可接受。缺 `kSecAttrIsPermanent` 也解释了「即使启用成功 `status.enabled` 仍恒 false」的隐患。

### 改动

- `src-tauri/src/passkey.rs`：标志改为 `FLAG_BIOMETRY_CURRENT | FLAG_PRIVATE_KEY_USAGE`（删除 `FLAG_USER_PRESENCE`，并注明互斥原因）；`create_se_key` 按文档布局把标签 / applicationTag / 访问控制 / `perm=true` 收进 `kSecPrivateKeyAttrs`；新增 `ENTITLEMENT_ERR` 错误码，把 -34018 从 `CRYPTO_ERR` 兜底里分出来并给出中文原因；文件头补齐签名前提，并修正「生成随机 Device Unlock Key」的过期描述（实际封装的是前端派生的 32B Vault Key）。手写的 CFString 字面量逐个与本机框架导出值比对（`perm` / `private` / `aku` / `nleg` / `tkid` / `com.apple.setoken` / ECIES 算法串均一致），且改用嵌套布局后建钥仍只停在 -34018 而非属性错误，说明 `class/type/bsiz/atag/labl/accc` 这些键也被框架正常识别。
- `src/components/modals/SettingsModal.vue`：新增 `bioErrText(res)`，两处失败 toast 统一带出 `detail`（截断 160 字符），不再只剩一句无信息量的「加密操作失败」。
- `src/i18n/zh.json` / `en.json`：补 `settings.security.bioErr.ENTITLEMENT_ERR` 与 `vault.lock.errBio.ENTITLEMENT_ERR`（后者防止未命中键直接显示键名）。
- `docs/passkey.md`：按实测结论改写访问控制标志、私钥属性布局与签名前提三节；删除「系统密码回退」「随机 Device Unlock Key」等与实际实现不符的描述（生物验证只走面容/触控，被封装的就是主密码派生的 Vault Key）；补记「未签名构建必然 `ENTITLEMENT_ERR`」边界与本次实测证据。
- `docs/spec.md` §8 未来规划：把「macOS Secure Enclave 已落地」改成「代码链路已落地但尚未在签名构建上端到端验证」，避免路线图文档给出超出证据的完成度。

### 边界与验证状态

- 已实测：-50 由标志叠加引起（去掉 `userPresence` 后创建成功）；`kSecPrivateKeyAttrs` 嵌套布局被框架接受，失败点仅剩 -34018，说明不是属性布局问题；`keychain-access-groups` 无法用于 ad-hoc 签名。
- **未实测**：本机没有任何代码签名身份，`enroll → 生物验证 → unlock` 全链无法在此环境端到端验证。需在 Apple 开发者证书签名的构建上回归：启用一次 → 锁屏出现生物入口 → 面容/触控验证后解出保险箱；同时确认 `status.enabled` 为 true（验证 `kSecAttrIsPermanent` 的效果）。
- 回归风险：本次只动 macOS 侧生物识别链路，不触碰保险箱数据模型与既有解锁方式；未启用过生物识别的用户不受影响。
- 构建校验：`cargo check --all-targets` 无 warning、`cargo test --lib` 13/13、`npm run vite:build` 通过（`index.js` 644.37 kB / gzip 199.99 kB）、`npm run version:check` 11 处一致；临时探针 `src-tauri/examples/probe_se.rs` 已删除，不留在这份仓库里。
- 版本号：属同日同一模块的延续修复，按规范**不推进**（仍为 v1.1.3）；是否单开 v1.1.4 由用户决定。

---

## 2026-10-08 · v1.1.3

用户明确指示将本日的三批改动归入修订版本发布（PATCH 自增：v1.1.2 → v1.1.3）。下方同日三条记录撰写时按「同类问题延续修复不推进版本号」规则标注，正文依「发布日志只增不改」原则保留原样，版本归属以本节为准。

### 包含内容

- 旅行模式与扩展自动捕获的代码审查跟进修复 9 项（见下「旅行模式 / 扩展捕获安全审查修复」）
- §5 / §6 两处未闭环口子（见下「两处未闭环口子」）：QR 扫码导入的 TOTP 绑定目标改为只在旅行模式可见集合内挑选；桌面版本地 HTTP 通道接入扩展自动捕获
- 四项遗留收尾（见上「收尾四项遗留」）：删除已排除的密钥文件双因素孤立源码；待确认捕获槽位支持并发；扩展等待期间顶住 MV3 后台回收并给浮层加兜底；`server.rs` 抽出可注入事件发射后补 13 项 `cargo test`

### 用户可见变化

- **桌面版可用浏览器扩展自动保存密码**：扩展浮层点「保存」后，凭据经 `127.0.0.1:33555` 本地通道交给桌面窗口，仍必须在桌面窗口点「保存」才入库；首次使用需在扩展弹窗点「连接桌面版 LockPass」并核对桌面窗口「允许配对」上的一致数字
- 扩展浮层新增失败文案：桌面端未解锁 / 45s 内未点保存 / 已在桌面版忽略 / 未收到保存结果（50s 兜底后按钮恢复可点，不再永久停在「保存中…」）
- 旅行模式开启时，扫码导入的 TOTP 只会绑到可见条目，不会静默改写被隐藏的敏感条目
- 密钥文件双因素的未接线源码被删除；该功能从未在发布版本中提供入口，**不影响任何已有保险箱数据与解锁方式**

### 边界与不变量

- 明文密码不经 Rust 留存：`POST /capture` 只登记 `{id, created_at, status}`，凭据随 `lockpass:capture-request` 事件交给窗口，槽位 60s 过期即丢弃，锁定即清空
- 同时待确认最多 4 个槽位，按 id 独立回报、各自一次性领取；超出上限挤掉最旧一次并让其轮询得到明确失败
- 扩展捕获凭据只投递给浏览器提供、页面无法伪造的 `sender.url` 命中白名单的应用页面；`file://` 本地页面需在扩展弹窗显式放行
- 无数据模型变更，v1.1.0 ~ v1.1.2 的保险箱可直接升级

### 文档

- 面向用户的 GitHub Release 正文另存为 `docs/version/RELEASE-v1.1.3-github.md`（含产物清单、扩展包 Pages 地址、macOS 首次打开需执行的 `xattr -dr com.apple.quarantine "/Applications/LockPass.app"`），`docs/version/README.md` 索引与「GitHub Release 正文单独成文」约定同步
- 同步补齐此前缺失的用户文档：`README.md`（功能清单补 TOTP / 健康报告 / 过期提醒 / 旅行模式 / 自动捕获，数据存储与安全特性补旅行模式与捕获确认，扩展章节补自动捕获与连接桌面版）、`extension/README.md`（自动捕获与桌面配对流程、失败文案对照、权限与安全模型更正为 `activeTab` + `storage` + 本机 host 权限、限制更新至 v1.1.3）、`docs/spec.md`（§3.16 补捕获与桌面通道、新增 §3.21 旅行模式、§8 未来规划勾选状态更正为实际落地情况）、`docs/lockpass-扩展使用指南.md`（本地服务接口表补 `/capture` 与 `/capture/status`）

### 勘误

- 下方同日「两处未闭环口子」条目把 `/capture/status` 的等待态写成「未决 202」，实际实现（`src-tauri/src/server.rs`）对 `pending` 返回 **200 `{status:"pending"}`**，扩展据此继续轮询；历史条目正文依「只增不改」保留原样，以本节为准

### 验证

- `cargo test --lib` 13/13（3 轮复跑一致）、`cargo check` 无 warning
- `npm run vite:build` 通过（`index.js` 643.72 kB / gzip 199.75 kB），`dist/sw.js` 缓存名 `lockpass-v1.1.3`
- `npm run version:set 1.1.3` 覆盖 8 文件 9 处，`npm run version:check` 11 处一致（含 `extension/manifest.json` 随主应用同步至 1.1.3）
- 浏览器回归（`file://` dist，测试库用后即毁）：创建保险箱 → 3 笔并发捕获（恰好 3 次确认框，`created / created / rejected`）→ 刷新解锁读回 2 条条目；扩展浮层三条回调路径（永不返回 / `lastError` / 正常回 `created`）用一次性夹具验证
- 未覆盖：真实 Tauri 窗口的 GUI 端到端（macOS WKWebView 无 CDP，解锁与配对确认无法程序化注入）；成功腿由「真实 `127.0.0.1` 监听 + 真实 `route()` 分派」的 Rust 用例承担

---

## 2026-10-08 · 收尾四项遗留（基准 v1.1.2，不推进版本号）

同日 §5/§6 同类问题的延续收尾，按规范不推进版本号（`npm run version:check` 仍为 v1.1.2）。

### 新增

- **桌面本地服务首次有测试覆盖（src-tauri/src/server.rs）**：`route()` 原先直接依赖具体类型 `AppHandle`（`tauri::Emitter` 含泛型方法，非 object-safe），无法在测试里替换，两条 `/capture` HTTP 腿此前只有 `cargo check` + 人工审查。现把事件发射抽成可注入的 `EventSender` 闭包、worker 循环抽成 `spawn_workers`，`cargo test --lib` 新增 13 项用例，其中多数在 `127.0.0.1` 随机端口上起**真实 tiny_http 监听**并用裸 TCP 发 HTTP 请求，覆盖：无令牌 / 错令牌 401、已配对未解锁 409、载荷校验 400（空域名、域名含空白或 `/`、空口令、账号与口令含控制字符、非法 JSON）、槽位登记与 `lockpass:capture-request` 事件字段（域名归一化小写去空白）、槽位内不含明文、`pending → 回报 → 一次性领取 → 再轮询 404`、未知 id 404、TTL 过期 410 且丢弃、并发两笔各自独立回报、超过上限淘汰最旧、锁定即清空待确认，以及「配对 → 领取令牌 → 用该令牌成功捕获」的真实串联。3 轮复跑无抖动

### 修复

- **待确认捕获槽位并发互相顶掉（server.rs）**：`/capture` 只保留单槽，两个标签页几乎同时点保存时，先发起的那次轮询会因 id 已被覆盖而拿到 404，浮层误报「保存失败」而用户其实只在桌面端看到一个确认框。现改为最多 4 个槽位（`MAX_PENDING_CAPTURES`）按 id 独立登记、独立回报、各自一次性领取，超出上限挤掉最旧槽位并让该次轮询得到 404 明确失败；每次登记前先清超时槽位，`lock()` 清空全部
- **MV3 后台在等待桌面确认期间被回收（extension/background.js、content.js）**：桌面通道要等用户在桌面窗口点「保存」，扩展轮询上限 45s，而后台 30s 空闲即被回收且纯 `fetch` 不算扩展事件——后台一旦被杀，`sendResponse` 通道随之消失，浮层永远停在「保存中…」且按钮禁用。现在轮询每 20s 真走一次 `chrome.storage.local.get`（顺带确认令牌仍在，桌面端重置过就立即结束等待）顶回空闲计时器；浮层再加 50s 兜底 `watchdog` 恢复按钮并提示「未收到保存结果：请在桌面版 LockPass 窗口查看是否已入库」，`settled` 标志保证兜底与迟到结果不会互相覆盖
- **`chrome.runtime.lastError` 未消费（extension/content.js）**：后台不可达时回调收到 `lastError` 而此前未读取，除误报文案外还会在控制台留下 Unchecked runtime.lastError。现显式分支处理并给出通用失败文案

### 清理

- **删除已排除功能的孤立源码（src/core/keyfile.js、src/main.js、src/core/crypto.js）**：密钥文件双因素已于同日判定排除，其零调用方实现随之删除——`window.KeyFileUtils`（`.key` 文件生成 / 解析 / SHA-256 指纹）整模块、`main.js` 的 import，以及 `CryptoUtils.composeMaterial` / `deriveKeyMaterial` / `deriveKeyBytesMaterial` 三个派生函数与导出。删除后 `CryptoUtils` 仅剩在用的 12 个成员，`window.KeyFileUtils` 不再存在

### 说明

- 回归：`cargo test --lib` 13/13（3 轮复跑一致）、`cargo check` 无 warning、`npm run vite:build` 通过（645.52 → 643.72 kB）、`node --check` 扩展两文件通过、`npm run version:check` 11 处 v1.1.2
- 前端回归（`file://` dist 新建测试库，验证删码后的加解密链路）：创建保险箱 → 3 笔并发捕获（恰好 3 次确认框，`created / created / rejected`，被拒站点未落库）→ 刷新后用同一主密码解锁并读回 2 条条目；测试库已清毁，未留数据
- 扩展浮层三条回调路径用一次性夹具验证（假 `chrome` + 压缩定时器，验证后已删除）：回调永不返回 → 命中 50s 兜底且迟到结果不覆盖文案；回调带 `lastError` → 通用失败且按钮恢复；正常回 `created` → 成功文案并 1.6s 自动收起
- 后台保活本身（`chrome.storage.local.get` 顶回空闲计时器）无法在无扩展宿主的环境验证，验证的是其后果（浮层不再可能永久卡住）
- 真实 Tauri 窗口的端到端（窗口内输入主密码解锁 + 点「允许」配对）仍无可编程注入点（macOS WKWebView 无 CDP，IPC 只能从 webview 内部发起），故成功腿以「真实监听 + 真实 route 分派」的 Rust 用例覆盖，不含 GUI 交互

---

## 2026-10-08 · 旅行模式 / 扩展捕获的两处未闭环口子（基准 v1.1.2，不推进版本号）

延续同日的安全审查跟进（属 §5 旅行模式 / §6 扩展自动捕获的同类问题补全，按规范不推进版本号，`npm run version:check` 仍为 v1.1.2）。

### 修复

- **QR 扫码导入的 TOTP 绑定目标未过滤旅行模式隐藏条目（QrImportModal.vue）**：`pickBindingCandidate()` 从全量 `vaultState.entries` 挑选「无 TOTP 且无敏感数据」的条目，开启旅行模式时扫描到的密钥可能落到已被隐藏的敏感条目上——用户看不见这条改动，等同于静默改写隐藏数据。现改为只在 `visibleEntries()` 集合内挑选；`autoImport()` 的合并写盘路径仍按全量集合，避免覆盖隐藏条目而丢数据
- **桌面版本地 HTTP 通道未接入扩展自动捕获（server.rs / lib.rs / tauri-server-bridge.js / useVault.js / extension/background.js / content.js）**：桌面端没有页面桥时，扩展浮层点「保存」只会得到「请先打开并解锁 LockPass 页面」。现补齐整链路：Rust 新增 `POST /capture`（Bearer 令牌校验 + 未解锁返回 409 + 域名/账号/密码长度与控制字符校验），只登记 `{id, created_at, status}` 的待确认槽位（**明文不经 Rust 内存保留**，凭据随 `lockpass:capture-request` 事件交给窗口；槽位 60s TTL，锁定即清空），`GET /capture/status?id=` 一次性领取结果（未决 202 / 过期 410 / id 非法 404）；新增 `server_capture_report` 命令回报 `created | updated | exists | error | rejected`；扩展侧在无可用页面桥且本地服务就绪时改走 HTTP 通道并轮询结果回浮层，45s 超时与「桌面端未解锁 / 已超时 / 已取消」分别给出对应文案。入库仍必须经桌面窗口的用户确认，绝不自动写盘
- **捕获确认随 `useVault()` 实例数重复注册（useVault.js）**：`lockpass:capture-request` 监听写在 composable 函数体内，而 `useVault()` 被 20 余个组件调用，一次捕获会弹出多个确认框并重复回报结果。现把监听与串行链收敛到模块作用域（只注册一次），确认逻辑由最新实例提供，与既有 `activityResetFn` 同一约定

### 说明

- 授权依据仍是已配对的一次性 Bearer 令牌（扩展身份无法在 HTTP 层自证 origin），配对流程不变
- 桌面窗口确认要等人操作，扩展侧等待上限取 45s（短于 Rust 槽位 60s TTL）；若这期间 MV3 Service Worker 被回收，浮层只会显示「保存失败，请稍后重试」，桌面端确认后的入库不受影响（无数据丢失，重试即可）
- 浏览器回归（`file://` dist）：4 次捕获请求 → 恰好 4 次确认框、回报依次为 `created / updated / exists / rejected`，被拒绝的站点未落库；缺 `password` / 缺 `id` / 空域名的畸形事件被忽略且不留槽；未解锁态直接回报 `rejected` 且不弹框；otpauth 二维码在旅行模式开启时把 TOTP 绑到可见条目、隐藏敏感条目仍无 TOTP；`npm run vite:build`、`cargo check`、`node --check`（扩展两个文件 + 桥）通过
- 回归覆盖了「事件 → 确认 → 入库 → 回报」的前端链路（以 stub 的 `window.TauriServer.reportCapture` 记录回报）；`POST /capture` 与 `/capture/status` 两条 HTTP 腿经代码审查 + 编译校验，未在真实 Tauri 窗口内做端到端联调

---

## 2026-10-08 · 旅行模式 / 扩展捕获安全审查修复（基准 v1.1.2，不推进版本号）

对 v1.1.2 刚发布的旅行模式与扩展自动捕获做代码审查后的同类问题跟进修复，按规范不推进版本号（`npm run version:check` 仍为 v1.1.2）。

### 修复

- **扩展桥接凭据可被任意本地页面窃取（extension/background.js、lockpass-bridge.js、content.js）**：捕获凭据、条目列表与密码取回此前按 `chrome.tabs.query({})` 向所有标签页广播，谁先应答 `forwarded/ok` 就把数据交给谁；而页面桥注入 `file:///*`，任意本地 HTML 只需自报一个 `ready` 令牌即可冒充 LockPass 应用页面，收到其它站点登录时用户点「保存」的**明文密码**（反向还能污染后台 `passwordCache`）。现改为：后台维护 `appBridgeTabs` 登记表，登记与投递均以浏览器注入、页面无法伪造的 `sender.url` 命中应用地址白名单（GitHub Pages `/lockPass/`、`localhost:1420`、`127.0.0.1:1420`）为准，取消全量广播；页面桥在检测到应用标记 `data-lockpass-app` 前完全静默。`file://` 双击用法因本地页面之间无法区分，默认拒绝投递，需用户在扩展弹窗显式勾选「允许本地页面接收捕获凭据」（`storage.local` 持久，关闭时立即回收已登记的本地 tab；仅当探测到以 `file://` 打开的 LockPass 页面时才显示该开关）
- **浮层保存的凭据不再采信页面提交的 payload（extension/background.js）**：`LP_CAPTURE_SAVE` 改为按标签页取后台此前下发的待确认记录（含 15s TTL 校验）作为数据来源，避免任意站点脚本直接 `sendMessage` 伪造凭据写入用户库
- **桌面版旅行模式失效（useVault.js）**：`TauriServer.setEntries()` 两处（解锁、保存后）由原始 `vaultState.entries` 改为 `visibleEntries()`，并在切换旅行模式后立即重推——此前敏感条目（含密码）仍会整份同步进本地 HTTP 服务供扩展填充，与页面桥口径矛盾
- **`.vault` 导出经回收站与编辑历史泄漏（ExportModal.vue）**：导出负载中 `deleted` 与 `history` 未过滤，敏感条目在回收站里的整条内容、以及编辑历史快照中改密前的明文密码均可随导出文件解密还原。现按同一旅行模式口径过滤（含已软删的敏感条目，其历史按条目 id 一并剔除）
- **关联密码绕过旅行模式（core/related.js、DetailPanel.vue）**：`getRelatedEntries` 读取未过滤的全量条目，敏感条目标题与账号会出现在关联面板；`selectRelated()` 直接给 `vaultState.selectedEntry` 赋值，绕过 `selectEntry` 守卫，点击即可打开敏感条目详情并复制。现在关联计算前置过滤敏感条目，`selectRelated` 统一走 `selectEntry()`；`openEntryModal(entryId)`、`copyPassword(id)`、`copyPasswordWithTotp(id)` 同样加守卫，覆盖键盘与右键菜单等间接入口
- **密码健康报告泄漏（SettingsModal.vue）**：审计输入由全量条目改为 `visibleEntries()`（弱 / 复用 / 过期分组会带出敏感条目标题并暴露跨条目密码复用关系），「关于 → 条目数」同步改为可见条目计数
- **捕获更新密码写盘失败不回滚 + 提示泄漏标题（useVault.js）**：`handleExtensionCapture` 的 updated 分支先改内存再 `saveVault()`，失败时仅返回 error，内存与磁盘分叉且后续任意保存会把未确认的新密码刷落盘（created 分支本就有回滚）。现对称回滚密码 / `updatedAt` / 该条编辑历史；旅行模式下命中隐藏条目时提示只报域名，不再打出敏感条目标题
- **开启旅行模式时编辑器与草稿不关闭（useVault.js、EntryEditorModal.vue）**：正在编辑敏感条目时开启开关，明文表单面板会保留且仍可保存；现随开关一并关闭编辑器。编辑器内把条目标为敏感时不再落草稿骨架（并清掉既有草稿），避免刷新前 `flushDrafts` 把其标题 / 账号写进 sessionStorage
- **并发保存结果互相覆盖（extension/background.js）**：保存结果等待由单槽 `captureResultWaiter` 改为按 `requestId` 的 `Map`（requestId 贯穿 background → 页面桥 → `ExtBridge` → `capture-result` 回传），两个站点同时点保存不再让先超时的那次误报「保存失败」
- **隐藏条目计数泄漏（useVault.js）**：侧边栏回收站数量与解锁时的过期提醒 toast 改用过滤后集合，列表已隐藏敏感条目而计数暴露差值的问题消除

### 文档

- **计划调整：移除「密钥文件双因素」（原 Phase 2 §7 / v1.1.5）**：经评估判定不必要——第二因子的收益不抵代价（密钥文件丢失即保险箱永久无法解锁，离线无找回路径；浏览器版每次刷新还须重新选择 `.key` 文件，与「双击即用、低摩擦」定位冲突）。`docs/v1.1-plan.md` 删除该项章节、计入 §三 已排除项与 §四 总览空缺，Phase 2 范围收敛为 v1.1.3 / v1.1.4 两项。已就位的 `src/core/keyfile.js`（`window.KeyFileUtils`）与 `CryptoUtils.composeMaterial/deriveKeyMaterial/deriveKeyBytesMaterial` 不再接线，当前无调用方，可随后续清理删除
- **计划调整：移除「演示模式」（原 Phase 3 §12）**：经评估判定不必要——获客型功能与安全定位冲突，演示态要在同一页面内维持「未解锁的真保险箱不可达」这条边界，`saveVault` / 导入 / 改主密码 / 文件同步 / 扩展桥捕获 / `.vault` 导出等全部写路径，以及自动锁屏、旅行模式、会话恢复语义都需额外打标分流，任一处漏判就可能把示例数据写成真实数据或让演示态被误认为已解锁；当前用户来自主动搜索密码管理器，不存在需要预置数据转化的冷启动漏斗。`docs/v1.1-plan.md` 删除 Phase 3 表内该行、计入 §三 已排除项。本节为纯文档修改，不推进版本号
- **计划调整：移除 Phase 3 §9 HIBP 泄露检测 / §10 活动时间线视图 / §11 卡片显示自定义**：源码核查三项均为零实现（`src/` 与 `extension/` 内无对应代码，HIBP 仅出现在 `docs/spec.md` 规划清单），经评估判定不必要——HIBP 是本产品唯一需要联网的功能，与「离线优先 · 零网络请求」底线直接冲突，且 `core/audit.js` 的弱 / 复用 / 空 / 长期未更新 / 过期五类本地审计已给出同样行动建议；时间线浏览已被卡片与详情页的 `updatedAt`、编辑历史、安全报告 stale 分类覆盖，属重复建设；卡片字段自定义需持久化 + 设置页 + 移动端与桌面端分别适配，而现有固定卡片信息密度已够、用户未表达过诉求。`docs/v1.1-plan.md` 删除 Phase 3 表内三行并补齐排除理由，§四 总览 Phase 3 范围收敛为仅剩 §8 WebAuthn 全平台（macOS 单端已落地）；`docs/spec.md` §未来规划同步将 HIBP 标记为已排除。纯文档修改，不推进版本号

### 说明

- 页面桥与后台的应用地址白名单为 `extension/background.js` 的 `isTrustedAppPageUrl()`；如自建部署（非 GitHub Pages / 非 1420 端口）需同步该白名单
- `file://` 本地页面无法与攻击性本地 HTML 区分，故捕获投递默认关闭；这是产品级取舍，双击用法需一次性勾选信任开关
- 浏览器回归：旅行模式开关列表 3/5 条与统计同口径、健康报告 4→3 条、关联面板在开启后整体消失（关闭后重现 Bank-Secret）、捕获 created / updated / exists 与 `requestId` 回传、命中隐藏条目时提示仅报域名、无 `requestId` 的 capture 消息被拒；`npm run vite:build` 与 `npm run version:check`（11 处 v1.1.2）通过

---

## 2026-10-01 · v1.1.2

### 新增

- **旅行模式（原计划 v1.1.3）**：条目可在编辑器「标记为敏感」（条目级 `sensitive` 字段，随加密 vault 存储）；侧边栏顶部新增「旅行模式」开关（状态存 localStorage `lockpass_travel_mode`，刷新保留）。开启后敏感条目从以下出口统一隐藏：列表/搜索（`getFilteredEntries`）、侧边栏统计计数、回收站视图、`.vault` / CSV 导出（ExportModal）、二维码分享（QrShareModal + 关联跳转 `selectEntry` 拦截）、浏览器扩展桥（`ExtBridge.setEntriesProvider` 过滤后下发，`get-password` 随之查不到条目）。开启时若正选中敏感条目自动关闭详情面板；开关行展示「已隐藏 N 条」指示；详情页标题旁新增敏感盾牌徽标
- **浏览器扩展自动捕获（原计划 v1.1.4）**：内容脚本监听表单 submit，提取域名 + 用户名 + 已填密码上报后台（Service Worker 内存暂存 15s TTL，不落盘）；新页面加载时按「已跳转或密码框消失」判定登录成功，右上角弹出「保存到 LockPass？」浮层（保存 / 忽略 / 关闭，20s 自动收起，同域同账号忽略后不再重复弹）。保存链路：浮层 → background `LP_CAPTURE_SAVE` → LockPass 页面桥 `LP_CAPTURE_FORWARD` → 页面 `ExtBridge`（会话令牌校验）→ `handleExtensionCapture` 入库：精确主机名 + 同用户名去重（密码相同 → 跳过并提示；密码不同 → 更新密码并记录编辑历史；未命中 → 新建网站条目），结果经 `capture-result` 回传浮层展示（已保存 / 已更新 / 已存在）。LockPass 主应用页面通过 `data-lockpass-app` DOM 标记跳过捕获，避免误抓主密码；未解锁 / 页面未打开时浮层给出明确失败提示

### 说明

- `extension/manifest.json` 版本号随 `npm run version:set 1.1.2` 同步至 1.1.2
- 桌面版本地 HTTP 通道（tauri-server）暂未接入捕获，捕获仅覆盖「浏览器内打开并解锁 LockPass 页面」场景

---

## 2026-09-30 · v1.1.1

### 新增

- **TOTP 二维码导入接线**：「二维码添加」（上传 / 粘贴 / 拖拽 / 摄像头实时扫码四条入口）识别 `otpauth://totp/...` 动态口令二维码后，自动挑选绑定目标（优先无 TOTP、无私钥 / root / 敏感自定义字段的条目，同级取最近更新），写入 TOTP 密钥并立即加密保存；解析消费既有 `TOTPUtils.parseOTPAuthURI`（RFC 6238 向量回归 6/6 通过）。异常场景给出明确提示（口令解析失败 / 保险箱无可用条目）
- **密码 + 验证码组合复制**：详情面板 TOTP 区域新增组合复制按钮，复制 `密码 + 动态码`（空格分隔，同周期内码一致），走既有剪贴板自动清除链路并提示清除倒计时；无 TOTP 或无密码的条目不显示该按钮
- **列表卡片过期警示**：条目卡片图标区右上角新增过期 / 即将过期警示角标，已过期红色、即将过期（跟随设置页「提前警告天数」口径 7/14/30/60/90）琥珀色，悬停显示提示；复用 `VaultAudit.getExpiryStatus` 与解锁提醒同口径，随过滤列表变化重算（无秒级轮询开销）

### 修复

- **备份导入重复数据**：`.vault` 加密备份 / `.json` 明文备份导入（批量导入弹窗与桌面拖拽两条链路）由「直接追加」改为「**同类型 + 同标题覆盖合并**」——命中旧条目时覆写字段并保留 id / favorite / createdAt（编辑历史随 id 延续可回滚，收藏与创建时间不丢失），其余条目正常新增；条目类型比对前归一化（旧数据大写 `Website` 等与 `website` 视为同类）；导入完成提示区分显示「新增 N 条、覆盖 M 条（同类型 + 同标题）」；明文备份预览提示文案同步更新。CSV 导入行为不变（仍按标题 + 用户名逐条询问）

---

## 2026-09-29 · v1.1 计划状态表同步（基准 v1.1.0，不推进版本号）

### 文档

- **docs/v1.1-plan.md 状态同步**：对照实际代码与发布日志复核后，将计划各节与 §五状态表更新为真实进度。核实结论：原计划 v1.1.1（密码健康仪表盘）、v1.1.2（密码短语生成器 + 密码过期提醒）已随本版本 v1.1.0 实际发布；原计划 v1.1.0 的 **TOTP 双因素**代码已完整落地（`src/core/totp.js`、`src/composables/useTotp.js`、详情页动态码 + 倒计时圆环、编辑器手动录入密钥），本日志此前漏记，在此补记；未动工项：旅行模式、浏览器扩展自动捕获、密钥文件双因素，及 Phase 3 的 HIBP 泄露检测 / 活动时间线 / 卡片显示自定义 / 演示模式（WebAuthn 已有 macOS 单端基础）。已知缺口：过期提醒的列表卡片警示图标、TOTP 的 QR 扫码导入接线（`parseOTPAuthURI` 已实现未消费）。

---

## 2026-09-29 · 粒子背景 CPU 泄漏修复（基准 v1.1.0，不推进版本号）

### 修复

- **粒子背景 CPU 泄漏（src/core/particles.js）**：切换主题/强调色时（`LockParticles.refresh()`）旧实例引用被直接置 null，其 requestAnimationFrame 循环永久自续运行（每帧 O(n²) 连线检测），且 4 个事件监听器（window resize/load、document mousemove/mouseleave）随切换次数累积，活跃帧循环逐次叠加。现重建前统一调用新增的 `destroy()`（停 RAF + 移除全部监听器），`resolveInstance()` 的 canvas 重建路径同步改用 destroy，并为 `step()` 增加运行状态自守（`running` 为假不再自续）

---

## v1.1.0 (2026-09-29)

### 新增

- **密码健康仪表盘**：设置页新增安全审计面板，加权扣分制安全评分（0-100），分类展示弱密码 / 重复密码 / 空密码 / 长期未更新 / 已过期条目，可折叠展开逐条定位跳转
- **Passphrase 密码短语生成器**：密码生成器新增「密码短语」模式，基于 EFF Large Diceware 词库（7776 词），支持 3-10 词数调节、4 种分隔符（点号/下划线/短横线/空格）、首字母大写选项，实时显示熵值与强度等级
- **密码过期提醒**：条目编辑器新增过期日期字段，详情面板展示过期状态（已过期/即将过期/正常），解锁时自动检测并 Toast 提醒过期与即将过期条目数量，设置页可配置提前警告天数（7/14/30/60/90 天），审计仪表盘新增已过期分类
- **浏览器扩展 UI 美化**：自定义暗色主题滚动条（Firefox 兼容）、搜索框增加搜索图标与 focus 发光效果、条目列表改为圆角卡片布局（hover 微滑动 + 填充图标高亮）、状态页增加 SVG 图标、按钮增加阴影与 hover 上浮动效、弹窗宽度 320px → 340px

### 改进

- 审计评分算法：已过期条目每条 -12 分，弱密码 -10 / 重复 -5 / 空密码 -15 / 长期未更新 -2
- 密码生成器熵值计算新增 Passphrase 模式支持（词数 × log₂(7776) ≈ 词数 × 12.9 bits）
- 扩展填充图标由文本字符改为 SVG 箭头，视觉更统一
