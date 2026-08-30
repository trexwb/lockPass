# LockPass 版本日志 · v1.1

> v1.1.x 全部迭代记录（最新在前）
>
> 收敛说明：以下版本号无独立分节，内容并入相邻分节——
> `v1.1.1`（并入 v1.1.0，多语言残留清偿）· `v1.1.2`（并入 v1.1.0，Tauri 脚本性能与健壮性深化）· `v1.1.3`（并入 v1.1.0，点击可达性专项审计）· `v1.1.4`（并入 v1.1.0，密码生成器取消生成记录）

### v1.1.7 (2026-08-30)

移动端图标/文字对齐专项修复（触屏优化收口）：

## 修复

- **密码输入框图标错位**（根因）：`.pw-gen-btn` 仅 `display:flex` 缺 `align-items/justify-content` 居中——桌面端尺寸由内容撑开无感，触屏端被 `min-width/min-height: 44px` 撑大后 svg 停靠左上角，表现为眼睛/生成器图标未垂直居中、与相邻按钮视觉重叠；补居中后全局生效（EntryEditorModal 10 处 input-affix、ChangePwModal、自定义字段敏感值眼睛按钮均覆盖）
- **锁屏主密码眼睛按钮**：`.toggle-pw` 同类缺居中，一并补齐
- **触屏双按钮间距**：`.input-affix-btns` 在 `(hover:none) and (pointer:coarse)` 下 `gap: 2px` 过挤，调至 `6px`；输入框 `padding-right` 96px → 112px（44+6+44=94px 按钮区 + right 8px，留 10px 缓冲，避免输入文字被按钮压住）
- **全量排查**：`.btn-icon` / `.btn` / `.type-tab` / `.tag-chip` / `.tag-option` / `.mini-btn` / `.chip .box` / `.hamburger-btn`（含 `.btn-icon` 类）均已具备居中，无其他同类错位

## 验证

- `vite:build` 0 error
- `version:check` 全版本号一致

### v1.1.6 (2026-08-30)

小功能/小工具第一批（upgrade-design.md 第十章 10.1）：搜索增强（B5）+ Chrome CSV 导入向导（C2）+ 回收站定时清空（C4）

## 新能力

- **B5 搜索增强**：新增 `src/core/search.js`（window.SearchUtil）——拼音首字母 / 全拼 / 子串 / 前缀多路匹配，对标题、用户名、备注、URL、自定义字段统一归一化打分排序；搜索结果标题/副标题命中词高亮（`highlightField` 内置 HTML 转义，防 XSS）；`useVault.getFilteredEntries` 全文搜索改走 SearchUtil，回收站视图仍按 deletedAt 倒序
- **C2 Chrome CSV 导入向导**：`src/core/import-bridge.js` 新增列映射能力（`autoGuessMapping` 精确/别名命中、`parseCSVPreview` 预览统计、`COLUMN_TARGETS`），`ImportModal.vue` 新增「列映射 → 预览 → 确认」三步向导——自动识别 Chrome 导出列（name/url/username/password/note），支持手动调整映射、忽略列、重复条目计数提示；拖拽导入同样自动猜测映射
- **C4 回收站定时清空**：软删除已写 `deletedAt` 时间戳；设置-安全新增「回收站自动清空」下拉（从不 / 30 / 60 / 90 天），开启时二次确认（自动清空不可恢复）；解锁后立即检查一次 + 每日定时检查，到期条目彻底删除（同步清理密码历史快照），Toast 报告清理数量

## 存储与设置

- 设置项 `lockpass_recycle_ttl` 存 localStorage（0 = 从不），不改保险箱数据模型，旧数据无 `deletedAt` 不参与自动清空（安全兜底）

## 文档

- AGENTS.md / docs/spec.md 版本号同步 v1.1.6（含 extension/manifest.json、Cargo.toml）

## 验证

- `vite:build` 0 error
- 新增/改动核心脚本 `node --check` 全过

### v1.1.5 (2026-08-30)

条目自定义字段扩展（upgrade-design.md 第一章「条目字段扩展」阶段 0）：

## 新能力

- **数据模型**：条目新增 `customFields` 数组 `{id, label, value, sensitive, type}`，`type` 枚举 `text / pin / email / phone / otp / url / notes`（供浏览器扩展识别填充）；`sensitive` 控制详情页掩码展示
- **类型模板**：新增 `src/core/templates.js`，内置银行 / 邮箱 / WiFi / 服务器 / 社交 / 自定义 6 套模板，应用后自动带入模板字段（label/value 可编辑、可自由增删）
- **编辑弹窗**：新增「自定义字段」区块——快速模板一键应用、手动添加（选类型/输标签）、行内编辑、删除、上下移动、敏感标记开关、敏感值编辑态掩码
- **详情页**：新增「自定义字段」分组（独立于密码组展示），敏感字段默认掩码、眼睛点击揭示，右键支持复制字段 / 揭示·隐藏

## 存储与迁移

- 读取/写入全链路保证默认值 `customFields: []`：解锁迁移（migrateEntry）、saveEntry 归一化清洗（非法 type 回落 text、label 截断 50）、CSV / .vault 加密 / 明文 / 二维码四类导入分支补默认
- `.vault` 导出追加 `schemaVersion: 2`；导入端无该字段视为 v1 旧格式自动补默认值
- 全文搜索同步索引 `customFields[].value`，自定义字段可被搜索命中
- 设置无需改动，迁移自动完成

## 文档

- AGENTS.md / docs/spec.md 版本号同步 v1.1.5

## 验证

- `vite:build` 0 error 0 warning
- `version:check` 11 处 v1.1.5 一致

### v1.1.0 (2026-08-30) 

多语言 i18n 上线（升级方案 §6.5，I1~I5 + B1~B4 分批迁移）+ 残留清偿 + Tauri 性能深化 + 点击可达性专项审计 + 取消生成记录（v1.1.1 ~ v1.1.4 同批收敛）：

## 新能力

- **界面语言切换**：设置 → 外观 → 语言（跟随系统 / 简体中文 / English），切换即时生效无需刷新，偏好持久化（localStorage `lockpass_lang`），首次启动按浏览器语言探测
- **en-US 语言包**：全量英文翻译（词典 981 键，zh/en 完全对齐），回退链 当前语言 → zh-CN → key 本身
- **架构**：`src/i18n/zh.json` / `en.json`（单一事实源，机器可合并）+ `core/i18n.js`（纯逻辑）+ `composables/useI18n.js`（Vue 响应式桥接）；组件统一 `const { t } = useI18n()`

## 迁移覆盖

| 批次 | 范围 | 状态 |
|------|------|------|
| B1 | 组合函数与核心层 toast（useVault/utils/file-sync/backup/updater/import-bridge/tauri-bridge） | ✅ 46 键 |
| B2 | 主界面骨架（AppShell/HeaderBar/SidebarNav/ModalHost/空态/类型标签） | ✅（部分细项见已知限制） |
| B3 | 编辑器 + 详情面板 + 右键菜单（EntryEditorModal 170 处 t()） | ✅ 196 键 |
| B4 | 设置页 + 其余模态框（Import/Export/QrShare/QrImport/Tags/ChangePw/Pair/ModalBase） | ✅ 83+295 键 |

## 多语言残留清偿（en 全流程覆盖收口）

- **快捷键说明表 27 行**：`useShortcuts.js` 全部 27 个快捷键定义加 `nameKey`，设置面板快捷键表与右键「复制操作名称」走 `t(nameKey)`（when/desc 为内部元数据不渲染，保持原样）；en 词典补齐 56 个 `shortcuts.*.when/desc` 键（此前 en_map 前缀映射未命中导致缺失，en/zh 现已全量对齐）
- **错误与系统消息**：database（删除超时）、import-bridge（CSV 校验/状态/解密/格式 ×8）、file-sync（桌面版拒绝绑定 + 4 处 throw：errNoFsApi/errNoVault/errParseFailed/errBadFormat）、tauri-bridge（CSV/vault 对话框过滤器名）全部走词典
- **关联分组标签**：`core/related.js` 详情面板「关联密码（N）」走 `related.sectionTitle`（含 {count} 占位符）；generator.js 强度词（未输入/弱/中/强/极强）此前已走 `editor.strength.*`
- **dev 告警**：`core/i18n.js` `t()` 未命中键时 dev 模式 `console.warn('[i18n] missing key:', key)`（§6.5 验收项）

## Tauri 脚本性能与健壮性深化（/Code 专项，Rust 侧 + 本地服务）

- **[安全] 配对凭据改 CSPRNG**：`generate_token/generate_nonce` 由时间种子 xorshift 改为 `getrandom`（OS 随机源）——token 是扩展鉴权凭据，不可用可预测序列
- **[可靠性] file_store_write 原子写**：先写同目录临时文件并 `sync_all` 刷盘，再 `rename` 原子替换——崩溃/断电不再可能留下半截 vault.json
- **[性能] 本地服务多线程**：tiny_http 单线程循环改为 4 worker（Arc<Server> + recv 循环），单个慢请求不再阻塞扩展自动填充
- **[健壮] body 排空上限**：POST body 排空加 64KB 上限（trait object 上 Read::take 不可用，改手动分块）；GET 请求不再读 body
- **[性能] domain_matches 热路径**：消除每次条目匹配的 format! 分配（字节级后缀比较）
- 验证：cargo check 零警告；vite:build 通过

## 点击可达性专项审计（143 个点击绑定全量盘点 + CSS 层叠交叉核验）

- **[P1] 层级令牌纠偏**：`--z-banner` 令牌 900 与横幅实际层级（v1.0.20 起为 150）不一致，导致移动端抽屉遮罩(900)/抽屉(901) 盖住确认弹窗(400)/Toast(305)/下拉(300)——抽屉打开时触发删除确认等操作会被遮罩挡住（点击无效）。令牌统一改 150：抽屉(151)/遮罩(150) 仍在内容(100)/header(100) 之上，且在弹窗(200+)/确认(400) 之下
- **[P3] ExportModal**：`tabindex="1"/"2"` 反模式移除（自定义 tabindex 扰乱自然 Tab 顺序），回归 DOM 顺序
- **核验方法**：143 个 @click/@dblclick/@contextmenu 绑定全量盘点；37 个跨组件方法名经解构解析核验全部有效（无死点击）；右键菜单/遮罩/悬浮层各有 pointer-events 或 .self 守卫

## 密码生成器：取消生成记录（v1.1.4，用户决策）

- **功能移除**：生成器弹窗不再保留会话级历史（原内存保留 5 条、点击复制）——生成过的密码在投屏/他人视角下即明文暴露面，取消记录是最干净的解法
- **连带清偿**：点击可达性评审（docs/audit-pwgen-2026-08-30）的 P2-B「历史复制反馈错位」与 P3-F「历史无清空入口」随功能移除一并消除
- **同步清理**：组件 state/模板区块、generator.css 50 行历史样式、zh/en 词典 `pwgen.history` 键；生成后仅保留当前预览（点击复制/刷新/填入交互不变）
- 验证：vite:build 通过；生成器 history 残留扫描零命中；version:check 11 处 v1.1.4 一致

## 同批修复（迁移与迭代过程中发现并修复）

- SettingsModal 语言行接线：脚本解构 `t: tUi` 与模板 `t(...)`/`langPref` 不匹配（打开设置必崩）
- 存储架构描述行开标签丢失 `>`（repall 锚点吞字符）×3
- 签名环境变量互斥：`--private-key` 与 `--private-key-path` 不可同时设置，包装器统一为仅内联注入
- 备份提醒下拉「关闭」选项结构破坏修复；自动快照行文案迁移补齐

## 已知限制

- `labelKey` 旁的 zh 兜底数据行（label 字段，模板恒走 `t(labelKey)` 渲染）、核心层 console 开发者消息、DEFAULT_TAGS 用户数据——均非用户可见 UI 文案

## 验收对照（§6.5 最终确认）

- ✅ 切换即时生效无需刷新（响应式语言态 `i18nState.lang`）
- ✅ 偏好重启保留（localStorage `lockpass_lang`；`system`/`zh-CN`/`en-US` 三值）
- ✅ en 全流程无中文残留（除用户数据）：组件功能性文案全 key 化；剩余中文为注释/console 日志/数据兜底字段
- ✅ 构建体积增量：HEAD 基线 126.83 kB → 当前 150.58 kB（gzip），增量 23.75 kB < 25 kB 达标
- ✅ `vite build` 0 error 0 warning
