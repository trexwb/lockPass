# LockPass 版本日志 · v1.1

> 本文件记录 LockPass 每个次版本（v1.1.x）的发布日志，最新在前。

---

## 2026-10-01 · 旅行模式 / 扩展捕获安全审查修复（基准 v1.1.2，不推进版本号）

同日对同一批功能（旅行模式、扩展自动捕获）的代码审查追加修复，按规范不推进版本号（`npm run version:check` 仍为 v1.1.2）。

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
