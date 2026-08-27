# LockPass 升级设计（2026-08-25）

> 纯离线定位约束：全部功能本地完成，不引入任何联网依赖。
> 本次升级共 6 项：条目字段扩展、扩展多字段填充、Firefox 兼容、Keychain 集成、全局快捷键、多语言 i18n。

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

## 六、多语言 i18n（轻量 key-based）

### 6.1 设计约束

- 不做运行时重载复杂度：不引 vue-i18n，自建极简 `t(key)` 函数 + 扁平 key 字典
- 两种语言：`zh-CN` / `en-US`，切换即时生效（响应式语言变量驱动全量重渲染，简单可靠）

### 6.2 实现

- 新增 `src/i18n/index.js`：语言状态（ref，存 localStorage，与主题同源）、`t(key)` 查表（缺失回退 key 本身 + 中文兜底）、`setLang(lang)`
- 新增 `src/i18n/zh.js` / `src/i18n/en.js`：扁平词典 `{ "nav.all": "全部", ... }`
- 组件通过 `useI18n()` 取 `t` 与 `lang`；模板中 `{{ t('xxx') }}` 或 `:placeholder="t('xxx')"`
- 设置面板新增「语言」选项：跟随系统 / 中文 / English（`navigator.language` 判定跟随系统）

### 6.3 覆盖范围

- 存量 UI：导航、列表、详情、编辑弹窗、设置面板、搜索、回收站、备份、配对等全部可见文案
- 新增 UI（阶段 0/3/4 引入的自定义字段、Keychain 开关、快速搜索窗）直接以 key 编写，一次到位
- 时间格式化等沿用现有本地化，不做多语言日期

### 6.4 不做的事

- 不做语言包懒加载、不做复数规则、不做 RTL、不做用户自定义词典

## 七、实施顺序

1. 阶段 0：字段扩展（core/templates.js + database.js + 编辑/详情 UI + 迁移）
2. 阶段 1：扩展多字段填充（content.js 识别 + background 协议 + 状态机）
3. 阶段 2：Firefox 兼容（manifest + 兼容修正 + 本机验证）
4. 阶段 3：Keychain（Rust keyring + 锁屏监听 + 前端开关与自动解锁）
5. 阶段 4：全局快捷键（plugin + 弹窗窗口 + 设置）
6. 阶段 5：i18n（框架 + 设置项 + 存量/新增 UI 全量 key 化）

阶段 0-4 的新 UI 先用中文硬编码，阶段 5 统一 key 化，避免开发中反复切换。

## 八、约束与风险

- 版本号：本升级完成后 PATCH 自增（v1.0.1 → v1.0.2），禁止 MAJOR/MINOR，禁止 git 操作，禁止 tauri build
- 修改日志：README「更新日志」+ memory 记录
- Keychain 存主密码属安全取舍，默认关闭，UI 明示
- Firefox 扩展需本机 Firefox 实测，若环境不可用则该阶段标记待验证
- i18n 全量 key 化改动面大（几乎所有组件），需逐组件回归四端布局（H5/Pad/PC/Tauri）
