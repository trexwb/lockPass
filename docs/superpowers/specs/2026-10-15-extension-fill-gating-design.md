# 扩展自动填充门控设计：只认登录表单，搜索框永不误填

> 日期：2026-10-15 ｜ 基线版本：v1.1.7 ｜ 状态：已与用户对齐（默认模式：智能建议）

## 问题

用户实测两个痛点：①扩展在登录成功后的页面（仪表盘/搜索页）仍弹建议气泡；②点击填充后凭据被写进站点搜索框，触发即时搜索。

## 根因（extension/content.js）

1. **页面级误报**：`detectLoginState()` 无密码框时的兜底逻辑——全文档找第一个 text/email/tel 输入框 + 同渲染边界内有提交按钮即认定登录表单并上报（`LP_PAGE_READY` → 弹建议气泡）。搜索框恰是「text 框 + 提交按钮」，登录成功后密码框消失的页面全部命中。
2. **字段级误报**：`isUsernameCandidate()` 对任何 text/email/tel 输入框返回 true（属性不含 user/email 等词时走类型兜底），未排除任何搜索语义。
3. **写入路径**：用户点击建议条目 → `LP_MULTI_FILL` → 把用户名写入被误认的「username 框」（= 搜索框）→ 派发 `input` 事件 → 即时搜索被触发。

扩展从不无点击自动写入（自动的只是建议气泡），但「乱弹 + 一点就填进搜索框」等效于误填。

## 设计：三层防御

### 第一层 · 字段级：搜索框永不作为登录字段

新增 `isSearchField(el)`，命中任一即为搜索框：
- `type="search"`
- name / id / placeholder / aria-label 拼接后命中搜索语义正则（含 search / 搜索 / 查询 / 关键词 / keyword / query 等，带词边界防误伤）
- 祖先链上存在 `[role="search"]` 或 HTML `<search>` 元素

接入点：`isUsernameCandidate()` 首行排除；无密码框兜底扫描排除；`findCaptureInputs()`（自动捕获）同步排除。

### 第二层 · 页面级：无密码框时须有「强登录信号」才上报/弹泡

无密码框时的 username 候选必须满足强信号之一，否则整页不上报：
- `autocomplete="username"` 或 `autocomplete="email"`
- name / id **精确**命中 `^(user(name|id)?|login(name|id)?|account|email|mail)$`（不区分大小写，不是「包含」）

效果：登录成功后（密码框消失、只剩搜索框）的页面不再弹泡、不再上报——实现「登录成功之后不再自动填入」。多步登录（先账号后密码）靠 autocomplete/精确命名保留自动支持。已知取舍：自造字段名且无 autocomplete 标记的登录页自动建议会漏，手动填充（点扩展图标）不受影响。

有密码框的主路径不变（密码框本身就是最强的登录信号），仅叠加第一层搜索框排除。

### 第三层 · 用户可控：填充模式开关（popup）

- **智能建议**（默认）：上述修复后的行为。
- **仅手动**：content 脚本照常检测但后台忽略 `LP_PAGE_READY` 自动上报——不弹泡、不排队 `autoFillPending`；只有用户点扩展图标 → popup 点条目才填充。
- 偏好存 `chrome.storage.local`（`lp_fill_mode`，`auto`｜`manual`）；manifest 已有 storage 权限（现用于配对令牌），存模式布尔值不违背「凭据不落盘」原则。
- 补充语义：本页填充成功后置 `suggestDismissed`，同页不再自动弹泡（此前只有手动关闭才抑制）。

### 后续可选（本次不做）

气泡上加「此站点不再自动建议」站点级记忆；per-site 白名单。

## 执行修订（2026-10-15 第二轮讨论后）

### 修订一：移除页面就绪时的静默自动写入

代码核实（`autoFill()`）：现状 `LP_PAGE_READY` 在域名命中时**直接 `sendMultiFill` 把凭据写进页面**，写完才弹气泡——此前讨论中「扩展不点击不写入」的判断有误，这正是「凭据被自动写进搜索框触发即时搜索」的直接推手。修订：`LP_PAGE_READY` 只触发建议气泡，一切填充（含 token）都经用户点击（气泡条目 / popup 弹窗）；多步登录补填保留（完成用户已发起的填充动作）。README「一键填充」语义本就如此，代码与文档重新对齐；无第三档「自动写入」模式（它就是投诉根因，不保留）。

### 修订二：新增 token / API Key 字段填充（提示 + 点击填入）

- **数据零改动**：AI 条目的 API Key 即条目 `password` 字段（`EntryEditorModal.vue` 对 `entryType === 'ai'` 取 `e[k] ?? e.apiKey`），`LP_PASSWORD` / 桌面 `/credentials` 原样可用。
- content.js 新增 `token` 字段识别（attrs 命中 api key / access token / token / secret / bearer 特征，排除搜索框），作为独立能力位上报；`isUsernameCandidate` 同步排除 token 字段（此前 api_key 文本框会被当作用户名候选）。
- `buildFields` 支持 `key='token'`（值 = 条目 password，仅 `entryType === 'ai'` 时非空，非 AI 条目不把密码写进 token 框）。
- 建议来源：域名命中条目优先；页面桥通道在无命中且页面含 token 字段时回退列出全部 AI 条目（`get-entries` 全量、含 entryType）；桌面 HTTP 通道维持域名匹配（列全量需扩 `/credentials` 暴露面，暂不做，作为限制记录）。
- 填充仅在点击后发生，与门控原则一致。

## 改动面

| 文件 | 改动 |
|------|------|
| extension/content.js | isSearchField + isUsernameCandidate 排除 + 兜底强信号门槛 + 填充成功抑制 |
| extension/background.js | 读 `lp_fill_mode`，manual 模式忽略 LP_PAGE_READY 自动上报 |
| extension/popup.html / popup.js / popup.css | 模式开关 UI（默认智能建议） |
| README.md | 扩展「安全模型 / 使用流程 / 限制」补模式说明 |

## 版本与发版

并入已批准的 v1.2.0 批次（A1 遗留 + A2 KDF 升级入口 + 本特性）；A1/A2 因写入护栏未放行仍欠账，**版本号在整批落盘前维持 v1.1.7 不动**。

## 验证

- `node --check` 三个扩展脚本语法通过
- 手工冒烟矩阵：登录页弹泡可填；登录后仅搜索框页面不弹泡；搜索框不作为 username 候选；仅手动模式下任何页面不弹泡、popup 手动填充可用；多步登录（autocomplete="username"）第一步仍可自动建议
