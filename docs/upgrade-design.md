# LockPass 升级设计（2026-08-25）

> 纯离线定位约束：全部功能本地完成，不引入任何联网依赖。
> 2026-08-30 修订：多语言 i18n（原第六章）与密码生成器升级（原第九章·已完成部分）已随 v1.1.x 落地，相关章节已清理；当前保留规划：条目字段扩展、扩展多字段填充、Firefox 兼容、Keychain 集成、全局快捷键、密码生成器剩余项，以及第十章「小功能/小工具路线图」。

## 一、条目字段扩展

### 1.1 数据模型

条目新增自定义字段数组：

```js
{
  // 既有字段保持不变
  customFields: [
    { id: "cf_xxx", label: "PIN", value: "123456", sensitive: true, type: "pin" }
  ]
}
```

字段 `type` 枚举：`text` / `pin` / `email` / `phone` / `otp` / `url` / `notes`。
`type` 供浏览器扩展识别填充（email/phone/otp 可被自动填充），`sensitive` 控制详情页掩码展示。

### 1.2 类型模板

内置模板常量（`src/core/templates.js`）：

| 模板 | 字段集 |
|---|---|
| 银行 | 卡号、持卡人、支行、预留手机 |
| 邮箱 | 邮箱地址、登录密码 |
| WiFi | SSID、密码、加密方式（WPA2/WPA3/开放） |
| 服务器 | 地址、端口、用户名、密码 |
| 社交 | 账号、密码、恢复码 |
| 自定义 | 空模板，手动添加 |

选择类型后自动带入模板字段（label/value 可编辑），用户仍可自由增删。

### 1.3 存储与迁移

- IndexedDB objectStore `entries` 保持单条 JSON 存储，字段扩展不需要改 store，只需在读取/写入时保证默认值 `customFields: []`
- `.vault` 导出格式追加 `schemaVersion: 2`，导入时兼容 v1（无该字段视为旧格式，补默认值）
- 全文搜索同步索引 `customFields[].value`，使自定义字段可被搜索命中

### 1.4 UI

- 编辑弹窗：新增「自定义字段」区块，支持添加（选类型/输入标签）、编辑、删除、上下移动、敏感标记开关
- 详情页：字段分组展示（密码组 / 自定义组），敏感字段默认掩码、点击揭示
- 设置无需改动（迁移自动完成）

## 二、扩展多字段填充（依赖一）

### 2.1 表单识别扩展（content.js）

现有用户名/密码启发式之外，新增识别：

| 字段 | 识别特征（按优先级） |
|---|---|
| email | `type=email`、`autocomplete=email`、name/id 含 `email`/`mail` |
| phone | `type=tel`、name/id 含 `phone`/`mobile`/`tel` |
| otp/code | `autocomplete=one-time-code`、`inputmode=numeric` + name/id 含 `code`/`otp`/`verify`/`captcha` |

识别结果进入现有 `walkRoots` 遍历框架（iframe / shadow DOM 自动兼容）。

### 2.2 填充协议（background.js）

新增 `LP_MULTI_FILL` 消息：携带 `{ frameId, fields: [{ key, value }] }`。
字段匹配规则：

| 表单字段 | 条目数据来源 |
|---|---|
| username | 条目 `username` |
| password | 条目 `password` |
| email | 条目 `email` 字段（旧字段）→ 自定义字段 type=email |
| phone | 自定义字段 type=phone |
| otp/code | 自定义字段 type=otp（手动复制填入，不自动读 TOTP 动态码） |

`key` 为字段语义名（username/password/email/phone/otp），发送前仍做密码剥离（仅 background 内存持有明文）。

### 2.3 多步状态机扩展

现有 username→password 状态机扩展为多级：任一表单出现多个待填字段时，按 用户名 → 密码 → 邮箱/手机 → 验证码 顺序逐级等待出现并填充；`pendingCredential` 缓存扩展为保存整套字段数据（仍带 120s 有效期）。

## 三、Firefox 兼容层

### 3.1 manifest 适配

```json
{
  "browser_specific_settings": {
    "gecko": { "id": "lockpass-extension@lockpass.local", "strict_min_version": "115.0" }
  }
}
```

### 3.2 代码兼容清单

- MV3 background service worker：Firefox 115+ 支持，但 `chrome.*` 回调式 API 需确认；如遇不支持则以 `browser.*` promise 风格改写
- `chrome.action` / `chrome.tabs` / `chrome.runtime` 在 Firefox 均有对应实现；`chrome.storage` 未使用（扩展零落盘）无影响
- content script 注入配置（all_frames 等）Firefox 同样支持
- 打包：`web-ext` 命令生成 .xpi 供手动加载（或 about:debugging 临时加载）

### 3.3 验证

- 本机安装 Firefox，`about:debugging` 加载临时扩展
- 回归：解锁配对（HTTP 通道）、单字段/多字段/iframe/shadow DOM 填充

## 四、macOS Keychain 集成（Tauri）

### 4.1 方案确认

**Keychain 存主密码**，实现启动自动解锁；锁屏联动清空。默认关闭，开启时 UI 明确提示安全性代价。

### 4.2 Rust 侧（src-tauri）

- 依赖：`keyring = "3"`（服务名 `com.lockpass.desktop`，账号 `master-password`）
- 命令：
  - `keychain_set_master(pw)`：写入主密码
  - `keychain_get_master() -> Option<String>`：读取（无则 None）
  - `keychain_delete_master()`：删除
  - `keychain_has_master() -> bool`：检测是否存在
- 锁屏监听：`NSWorkspace.didLockNotification`（macOS 锁屏通知，纯本地）。收到通知后：调用 `keychain_delete_master()` 清 Keychain + 向 WebView 发 `locked-by-system` 事件触发前端锁定
- 锁屏监听依赖系统通知，若通知不可达（权限受限）降级为仅「进程失焦超时」既有锁定策略

### 4.3 前端集成

- 设置面板新增「自动解锁」开关（默认关）：开启时弹确认框说明"主密码将存入 macOS 钥匙串，本机任意应用可请求读取，安全性低于手动输入"
- 解锁成功流程：若开关开启 → `keychain_set_master(主密码)`
- 启动流程：检测 `keychain_has_master()` → 有则读取并自动派生解锁（走既有解锁管线）；无则常规解锁页
- 手动锁定/登出：同时 `keychain_delete_master()`
- 浏览器版（无 Tauri）：该设置项隐藏

## 五、全局快捷键快速搜索（Tauri）

### 5.1 快捷键

- `tauri-plugin-global-shortcut` 注册全局快捷键，默认 `CommandOrControl+Option+P`，设置面板可自定义
- 仅在 Tauri 桌面版启用；浏览器版仍走扩展 popup

### 5.2 快速搜索弹窗

- 新增无边框置顶小窗口（宽 420 × 高 560，圆角毛玻璃），复用现有搜索逻辑与列表
- 输入即时过滤：标题/用户名/URL/标签/自定义字段
- 键盘操作：↑↓ 选择、Enter 复制密码、⌘C 复制用户名、Esc 关闭
- 选中操作后自动复制到剪贴板并沿用「N 秒后自动清除」策略，随后自动关闭弹窗

### 5.3 窗口生命周期

- 弹窗为独立 WebviewWindow，解锁态才有数据（未解锁时提示先解锁主窗口）
- 主窗口关闭/锁定 → 弹窗同步关闭

## 七、实施顺序

1. 阶段 0：字段扩展（core/templates.js + database.js + 编辑/详情 UI + 迁移）
2. 阶段 1：扩展多字段填充（content.js 识别 + background 协议 + 状态机）
3. 阶段 2：Firefox 兼容（manifest + 兼容修正 + 本机验证）
4. 阶段 3：Keychain（Rust keyring + 锁屏监听 + 前端开关与自动解锁）
5. 阶段 4：全局快捷键（plugin + 弹窗窗口 + 设置）
6. 阶段 5：密码生成器剩余升级（第九章）
7. 阶段 6：小功能/小工具第一批（第十章 10.1）

阶段 0-4 的新 UI 先用中文硬编码，落地时统一走 t() 双语，避免二次返工。

### 2026-08-30 修订

多语言 i18n（原阶段 5）已随 v1.1.0 落地，从实施顺序移除；密码生成器已完成部分（独立弹窗、随机密码增强、入口）随 v1.1.4 落地，剩余项见第九章；小功能/小工具路线图见第十章（第一批优先，第二批待单独细化）。

## 八、约束与风险

- 版本号：当前基线 v1.1.4（三真源一致），后续升级完成后 PATCH 自增，禁止 MAJOR/MINOR，禁止 git 操作，禁止 tauri build
- 修改日志：README「更新日志」+ memory 记录
- Keychain 存主密码属安全取舍，默认关闭，UI 明示
- Firefox 扩展需本机 Firefox 实测，若环境不可用则该阶段标记待验证
- 小功能/小工具全部遵守：零依赖、纯离线、禁 window.* 原生弹窗（一律 Utils.confirm/Utils.prompt）、新文案直接走 t() 双语

## 九、密码生成器剩余升级（2026-08-30 修订）

> 已完成（随 v1.1.4 落地，不再列出）：独立弹窗 PasswordGeneratorModal.vue、全局右键入口 + 编辑器闪电按钮、随机密码增强（minEachSet / maxRepeat / noAmbiguous）、calcStrength 强度分级。
> 主动取消：会话级生成历史（v1.1.4，用户决策——生成过的密码在他人视角下即明文暴露面，取消记录是最干净的解法）。

剩余未完成项：

### 9.1 三模式扩展（core）

| 模式 | 参数 | 说明 |
|---|---|---|
| 密码短语 Passphrase | 单词数 3-10（默认 4）、分隔符（`-` `_` `.` 空格 / 自定义）、首字母大写、追加随机数字、内置 EFF 短词表 | 好记高熵，主密码/口令 |
| PIN | 4-12 位纯数字 | 银行卡 PIN / 设备解锁 |
| 随机密码增强 | 自定义排除字符（与排除歧义叠加） | 现状已支持长度 4-128、四类字符集、noAmbiguous、minEachSet、maxRepeat |

接口：`generatePassphrase(options)`、`generatePin(length)`、`EFF_WORDLIST`（~1300 词，公共领域，gzip 约 5KB）；`generatePassword` 增 `excludeChars`。

### 9.2 破解时间估算

按熵值 + 10⁹ 次/秒离线暴力假设，输出「约 3 万年」式人类可读文案；熵值数值实时显示（`72.4 bits`）。接口：`crackTimeEstimate(entropyBits)`。

### 9.3 偏好持久化（G3）

生成器配置（模式、长度、各开关）存 localStorage（键 `lockpass_gen_prefs`），编辑器唤起与独立弹窗共享同一份偏好；打开时读取、关闭时写回。

### 9.4 快捷键入口

`Ctrl/Cmd + G` 呼出独立弹窗（注册进 useShortcuts，当前 27 项之外新增；补充设置面板快捷键表与 i18n 键）。

### 9.5 验收

三模式可用、参数即时重生成；`Ctrl/Cmd+G` 呼出；偏好重启保留；体积增量 gzip < 8KB；vite build 0 error 0 warning。

## 十、小功能/小工具路线图（2026-08-30 增补）

> 与一~五章大项解耦的轻量增量，分批实施，每批独立设计→验收。

### 10.1 第一批（随 v1.1.5 落地）

#### 10.1.1 搜索增强（B5）

现状：useVault.js 对 title/username/url 子串匹配 + tags，无拼音、无排序。

1. **归一化**：query 与字段 trim + lowercase + 折叠空白
2. **拼音首字母**：新 `core/search.js`（纯函数），内置常用 3500 汉字→首字母映射表（gzip 约 4KB，零依赖）；标题/用户名额外生成首字母串，如「银行」→ `yh`，query `yh` 命中
3. **排序**：前缀命中 > 子串命中 > 拼音命中；同级按收藏、最近使用优先
4. **高亮**：结果列表对命中片段轻量高亮

文件：`core/search.js`（新）、`useVault.js` 搜索逻辑替换、词典新键。
验收：`yh` 命中「银行」类标题；增量 gzip < 6KB；vite build 0 error。

#### 10.1.2 Chrome 密码 CSV 导入向导（C2）

现状：import-bridge.js 要求 `title`+`password` 列，Chrome 导出（`name,url,username,password,note`）直接报错。

1. **列映射表**：`name→title`、`url→url`、`username→username`、`password→password`、`note→note`；兼容变体（website/网址/标题/用户名/密码/备注等中英文）
2. **向导流程**：ImportModal 内新增入口 → 选文件 → 解析预览（表格展示前 5 行 + 列映射下拉，自动识别可手调）→ 导入
3. **去重与默认**：title+username 重复跳过并计数；默认条目类型「网站」；引号/逗号转义复用 `Utils.parseCSVLine`

文件：`core/import-bridge.js` 扩展、`ImportModal.vue`、词典键。
验收：Chrome 样例 CSV 成功导入；无 title 列不报错；重复跳过计数正确。

#### 10.1.3 回收站定时清空（C4）

1. **数据**：软删除时条目打 `deletedAt`（ISO 时间戳）；旧数据无该字段不参与自动清空（安全兜底）；导出/导入保留
2. **设置**：设置面板「回收站」新增「自动清空」下拉：从不 / 30 / 60 / 90 天（默认从不），存 `localStorage lockpass_recycle_ttl`
3. **执行**：解锁后立即检查一次 + 每日检查（setInterval 24h）；超 TTL 条目彻底删除（含修改历史快照）；Toast 报告清空数
4. **明示**：开启时确认提示「自动清空不可恢复」

文件：`useVault.js`、`SettingsModal.vue`、`database.js`（字段透传）、词典键。
验收：设置 30 天后构造旧 deletedAt 条目 → 解锁即被清空；Toast 正确；vite build 通过。

### 10.2 第二批（待第一批验收后单独细化）

- **数据自检**：vault 完整性校验（JSON 解析、加密轮次校验、损坏提示 + 恢复指引）
- **无障碍强化**：aria 补全 / 键盘导航完善

### 10.3 共同约束

- 零依赖（拼音用内置表，不引库）、纯离线、禁 window.* 原生弹窗（一律 Utils.confirm/Utils.prompt）
- 新文案直接走 t() 双语
- 完成后 PATCH 自增 v1.1.5（三真源）、禁 git / 禁 tauri build、README 更新日志 + memory 记录
