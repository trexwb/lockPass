# LockPass — 个人密码工作台 规格文档

> 版本：v1.1.6 | 更新日期：2026-08-29

---

## 1. 产品定位

一款运行在浏览器中的离线密码保险箱。视觉上借鉴实体保险箱的金属质感与机械密码锁的精密感，配合柔和的发光提示，营造「数字保险箱」的氛围。数据完全存储在本地 IndexedDB 中，默认永不联网——就像把一张写满密码的纸锁进抽屉，而不是交给云端。

**核心体验原则：安全 → 简洁 → 顺手**

**多端形态**：
- 浏览器版（Vite 构建，双击 `dist/index.html` 即用 / GitHub Pages 在线版 / PWA）
- Tauri v2 桌面版（Windows / macOS，本地文件存储）

---

## 2. 技术选型

### 2.1 存储方案对比

| 维度 | IndexedDB | sql.js (SQLite WASM) |
|------|-----------|---------------------|
| **数据容量** | 数百 MB ~ GB，浏览器原生 | 需加载整个 DB 到内存，大文件性能下降 |
| **存储持久化** | 浏览器自动持久化 | 需手动导入/导出 `.db` 文件才能持久化 |
| **离线可用** | ✅ 完全离线 | ✅ 完全离线 |
| **初始化开销** | 原生 API，零加载 | 需加载 ~1MB WASM 文件 |
| **查询能力** | 索引 + 游标，足够 | 完整 SQL，更强 |
| **兼容性** | 所有现代浏览器 | 所有现代浏览器 |

**结论：选择 IndexedDB**（密码管理器数据量有限，零依赖，自动持久化）。

### 2.2 加密方案

```
主密码 → PBKDF2(SHA-256, 100000次迭代, 32字节盐值) → AES-256-GCM 密钥
数据   → AES-256-GCM 加密（随机12字节IV）          → 密文存储
```

- **PBKDF2**：行业标准密钥派生函数，NIST 推荐；迭代次数存入 meta，导入导出时随文件携带
- **AES-256-GCM**：提供加密 + 完整性校验，NIST 推荐

### 2.3 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 前端框架 | Vue 3 + Composition API（`<script setup>`） | 组件化 + 响应式 |
| 构建 | Vite 5（iife 单 chunk 产物） | 产物 file:// 双击可用，兼容 Pages/Tauri |
| 状态管理 | composables（不引 Pinia） | 项目规模用 Pinia 过重 |
| 路由 | 不引入 vue-router | 单视图架构，侧边栏筛选不需要路由 |
| UI 库 | 无，自绘组件 | 保留设计令牌，零视觉回归 |
| 核心逻辑 | `src/core/` ES module（`window.*` 挂载） | 纯逻辑层，零框架依赖 |
| 存储 | IndexedDB（浏览器）/ Tauri 文件存储（桌面） | 同接口透明替换 |
| 加密 | Web Crypto API | 浏览器原生 |
| 桌面封装 | Tauri v2（Rust） | macOS / Windows |
| 字体 | system-ui 系统字体栈 | 零外部依赖，纯离线 |

---

## 3. 功能规格

### 3.1 主密码与保险箱初始化

| 功能 | 说明 |
|------|------|
| 首次使用 | 引导创建主密码（8 位以上，建议强密码） |
| 主密码派生 | PBKDF2（SHA-256，100000 次迭代）派生 AES-256-GCM 密钥 |
| 盐值生成 | 随机生成 32 字节盐值，存储在 IndexedDB meta |
| 数据加密 | 条目/回收站/标签注册表以 AES-256-GCM 加密后存入 IndexedDB |
| 销毁保险箱 | 设置中双重确认后彻底删除所有数据 |

### 3.2 解锁流程

```
输入主密码 → PBKDF2 派生密钥 → 尝试解密数据 → 成功则解锁
```

- 解锁超时：无操作自动锁定（1/5/15/30 分钟/从不，可配置）
- 会话：sessionStorage 保存会话密钥（非锁定刷新自动恢复；锁定即清除）
- 解锁失败：显示错误 + 抖动动画

### 3.3 密码条目管理

每条密码条目包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| id | UUID | 自动 | 唯一标识 |
| title | String(100) | ✅ | 标题 |
| entryType | enum | ✅ | website / server / database / ai / app / other |
| username / password | String | ✅ | 账号 / 密码（加密存储） |
| url | String | | 网站地址 |
| tags | String[] | | 标签名数组（多标签） |
| favorite | Boolean | | 是否收藏 |
| notes | String(256) | | 备注 |
| 类型扩展字段 | 见下 | | 按 entryType 语义化字段 |
| createdAt / updatedAt | ISO8601 | 自动 | 创建 / 更新时间 |

**6 种条目类型的扩展字段**（C2 起统一 `url` / `password` 数据模型；旧 vault 的 host / baseUrl / apiKey 字段在读取时自动迁移）：

| 类型 | 扩展字段 |
|------|----------|
| website | url |
| server | port；root 账号层级：`root: { username, password }`（存储为嵌套对象） |
| database | dbType、port、dbName |
| ai | username（服务名称）、url（API 地址）；password 承载 Token |
| app | appId、privateKey（多行 PEM）；password 承载公钥 |
| other | username（凭证名称）；password 承载凭证值 |

### 3.4 标签体系

- 标签注册表 `tagDefs`：`{ [name]: { color, icon, isDefault? } }`，条目 `tags` 数组存放标签名
- 默认标签：7 个原分类升级（社交/邮箱/金融/工作/开发/生活/其他）+ 12 个常用标签，随机分配颜色与图标
- 支持增/删/改标签名称、颜色、图标；侧边栏按使用频率取前 8 个标签作为筛选入口
- 旧 vault（categories 体系）首次解锁自动迁移，幂等

### 3.5 回收站

- 删除为软删除：移入 `deleted` 数组并打 `deletedAt` 时间戳，保留全部元数据
- 支持恢复 / 彻底删除 / 清空回收站；回收站数据不参与导入导出

### 3.6 搜索与筛选

- 实时全文搜索（标题/用户名/URL/标签）
- 侧边栏筛选：全部 / 收藏 / 回收站 / 热门标签
- 无结果时显示空状态

### 3.7 密码生成器

- 长度滑块：8~64 位（默认 16 位）
- 字符集选项：大写/小写/数字/符号；可排除歧义字符（0/O/l/1/I）
- 实时预览 + 强度显示（Entropy 熵值计算）

### 3.8 密码操作

- 点击眼睛图标：显示/隐藏密码
- 点击复制：复制到剪贴板，可配置 10/30/60 秒后自动清空
- 详情面板：编辑 / 复制 / 收藏 / 二维码分享 / 删除；回收站内为恢复 / 彻底删除
- 右键条目卡片：快捷菜单（编辑 / 复制密码 / 收藏 / 删除；回收站视图为恢复 / 复制密码 / 彻底删除）——v1.0.22 起实现
- 编辑器内「复制账号 / 密码」按钮走统一剪贴板安全链路（v1.0.22 起，与详情面板一致：成功提示 + 30 秒自动清除）

### 3.9 关联密码

- 网址关联：同 IP（含 `IP:端口` 裸写法）、同根域名（泛域名归一，内置离线多级 TLD 列表）、同内网主机名
- 账号关联：同用户名（大小写不敏感）
- 动态计算，不改变存储结构，条目增删改后实时更新

### 3.10 二维码同步

- **分享**：将条目加密为 `LockPass-QR v1` 载荷（format/v/salt/iv/data，AES-256-GCM），M 纠错级，容量上限约 2.2KB，超出提示改用文件同步
- **导入**：上传图片 / 粘贴 / 拖拽 / 移动端摄像头扫码（jsQR 识别），解密后确认导入（重复条目需确认替换）
- 二维码渲染使用本地 vendor 库 `qrcode.min.js`（零网络）

### 3.11 数据导入导出

| 格式 | 说明 | 安全性 |
|------|------|:------:|
| `.vault` | 加密 JSON（salt + iterations + iv + data + tagDefs） | ✅ 安全 |
| `.json` | 加密备份：`.vault` 导出与自动快照/同步文件（`LockPass-backup-*.json`、`LockPass-vault.json`，format 为 `LockPass-file-sync`）均可导入；按 salt + iv + data 加密封套结构识别，导入时输入主密码解密 | ✅ 安全 |
| `.csv` | 明文表格，支持全部类型字段 | ⚠️ 需妥善保管 |

- 导入去重（按标题+用户名匹配）；`import-bridge.js` 负责列名映射与解析
- 导出迭代次数读取实际存储值；导入使用文件自带 iterations（与导出对称）
- 加密封套统一按结构识别（salt + iv + data 同时存在即视为加密备份），不依赖 format 标记（v1.0.3 修复自动快照 json 导入报「不支持的文件格式」问题）

### 3.12 修改历史与回滚

- 触发范围：编辑保存时任意内容字段（标题/类型/用户名/密码/网址/端口/备注/标签/Root 账号/App ID/私钥）存在变更即生成一条记录；仅 `favorite` / `showPassword` 等状态位变化不记录
- 数据模型：顶层 `history` 映射 `{ [entryId]: [{ at, snap, fields }] }`——`snap` 为修改前可回滚字段的深拷贝，`fields` 为本次相对新状态的变更字段列表（列表展示 + 回滚确认提示用）；每条目最多保留最近 5 版（最新在前，与最新一条完全相同不重复记录）
- 旧版兼容：升级前仅含 `{ password, at }` 的记录仍可展示与回滚（只恢复密码），列表标注「旧版记录 · 仅密码」
- 展示：详情面板「修改历史」区块，显示变更时间 + 掩码密码 + 变更字段说明；回滚按钮仅在所选版本与当前数据存在差异时可用
- 回滚流程：点击先弹确认弹窗（提示将覆盖的字段、当前数据不留存副本）→ 确认后整体恢复到快照并更新 `updatedAt`
- 执行即删：回滚成功后删除被执行的那条记录，防止重复执行；**回滚不是编辑，不新增任何历史记录**
- 历史随整体 vault 加密存储（`entries/history/tagDefs/deleted` 一并加密）；**不参与 .vault / CSV 导入导出**（导出只读写 entries）；本地文件同步为整体密文快照，自动包含
- 回收站视图不展示历史；彻底删除 / 清空回收站时清理无主历史（软删除保留，恢复后历史仍在）

### 3.13 外观（自定义主题）

- 主题模式：深色（默认）/ 浅色 / 跟随系统（`prefers-color-scheme`，监听实时响应）；存 `localStorage`（`lockpass_theme`）
- 强调色：蓝 / 绿 / 紫 / 橙 / 红 / 青 6 种预设（`lockpass_accent`），由 `--accent-h/s/l` 色相变量驱动，accent/dim/glow/hover/焦点边框全部跟随
- 实现：`useTheme` composable 管理 `data-theme` / `data-accent` 属性（main.js 挂载前同步应用，无闪屏）；base.css 浅色变量表 + 强调色预设；粒子背景随主题重绘
- 二维码白底（扫码硬性要求）不随主题变化

### 3.14 移动端体验

- 底部导航（≤480px）：全部 / 收藏 / 回收站（带数量徽标）/ 添加（中心凸起主按钮）/ 标签（打开侧边栏抽屉）；内容区底部留白防遮挡
- 触控目标：侧边栏导航项 ≥44px、卡片操作按钮 ≥36px 且常显（移动端无 hover）、主按钮 ≥40px
- 扫码流程：上传区加大触控面与引导文案；摄像头取景框限高防溢出（横屏矮屏可用）
- 安全区：底部导航 / 详情面板 / 弹窗底栏均适配 `env(safe-area-inset-*)`

### 3.15 自动备份（提醒 + 快照）

- 提醒：间隔可配置（关闭/1/3/7/30 天）；解锁时检查距上次备份（.vault 导出或快照）时间，超期 Toast 提醒；提醒有节流（间隔内不重复），首次使用（从未备份）也会引导
- 快照：完整加密负载（与 LockPass-vault.json 同构）写入 `backups/LockPass-backup-YYYYMMDD-HHmmss.json`
  - Tauri 桌面：数据目录 `backups/`，`.manifest.json` 清单维护保留最近 N 份
  - 浏览器：绑定目录 `backups/`，目录枚举按时间序清理保留最近 N 份
  - 触发：解锁后检查距上次备份 ≥ 快照间隔则自动生成；设置面板可手动「立即备份」
- 设置：提醒间隔 / 快照开关（默认开）/ 快照间隔（默认 7 天）/ 保留份数（默认 5，上限 20）；存 localStorage
- 备份时间记录：.vault 加密导出成功与快照生成均刷新「上次备份」时间

### 3.16 浏览器扩展（自动填充）

- 应用内入口：设置 → 浏览器扩展，提供「下载 zip」（指向 Pages 发布的 `lockpass-extension-v<版本>.zip`，版本号与主应用同步）与「使用指南」链接；桌面版无 shell/opener 能力时复制链接到剪贴板

- 交付形态：`extension/` 目录 Manifest V3 扩展（background / popup / 双 content script），Chrome / Edge 开发者模式加载
- 解锁态通信：LockPass 页面 `ExtBridge`（src/core/ext-bridge.js）解锁广播 ready（含一次性会话令牌，sessionStorage），锁定/登出广播 locked；扩展请求须携带令牌且来源为同窗口；解密在页面内存完成，扩展仅转发
- 表单填充：`content.js` 通用识别（密码框定位 + 用户名常见选择器 + 可见性过滤），原生 value setter + input/change 事件（React/Vue 兼容），不自动提交、高亮提交按钮
- 安全：主密码不出主应用；扩展仅启用 activeTab/tabs/storage（storage 只存配对令牌，明文凭据仅瞬时内存转发）；条目列表脱敏（无密码字段）
- 自动捕获（v1.1.2 交付，v1.1.3 修复加固，v1.1.4 链路补全）：`content.js` 监听 submit 后向后台登记待确认凭据（每 tab 一份，25s TTL；站点身份按「帧 hostname → referrer → 顶层 tab URL」三级解析，解析失败如 file:// 页拒绝暂存不弹窗）；浮层触发双路径——新页面加载的 CHECK + submit 后来源 frame 内 24s 观察窗（地址变化/密码框消失启发式，SPA 免刷新即弹；iframe 命中经 `forwardToTop` 由顶层 frame 弹层）。新显式 submit 会解除此前「忽略/关闭」对同域+同账号的弹层抑制；用户点「保存」后凭据以**后台下发的待确认记录**为准（不采信页面提交的 payload），入库按 `hostname + username` 去重并回传 `created / updated / exists`，新建条目标题优先取清洗后的网页 `document.title`（截 200 字符，缺省回退域名），写入必须经用户确认、绝不自动落库
- 投递白名单（v1.1.3）：捕获凭据、条目列表与密码取回只交给浏览器注入、页面无法伪造的 `sender.url` 命中 `isTrustedAppPageUrl()` 的应用页面（GitHub Pages `/lockPass/`、`localhost:1420`、`127.0.0.1:1420`）；自建部署需同步该白名单。`file://` 本地页面之间无法区分，默认拒绝投递，需扩展弹窗显式勾选「允许本地文件页面接收捕获凭据」
- 桌面版本地通道（v1.1.3）：桌面窗口没有页面桥，改走 Rust 侧 `tiny_http` 服务（仅监听 `127.0.0.1:33555`）。扩展弹窗「连接桌面版 LockPass」→ `POST /pair` 取 6 位 nonce → 桌面窗口配对弹窗核对数字点「允许配对」→ 扩展 `GET /pair/poll` 一次性领取 Bearer 令牌；捕获时 `POST /capture`（Bearer 校验、未解锁 409、载荷校验 400）只登记 `{id, created_at, status}` 待确认槽位，**明文不经 Rust 内存与磁盘保留**，凭据随 `lockpass:capture-request` 事件交给窗口，用户在桌面窗口点「保存」才入库；扩展轮询 `GET /capture/status?id=` 一次性领取结果（未决 200 `pending` / 过期 410 / 非法 id 404）
- 通道并发与超时（v1.1.3，v1.1.4 对齐修正）：待确认槽位最多 4 个（满则挤最旧）、按 id 独立回报与领取、仅 `pending` 槽按 180s TTL 过期（终态槽保留至轮询一次性领取或锁屏清空，杜绝保存成功后被清理误报）、锁定即清空；扩展侧等待上限 185s（≥ Rust 槽位 TTL），期间每 20s 真走一次扩展 API 顶住 MV3 后台回收，浮层看门狗 195s（必须晚于后台上限）兜底恢复按钮并提示「未收到保存结果」；410 过期单独回 `expired` 文案，不再并入「返回异常」
- 旅行模式联动：页面桥与桌面通道推给扩展的条目集合均为 `visibleEntries()`，敏感条目不外泄（v1.1.3）
- 限制：浏览器版需 LockPass 页面保持解锁打开；桌面版需应用运行且已完成配对；复杂动态表单可能识别失败；无自动弹出建议

### 3.17 文件同步（本地）

- 浏览器版（Chrome/Edge）：文件系统访问 API，绑定本地数据目录
- 同步失败有 Toast + 状态标签反馈（`lastSyncError`）
- **句柄自愈（v1.0.5）**：`FileSystemDirectoryHandle` 无法经 JSON 序列化还原、引擎升级也可能使存储句柄退化为普通对象（调用 `getFileHandle` 报 "not a function"）；`ensureUsableDirHandle()` 检测到失效即自动解绑并 Toast 提示一次，后续保存回归静默，数据不受影响；设置面板同步显示「目录句柄失效，请重新绑定」。快照浏览器分支同样走自愈
- 桌面版：Tauri 文件存储，等价结构（见 docs/tauri.md）；**禁止绑定同步目录**（bindDirectory 硬拒绝）；file-store 在 `__TAURI__` 缺失时经 `__TAURI_INTERNALS__` 兜底桥接，防止桌面被误判为浏览器而暴露绑定入口（v1.0.6）；v1.0.7 起统一由 `core/tauri-env.js`（挂载 `window.LockTauri`，双信号）提供环境判定，sw-register 桌面分支脚本求值期立即注销残留 SW
- **桌面包剥离 sw.js（v1.0.9）**：`beforeBuildCommand` 链尾调用 `scripts/remove-dist-sw.mjs` 删除 dist/sw.js；受控对比（fastenerTradeWorkbench 无 SW 同机不复现）证实残留注册是首屏 404 根因
- **冷启动自愈探针（v1.0.9）**：`boot-flag.js` 同步置 `__LOCKPASS_BOOTED__`，Rust setup 线程三次 eval 探测，失败页上下文内自动 reload ≤2 次
- **IDB→文件迁移桥（v1.0.9）**：file-store 启用时若文件空而旧 origin IndexedDB 有完整加密负载则一次性搬运（meta.salt/iterations/version + vault/main，排除 dirHandle），openDB 闸门串行化避免竞态

### 3.18 多设备同步（局域网直连，v1.1.5）

设计文档见 `docs/multi-device-sync-design.md`（§4 密钥模型 / §6 合并语义 / §7 协议 / §9 失败模式）。

- **通道**：局域网明文 HTTP，**不经任何服务器 / 云端 / 中继**（离线优先）。桌面端既能开启服务也能连接服务，谁先点「开启服务」谁就是服务端 A；**浏览器版只能当客户端**（无监听端口能力）
- **入口**：侧栏「添加密码 → 更多添加方式」下拉 → 「同步服务」→ 「开启服务」/「连接对端」
- **服务端（A）**：枚举本机局域网 IPv4 供用户单选（多网卡 / VPN / 热点下地址不固定），独立 `tiny_http` 实例，端口 5613 起向后探测 20 个 —— **不复用浏览器扩展桥的 33555**；显示「地址:端口 + 一次性同步口令 + 10 分钟倒计时」
- **客户端（B）**：填地址 + 端口 + 口令 → 对端预览（数据序号 / 时钟偏差）→ 四步进度（鉴权 → 拉取 → 合并 → 回写）→ 结果页
- **一轮结束两端一致**：B 拉取 A 的快照后在**本地**做双向合并（`sync-merge.js`），再把合并结果整包推回 A（`POST /sync/apply` + `baseRev` 乐观锁）；A **不做二次合并**，只校验后原样落盘。不等即 `409`，B 自动重跑一轮
- **同步口令 P**：**6 位纯数字**（v1.1.5 用户拍板「越简单越好」：同网络 + 需手动开启服务 + 只在同步那几分钟有效），一次性、TTL 600s。**P 绝不等于主密码**，界面明确标注；P 本身永不过线（只上线 `HMAC(K_auth, challenge)` 与载荷 `mac = HMAC(K_auth, iv‖data)`）；鉴权失败 3 次即销毁服务实例
- **口令强度取舍记录在案**：6 位数字约 20 bit，低于设计文档 §4.2 原定的 40 bit。可用的前提是「600 秒窗口 + 3 次猜测上限 + 600000 次 PBKDF2 使离线爆破无法在窗口内完成 + P 不是数据密钥（仍需主密码才能解密）」，等价蓝牙 / Wi-Fi 配对 PIN 的用法；若改公网或长期会话，必须换回 ≥40 bit 的词组口令
- **数据面直接复用既有密文信封**（`{salt, iterations, iv, data}`），A 端不解密、不重加密、不需要一次性同步密钥。**硬前提：两端主密码相同**，不同则报 `E_KEY_MISMATCH` 并引导改用 .vault 单边迁移，绝不做跨主密码的自动合并
- **回写沿用 A 的 `salt / iterations`** 加密，A 用自身主密码解密后原样落盘，**不改动 `meta.salt`**（避免把「修改主密码」的语义搅进来）；A 落盘前先写一份本地加密快照作回滚点
- **实施偏差（相对设计文档，均为收紧）**：① **Rust 侧不做任何密码学** —— `mac` 由前端 Web Crypto 裁决后回报布尔，`K_auth` 完全不进 Rust 内存（`hmac` / `pbkdf2` 不可离线获取，离线优先不引入依赖）；② 出站 HTTP 为 Rust 手写最小客户端（`std::net::TcpStream`），不引入 `reqwest`。Rust 侧**零新增依赖**，只搬运密文
- **安全边界**：同步实例**不存在** `/credentials` 之类的明文面（与扩展桥编译期隔离，不是路由内 `if`）；全程只搬密文，明文只在本 webview 内存中解密与合并；载荷上限 8 MB；旅行模式开启时入口置灰且 Rust 侧硬拒
- **角色与限制**：浏览器客户端走 `file://` 双击本地 `dist/index.html`（已实测可行，服务端回 `ACAO: *`）；在线版 https 页面不能当客户端（混合内容被禁）；**手机形态暂不支持**（origin 不固定 → 孤儿数据，且 http origin 无 `crypto.subtle`）
- **已知限制**：墓碑表（`meta.syncBaseline.tombstones`）不随同步交换，风险由合并的交换律 / 幂等收敛性兜底；尚未两台真机联调

### 3.19 设置

- 修改主密码（需验证原密码）
- 自动锁定时间（1/5/15/30 分钟/从不）
- 复制后清除剪贴板时间（10/30/60 秒）
- 标签管理（增/删/改名称、颜色、图标）
- 数据备份与恢复（.vault）
- 销毁保险箱（双重确认）
- 应用更新 / 自动检查更新（仅桌面版）：见 3.20
- 桌面剪贴板实现（v1.0.12）：Windows 走 clipboard-manager 插件 shim；macOS 复制走 WebKit 原生 clipboard API（主线程安全），无手势清空经自定义命令 `clipboard_write_text` 主线程派发 arboard 写入——规避插件 tokio 线程与 WebKit 粘贴板监控的竞态（plugins-workspace#3205）；复制失败自动降级 execCommand 并透出真实错误

### 3.20 自动更新（桌面版）

- 通道：Tauri updater 插件；端点 `https://github.com/trexwb/lockPass/releases/latest/download/latest.json`；公钥内嵌 `tauri.conf.json`（`plugins.updater.pubkey`），更新包带 minisign 签名（CI 以 Secrets 注入私钥 `TAURI_SIGNING_PRIVATE_KEY` 生成 `.sig`）
- 流程：桌面启动 5s 静默检查（开关：设置 → 关于 → 自动检查更新，默认开）→ 发现新版本后台 `downloadAndInstall`（进度 0~100 上报 设置 → 关于 → 应用更新）→ Toast + 确认弹窗 → `process.relaunch` 重启完成安装
- 发布链：release.yml 构建期生成更新产物（NSIS setup.exe / macOS app.tar.gz + .sig），`update-manifest` job 由 `scripts/gen-latest-json.mjs` 汇总生成 latest.json 随 Draft Release 上传；Publish 后全量可达（Draft 未发布时清单 404 属预期）
- 边界：仅桌面版联网检查；浏览器版无更新机制；私钥丢失需轮换公钥并全量重装；v1.0.11 为首个自更新版本，更早版本需手动升级一次

### 3.20 键盘快捷键

快捷键体系优先使用 Alt/Option 组合（避开浏览器保留键），macOS 为 ⌥（Option）、Windows 为 Alt；⌘/Ctrl 按平台自动映射。设置面板内有完整速查表。v1.0.22 起新增列表键盘导航与主界面键盘可达（导航项 / 条目卡片可 Tab 聚焦，Enter/Space 触发）。

| 快捷键 | 功能 |
|--------|------|
| `⌘/Ctrl + K` | 聚焦搜索框 |
| `⌘/Ctrl + Enter` | 保存当前表单（弹窗打开时） |
| `⌥/Alt + N` | 新建密码 |
| `⌥/Alt + Q` | 二维码添加 |
| `⌥/Alt + I` | 批量导入 |
| `⌥/Alt + E` | 导出备份 |
| `⌥/Alt + T` | 标签管理 |
| `⌘/Ctrl + ,` | 打开设置 |
| `⌥/Alt + L` | 锁定保险箱 |
| `⌥/Alt + ⇧ + L` | 退出登录 |
| `⌥/Alt + A` | 筛选：全部 |
| `⌥/Alt + F` | 筛选：收藏；详情面板打开时为收藏当前条目 |
| `⌥/Alt + R` | 筛选：回收站 |
| `⌥/Alt + 1~6` | 筛选：网站 / 服务器 / 数据库 / AI / 应用 / 其他 |
| `⌥/Alt + ⇧ + E` | 编辑当前条目（详情面板打开时） |
| `⌥/Alt + C` | 复制密码 |
| `⌥/Alt + U` | 复制用户名 |
| `⌥/Alt + P` | 切换密码可见性 |
| `⌘/Ctrl + ⌫` | 删除当前条目（回收站视图中为彻底删除） |
| `⌥/Alt + ⇧ + R` | 恢复条目（回收站视图中） |
| `⌥/Alt + ⇧ + ⌫` | 清空回收站（需二次确认） |
| `↑ / ↓` | 列表上下导航选择条目（v1.0.22；非输入态） |
| `Enter / Space` | 卡片聚焦时打开详情（v1.0.22） |
| `Escape` | 关闭弹窗 / 详情面板，或清空搜索 |

### 3.21 旅行模式（敏感条目临时隐藏）

- 数据模型：条目级 `sensitive` 布尔标记（编辑器「敏感条目」开关，提示文案说明隐藏范围），随加密负载存储，不影响既有保险箱结构
- 开关：侧边栏「旅行模式」，状态存 `localStorage`（`lockpass_travel_mode`，仅布尔值、不含任何条目数据），开关本身不落库
- 读取出口统一走 `visibleEntries()` / `isTravelHidden()`：列表与搜索、详情与复制/编辑入口、回收站与过期提醒计数、关联密码、密码健康报告与「关于」条目数、`.vault` 导出（含回收站内敏感条目与其编辑历史快照）、QR 分享与扫码导入的 TOTP 绑定目标、扩展页面桥条目列表、桌面版本地 HTTP 通道推送的条目集合
- 写盘与合并按钮（导入合并、自动备份、保存）仍按全量集合处理，避免覆盖隐藏条目而丢数据；这是刻意区分：**隐藏 = 读取出口过滤，不是从库中删除**
- 副作用守卫（v1.1.3）：开启时关闭正在编辑的敏感条目、编辑器内标敏不再落草稿；`selectEntry` / `openEntryModal` / `copyPassword` / `copyPasswordWithTotp` 统一加隐藏守卫，间接入口不可达
- 取舍：口令仍在库中，仅运行时不出屏；不防住已解锁的机器与内存取证，定位是过境临时隐藏而非删除

---

## 4. 数据结构

### 4.1 存储结构

**浏览器版（IndexedDB）**

```
Database: PasswordVaultDB

ObjectStore: meta (keyPath: key)
  { key: "salt",       value: "base64-encoded-salt" }
  { key: "iterations", value: 100000 }
  { key: "version",    value: 1 }

ObjectStore: vault (keyPath: id)
  { id: "main", iv: "base64-iv", data: "base64-aes-gcm-ciphertext" }
```

vault 密文解密后为应用状态 `{ entries, deleted, tagDefs, ... }`（条目 / 回收站 / 标签注册表整体加密）。

**Tauri 桌面版（本地文件存储，结构等价）**

```
<数据目录>/            # macOS ~/Library/Application Support/com.lockpass
├── meta.json          # 等价 meta store
└── vault.json         # 等价 vault store
```

前端 `src/core/file-store.js` 以同接口透明替换 IndexedDB（DBUtils），加密负载结构不变，两种存储可无缝迁移。

### 4.2 加密流程

```
1. 用户输入主密码
   ↓
2. PBKDF2(salt, password, iterations, SHA-256) → AES Key
   ↓
3. 应用状态序列化为 JSON
   ↓
4. AES-256-GCM 加密（随机 IV）
   ↓
5. 存储至 IndexedDB / 本地文件
```

### 4.3 密码强度计算

```
Entropy = log2(charset_size ^ length)

- 小写字母: 26  | 大写字母: 26 | 数字: 10 | 符号: 32

弱:   < 40 bits  → 红色
中:   40-60 bits → 黄色
强:   60-80 bits → 蓝色
极强: > 80 bits  → 绿色
```

---

## 5. 安全机制

### 5.1 Clipboard 安全

- `navigator.clipboard.writeText()`（Tauri 桌面版走剪贴板插件）
- 复制后定时器覆盖，时间可配置（10/30/60 秒）

### 5.2 自动锁定

- 监听用户交互事件（mousemove, mousedown, keydown, touchstart, scroll）重置计时器
- 超时触发锁定：清除内存明文（entries / 回收站 / 标签）+ **密码历史快照（含修改前明文，v1.0.22 起）** + **编辑器草稿（sessionStorage `lockpass_draft_*`，含明文，v1.0.22 起）** + sessionStorage 会话 + cryptoKey；锁定与退出登录均执行同等清理

### 5.3 安全风险与防范

| 风险 | 说明 | 防范措施 |
|------|------|----------|
| XSS 攻击 | 恶意脚本窃取内存中的明文密码 | 用户输入转义（Utils.escHtml）；仅在受信任环境使用 |
| 浏览器漏洞 | 浏览器被入侵可能读取内存 | 保持浏览器更新，使用主流浏览器 |
| 本地文件泄露 | 电脑被盗/被入侵 | 设置电脑登录密码，启用磁盘加密 |
| 主密码遗忘 | 无法恢复数据 | 牢记主密码，或将主密码存储在安全的地方 |

---

## 6. 浏览器兼容性

| 浏览器 | 版本要求 | 说明 |
|--------|----------|------|
| Chrome | 60+ | 推荐 |
| Firefox | 60+ | 推荐 |
| Safari | 12+ | 支持 |
| Edge | 79+ | 推荐 |

---

## 7. 项目结构

```
LockPass/
├── src/                   # 前端源码（唯一真源）
│   ├── index.html         # Vite 入口 HTML
│   ├── main.js            # Vue 入口：顺序导入 core 模块 + 挂载 App
│   ├── App.vue            # 根组件：认证 → 主界面
│   ├── core/              # 核心逻辑层（ES module，window.* 挂载，零框架依赖）
│   │   ├── crypto.js / database.js / file-store.js / file-sync.js
│   │   ├── generator.js / utils.js / related.js / import-bridge.js
│   │   ├── tauri-bridge.js / sw-register.js / version.js / particles.js
│   ├── composables/       # 响应式状态（useVault / useShortcuts）
│   ├── components/        # Vue SFC（layout / auth / entries / modals / common）
│   ├── styles/            # 设计令牌 + 按域样式（base/layout/entries/editor/modal/settings/utilities/particles）
│   └── public/            # 静态资源（sw.js / manifest.json / assets/vendor/）
├── scripts/               # bump-version / check-version / gen-icons / make-dmg
├── src-tauri/             # Tauri v2 桌面封装
├── dist/                  # 构建产物（vite build 生成）
├── docs/                  # 文档中心（spec / tauri / 迁移设计）
└── README.md / AGENTS.md  # 使用说明 / Agent 开发规范（仓库根，约定位置）
```

---

## 8. 未来规划

- [x] 支持 TOTP 两步验证（HMAC-SHA1 自实现 + 扫码导入 + 密码与验证码组合复制：v1.1.0 落地代码、v1.1.1 补齐接线；v1.1.3 修正扫码绑定时只作用于旅行模式可见条目）
- [x] 密码健康审计（弱 / 复用 / 空 / 长期未更新 / 过期五类，纯本地计算，v1.1.0 落地；v1.1.3 审计输入改为旅行模式可见集合）
- [x] 密码历史记录与回滚（v1.0.x 已实现）
- [x] 支持多语言（中英文轻量 i18n，设置 → 语言即时生效；v1.0.x 基线，v1.1.x 文案渐进迁移）
- [x] 支持自定义主题色（浅色 / 深色 / 跟随系统 + 强调色，v1.0.x 已实现）
- [x] 支持密码过期提醒（条目过期时间 + 提醒天数设置 + 列表卡片角标，v1.1.0 落地、v1.1.1 补齐卡片警示）
- [x] 自动备份提醒 / 定期快照（v1.0.x 已实现）
- [x] 支持浏览器扩展（MV3：自动填充 v1.0.1 交付；自动捕获 v1.1.2 交付、v1.1.3 补齐桌面版本地 HTTP 通道并完成投递白名单等安全加固，见 §3.16）
- [x] 旅行模式（敏感条目运行时从全部读取出口隐藏，v1.1.2 交付、v1.1.3 补齐出口与守卫，见 §3.21）
- ~~密钥文件双因素 / 演示模式 / 活动时间线视图 / 卡片显示自定义~~ → 2026-10-08 判定排除（理由见 `docs/v1.1-plan.md` §三 已排除项；密钥文件未接线的孤立源码已于同日删除）
- ~~泄露检测（HIBP k-anonymity，默认关闭的可选联网功能）~~ → 2026-10-08 判定排除：需联网，与离线优先底线冲突，弱/复用/过期已由本地安全报告覆盖（详见 `docs/v1.1-plan.md` §三 已排除项）
- [x] 移动端体验打磨（底部导航 / 触控目标 / 扫码流程 / 安全区，v1.0.x 已实现）
- [ ] 生物识别 / WebAuthn 全平台：macOS Secure Enclave 代码链路已落地（v1.1.3 修正访问控制标志位并映射签名缺失错误），但**尚未在签名构建上端到端验证**——未签名的开发构建必然返回 `ENTITLEMENT_ERR`；Windows Hello 与浏览器 WebAuthn 未实现（`docs/v1.1-plan.md` Phase 3 §8）

> 优先级与工作量评估见工作区路线图文档；v1.x 的 MAJOR / MINOR 版本升级由用户决定。

---

**文档版本：v1.1.6**
