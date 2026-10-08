# LockPass 版本日志 · v1.1

> 本文件记录 LockPass 每个次版本（v1.1.x）的发布日志，最新在前。

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
