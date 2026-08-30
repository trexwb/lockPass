---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 16825e3339a4e87ec3619b4c10842061_6733b90ea43211f1abe1525400e6dd8f
    ReservedCode1: ZSnsNt5BtpH2i1xCuWiUaOZtm7tL4hMzS42ETDVOY4lbfp8xSH8rVK5Dc5r5aybBWW3K9PDs8f4BUmAPx8yemceXRNsGvE7kiyhzKxTQ3fcbf+e6DRlFGeEI/6I9ZK0tiCjyvRvm5vFGT4933JJgCVQXR7YXl/ijaRppI/NlFa/EsTegCYQWQvBKtdU=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 16825e3339a4e87ec3619b4c10842061_6733b90ea43211f1abe1525400e6dd8f
    ReservedCode2: ZSnsNt5BtpH2i1xCuWiUaOZtm7tL4hMzS42ETDVOY4lbfp8xSH8rVK5Dc5r5aybBWW3K9PDs8f4BUmAPx8yemceXRNsGvE7kiyhzKxTQ3fcbf+e6DRlFGeEI/6I9ZK0tiCjyvRvm5vFGT4933JJgCVQXR7YXl/ijaRppI/NlFa/EsTegCYQWQvBKtdU=
---

# LockPass 版本日志 · v1.1

> v1.1.x 全部迭代记录（最新在前）
>
> 收敛说明：以下版本号无独立分节，内容并入相邻分节——
> `v1.1.1`（并入 v1.1.0，多语言残留清偿）· `v1.1.2`（并入 v1.1.0，Tauri 脚本性能与健壮性深化）· `v1.1.3`（并入 v1.1.0，点击可达性专项审计）

### v1.1.0 (2026-08-30) 📝 待发布

多语言 i18n 上线（升级方案 §6.5，I1~I5 + B1~B4 分批迁移）+ 残留清偿 + Tauri 性能深化 + 点击可达性专项审计（v1.1.1 ~ v1.1.3 同批收敛）：

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
*（内容由AI生成，仅供参考）*
