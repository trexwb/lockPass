# LockPass 版本日志 · v1.0

> v1.0.x 全部迭代记录（最新在前）
>
> 收敛说明：以下版本号无独立分节，内容并入相邻分节——
> `v1.0.1`（并入 v1.0.0 初版）· `v1.0.22~24`（并入 v1.0.25，过渡版本号）·
> `v1.0.26~28`（并入 v1.0.29，复制反馈迭代）· `v1.0.30~33`（并入 v1.0.34，同批次）

### v1.0.34 (2026-08-29)

复制成功反馈重构（v1.0.26 ~ v1.0.34 多轮迭代统一收敛至本分节）：

- **新增 CopyCountdownPill.vue 倒计时胶囊组件**：合并原「Toast + 浮动提示」双路反馈为单一胶囊，由 `vaultState.clipboardCountdown` 响应式状态驱动，移除 useVault.js 中的跨层 DOM 操控
- **右下角定位**（桌面 >480px）：`right/bottom: 24px + 安全区`，符合密码管理器惯例；移动端 ≤480px 改为底部全宽
- **底边进度条**：100%→0% 每秒递减，颜色随紧迫度渐变（绿 → ≤10s 琥珀 → ≤5s 红）
- **倒计时秒数**：`tabular-nums` 等宽数字 + 随紧迫度变色；手动 × 关闭 + 清除后自动淡出
- **Teleport 到 body**：脱离 `#app-shell` 的 `overflow:hidden`
- **入场动画 pill-pop-in**；**保留**卡片复制高亮 `.copied` 与 `srAnnounce`；新增 `--z-float-tip: 350`
- **清理**：移除旧版 `.copy-float-tip` 全部样式与 `#clipboard-note` DOM

### v1.0.29 (2026-08-29)

> v1.0.26 ~ v1.0.28 为复制反馈功能的多轮构建迭代中间版本，无独立发布内容，统一收敛至 v1.0.29。

**可访问性修复（P0）**
- 颜色对比度：`--text-faint` 暗 `#484f58`→`#797f8b`、浅 `#8c959f`→`#6e7681`，达 WCAG AA
- ModalBase ARIA 完整：`ariaLabel` prop + `ariaLabelledBy` 自动关联 + `role="dialog" aria-modal="true"`
- 修改密码弹窗三个密码框独立可见性切换 + 顶部不可撤销警告框（`role="alert"`）
- 条目卡片键盘可达：`tabindex="0"` + `role="button"`，Enter/Space 触发

**操作流程改进（P1）**
- 设置模态框重构为 6 标签页（安全/外观/同步/数据/扩展/关于），`role="tablist"` 语义化
- 编辑器关闭未保存警告：`snapshotForm()` + `hasUnsavedChanges()` 检测
- 编辑器表单校验：标题非空、URL 格式、端口 1-65535、邮箱格式
- AppShell 支持 Shift+F10 键盘呼出右键菜单；搜索框清除按钮 + Esc 先清空再失焦
- CSV 导入列头校验：缺 title/password 中止，未知列名警告

**用户体验（P2）**
- 软删除撤销：删除后 toast 带「撤销」按钮（5 秒有效）
- 复制反馈 aria-live：`srAnnounce` + `role="status" aria-live="polite"`
- Toast 支持 action 按钮（label + callback）

**视觉一致性（P2）**
- `.btn-icon.btn-icon-sm` 24→28px、`.btn-icon-xs` 26→24px（xs 应比 sm 小）
- 新增 `--radius-xs: 4px` 令牌，批量替换硬编码圆角；硬编码 `#fff` 改 `var(--text-on-accent)`

**功能增强（P3）**
- 浅色主题对比度微调；导出按标签筛选；标签合并视图（选择源/目标标签遍历替换）

### v1.0.25 (2026-08-28)

多维审计 P1 修复包（六项）+ 构建阻断修复：

- **危险确认焦点**：danger 弹窗默认焦点改「取消」，Enter 连按不再误触发删除/销毁/回滚（utils.js）
- **app 条目复制语义**：详情底部按钮按类型明确（app →「复制 App ID」），行级复制与标签一致（DetailPanel）
- **修改主密码误报**：两段式——旧密码校验单独捕获；重加密/保存阶段的异常不再误报「当前主密码错误」（ChangePwModal）
- **编辑草稿恢复**：编辑模式恢复未保存草稿（此前只写不读），恢复时 toast 提示（EntryEditorModal）
- **替换导入孤儿历史**：二维码替换导入时迁移旧条目密码历史到新条目，清除孤儿明文（QrImportModal）
- **忘记主密码引导**：锁屏新增入口，说明离线加密无找回可能并引导备份恢复/销毁重建（AuthView）
- **构建修复**：AuthView 断裂字符串重建；TagsModal 合并视图（并行编辑引入）的孤立 v-else-if 修正为三态链（list/form/merge）
- 实测：vite:build 通过（353KB）；签名链路冒烟通过


### v1.0.22 (2026-08-29)

> v1.0.22 ~ v1.0.24 为审计复审期间的过渡版本号，无独立发布内容，统一并入 v1.0.25 分节（多维审计 P1 修复包）。

### v1.0.21 (2026-08-28)

清偿 v1.0.20 审计遗留项（F6/F11/F14/F16）：

- **F6 触屏输入框**：`(hover:none)` 下 `.input-affix .form-input` 预留宽度 80→96px，容纳触屏放大的双按钮
- **F11 触控区**：`.type-tab / .tag-option / .tag-chip / .accent-dot / .color-swatch-btn` 统一 ≥32px；header 设置按钮图标态补 `min-width:40px`
- **F14 死代码清理**：补 `--text-secondary` 变量映射（5 处历史引用原本静默回退）；删除未引用的 `--z-overlay/--z-sidebar`；对齐导出弹窗类名（`.export-option-info h4/p` → `.export-option-title / .export-option-text .text-muted`）；补齐模板已用未定义的工具类（`.py-4/.py-6/.mr-1/.text-xs/.qr-text-box`）
- **F16 详情面板**：≤1024 全屏态新增点击遮罩（z 199，面板 200 之下），点击面板外关闭；面板加层级阴影
- 全部修复仅触响应式/触屏/清理路径，桌面宽窗视觉与业务逻辑零改动


### v1.0.20 (2026-08-28)

> 本版本包含两批内容：① 响应式专项修复（主线审计）；② 安全与正确性修复批次（下方，来源 CHANGELOG.md）。

#### 安全与正确性修复批次

**[CRITICAL] 安全修复**
- 修复 macOS 剪贴板清除功能失效：`tauri-bridge.js` 中 `lt.invoke` 变量名大小写错误（应为 `LT.invoke`），复制密码后自动清除完全失效，密码永久留在剪贴板
- 修复扩展桥 postMessage 通配 origin：`ext-bridge.js` 的 `'*'` targetOrigin 改为 `window.location.origin`，防任意页面截获会话令牌与明文密码
- PBKDF2 迭代次数提升至 OWASP 2023 推荐：新建保险箱 100,000 → 600,000（旧保险箱保持兼容；修改主密码时自动升级）
- 修改主密码时纳入密码历史：`ChangePwModal.vue` 重加密 payload 补 `history` 字段（此前修改密码后历史无法解密）

**正确性修复**
- 编辑器切换类型时清理残留字段（旧类型字段残留被持久化进加密 vault）
- 密码显隐状态移出 entry 数据对象：改 `vaultState.showPasswordMap` 按 ID 管理（此前被序列化污染数据模型）

**性能修复**
- SettingsModal 600ms 轮询定时器 onBeforeUnmount 清理；剪贴板倒计时 interval 引用管理（防累积闪烁）

**可维护性 / 可访问性**
- tauri-server-bridge.js var→const/let；生产构建移除 console.debug/log（esbuild pure）
- DetailPanel 关联密码项键盘操作（role/tabindex/enter）；ModalBase aria-modal；图标按钮 aria-label

响应式专项审计与修复（红队交叉核验报告 16 项发现，本轮落地 10 项）：

**P1（功能/遮挡）**
- ≤480px 搜索功能恢复：搜索框改为常驻收窄（原 display:none 导致手机宽度无搜索入口，⌘K 也无法聚焦隐藏元素）
- 绑定横幅 z-index 900→150：不再压住弹窗遮罩(301)/确认框(400)/Toast；抽屉(151)仍可盖住横幅
- 横幅垫高改 ResizeObserver 精确同步（`--lp-banner-h` 变量，替代 42/72px 固定猜测，小屏折行不再遮挡 header、无滚动冗余）
- 触屏：详情面板 btn-icon-sm 与锁屏 toggle-pw 提升至 32px 触控区
- 扫码状态文字移出取景框（原被 aspect-ratio+overflow:hidden 裁切，识别反馈不可见）
- 移动端 Toast z 305：高于弹窗遮罩 301，弹窗内复制/校验反馈可见

**P2（一致性）**
- ≤1024 弹窗边距统一（.modal,#modal 同规则，消除 481-1024 区间确认框与业务弹窗表现分叉）
- ModalBase 的 maxWidth prop 真正生效（编辑器/设置 520/560px 设计意图落地）
- ⌘/Ctrl 快捷键文案随平台：HeaderBar 搜索占位、QrImportModal 粘贴提示、SettingsModal 键位表统一 userAgentData 判定

**已核验无恙**：长 URL/ssh 命令换行、卡片 ellipsis、右键菜单视口钳制、二维码尺寸自适应、快捷键表窄屏折行、iOS 防缩放等 8 项（红队确认免复查）。

**遗留（后续版本）**：触屏 affix 双按钮与输入框预留宽度（需实测）、次级控件触控区批量提升、样式死代码清理（--text-secondary 未定义、export-option 类名失配、未定义工具类）、全屏详情面板遮罩/返回入口强化。

**过程说明**：本版本由集群模式交付——两个审计 subagent 因上游 API 不稳（403/超时）中断，核验报告 128 行抢收成功 + 主线补审完成合并；期间发现 exec 管道对特定序列存在字符污染，已用字符码断言方式规避。


### v1.0.19 (2026-08-28)

Windows 桌面版横幅排除修正 + 签名路径修正：

- **横幅判定统一**：v1.0.18 的桌面排除按 `navigator.platform` 特判 MAC，Windows（Win32）未覆盖导致仍显示「建议绑定数据目录」横幅；改为统一走 `window.LockTauri.isTauri` 双信号判定（Windows 下 `__TAURI__` 注入异常也有 `__TAURI_INTERNALS__` 兜底），三平台行为一致
- **.env.local 路径修正**：`TAURI_SIGNING_PRIVATE_KEY_PATH` 由 `~/.tauri/...` 改为绝对路径（Node `fs.existsSync` 不展开波浪号，指针形式此前名不副实，包装器实际走的是兜底路径）


### v1.0.18 (2026-08-28)

绑定横幅桌面排除初版 + 本地签名环境文件：

- 解锁后「建议绑定数据目录」横幅增加桌面排除（初版按 MAC 平台特判，v1.0.19 修正为统一判定）
- 新增本地签名环境文件 `.env.local`（600 权限、gitignore 覆盖）：私钥路径指针 + 密码，包装器 `with-updater-key.mjs` 自动加载
- 签名密钥生成命令记录：`npm run tauri -- signer generate -p 密码 -w ~/.tauri/lockpass-updater.key`（当前密钥为 08-28 以此命令生成的加密态密钥，公钥已同步 tauri.conf.json）


### v1.0.17 (2026-08-28)

修复签名环境变量互斥冲突：tauri CLI 中 `--private-key` 与 `--private-key-path` 互斥，包装器此前同时注入两者导致 `tauri signer` 报参数冲突。

- 包装器统一为**仅内联**注入（读取 .env.local 的 PATH 指针 → 私钥文件 → 内联变量），并 `delete` 掉 `_PATH` 变量规避互斥
- 端到端：`tauri signer` 冒烟 + 完整 `npm run tauri:build`（EXIT=0，updater .sig 408B）双双通过，密码取自 .env.local（用户已填）


### v1.0.16 (2026-08-28)

修复 CI 更新清单生成漏检（update-manifest 报「未找到任何带 .sig 的更新产物」）：

- **根因**：download-artifact 会保留上传时的子目录层级（产物在 artifacts/windows/nsis/... 与 artifacts/macos/macos/...），gen-latest-json.mjs 只扫描顶层目录导致漏检；本地夹具（模拟 CI 嵌套层级）复现并验证修复
- **修复**：gen-latest-json.mjs 改为递归扫描，未找到产物时打印已扫描目录树辅助排障
- **附带**：版本日志体系迁移至 docs/version/（按主版本归档，对齐 fastenerTradeWorkbench 模式）


### v1.0.15 (2026-08-28)

修复本地构建仍报「no private key」：包装器此前只注入 `TAURI_SIGNING_PRIVATE_KEY_PATH`，而 **`tauri build` 的更新产物签名只认内联 `TAURI_SIGNING_PRIVATE_KEY`**（`_PATH` 形式仅 `tauri signer` 子命令支持，此前冒烟测的恰好是 signer 子命令故被误导）。

- 包装器在 env 加载后统一补齐内联变量：从 `.env.local` 的 PATH 或兜底私钥文件读取内容注入
- 加密态检测：私钥首行含 encrypted 且未提供密码时打警告（当前密钥为加密态，密码取自 .env.local）
- 实测：本机 `npm run tauri:build` 端到端产出 `LockPass.app.tar.gz` + `.sig`（408B），退出码 0


### v1.0.14 (2026-08-28)

签名环境变量收敛到项目根 `.env.local`：

- 包装器 `with-updater-key.mjs` 改为优先加载项目根 `.env.local`（兼容旧位置 `~/.tauri/lockpass-updater.env`），`tauri:build` 无需手动 source
- `.gitignore` 补 `.env.local`；文件含 600 权限，内容为私钥路径指针 + 密码占位（密钥现为「带密码加密」状态，密码由用户自行填写，不入库不外泄）
- 公钥已同步为当前加密密钥对的公钥（tauri.conf.json）；端到端签名冒烟通过
- 加载顺序：手动 export 优先 > .env.local > ~/.tauri 旧位置 > 本地私钥路径兜底


### v1.0.13 (2026-08-28)

修复本地打包「A public key has been found, but no private key」：

- **根因**：v1.0.11 起公钥内嵌 + createUpdaterArtifacts 后，本地 `npm run build` 签名更新产物时要求 `TAURI_SIGNING_PRIVATE_KEY`，该变量此前只在 CI Secrets 中存在
- **修复**：`tauri:build` 接入包装器 `scripts/with-updater-key.mjs`——未设置签名变量时自动注入 `~/.tauri/lockpass-updater.key` 路径与空密码 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`（空密码密钥在无 TTY 环境必须显式提供空值，否则 CLI 交互询问密码直接失败）；CI 已有 Secrets 时原样透传；release.yml 两个构建 job 同步补显式空密码
- **备选**：也可手动在 shell 配置里 `export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/lockpass-updater.key"`


### v1.0.12 (2026-08-28)

修复 macOS 桌面版「复制失败，请手动复制」：

- **根因**：tauri-plugin-clipboard-manager 在 tokio worker 线程经 arboard 调 NSPasteboard，与 WebKit 主线程的粘贴板监控竞态（官方 issue plugins-workspace#3205，macOS 26 上高发）→ `write_text` 失败 → 复制报错；原实现把真实错误吞成统一文案且无法定位
- **修复三层**：
  1. macOS 桌面不再安装剪贴板插件 shim，点击复制回归 WebKit 原生 `navigator.clipboard.writeText`（主线程执行、手势可用、天然线程安全）；Windows 保持插件 shim 不变
  2. 无手势场景（如 10s 自动清空剪贴板）新增 Rust 命令 `clipboard_write_text`：`run_on_main_thread` 派发 arboard 写入，绕开线程竞态（前端经 `LockClipboard.write` 统一入口）
  3. `copyToClipboard` 失败自动降级 `execCommand('copy')` 兼容通道，仍失败才报错且 Toast 携带真实错误信息；复制后的纯 UI 装饰异常不再误报为复制失败
- **影响面**：仅 macOS 桌面行为变化；Windows / 浏览器版复制路径不变


### v1.0.11 (2026-08-28)

新增桌面版自动更新（Tauri updater 插件 + GitHub Releases）：

- **更新通道**：启动 5s 后静默检查 GitHub Releases 的 `latest.json`；发现新版本自动下载安装（进度在 设置 → 关于 → 应用更新 展示），完成后弹窗重启生效；可在设置关闭自动检查
- **发布链**：`createUpdaterArtifacts` 生成签名更新包（Windows NSIS setup.exe / macOS app.tar.gz），新增 `update-manifest` job 汇总双平台产物生成 `latest.json` 随 Draft Release 发布；签名私钥经 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` 注入
- **完整性**：更新包签名校验（公钥内嵌 tauri.conf.json），拒绝篡改与错配
- **引导说明**：v1.0.11 为首个可自更新版本，更早版本需手动安装一次；浏览器版/Pages 不具备也不需要更新能力（刷新即最新）
- **同批**：v1.0.10 已将设置面板「使用指南」切至 Pages 托管（`lockpass-扩展使用指南.html`，构建时由 `copy-guide.mjs` 拷入站点）
- **运维备注 · 签名密钥生成（本机一次性）**：
  ```bash
  npm run tauri -- signer generate -p 密码 -w ~/.tauri/lockpass-updater.key
  ```
  `-p` 后接密钥密码（当前密钥即为 08-28 以此命令生成的加密态密钥）；生成 `.key` 私钥与 `.key.pub` 公钥，公钥需内嵌 `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥与密码分别录入 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）与本地 `.env.local`。密码丢失需重新生成密钥对并轮换公钥，已发版本用户须全量重装


### v1.0.10 (2026-08-28)

扩展使用指南切 Pages 托管 + 扩展 zip 随站发布：

- 设置面板「浏览器扩展 → 使用指南」链接切至 Pages 托管（`lockpass-扩展使用指南.html`，构建时由 `copy-guide.mjs` 拷入 dist 根目录）
- Pages 流水线（pages.yml）新增扩展 zip 打包步骤：随站点发布 `lockpass-extension-v<版本>.zip`
- 指南页图片链接更新为 GitHub 仓库地址；Vue 依赖版本更新

### v1.0.9 (2026-08-27) ✅ 已发布

Windows 桌面启动 404 问题根治（受控对比实验锁定根因）：同机另一 Tauri 项目（fastenerTradeWorkbench，无 Service Worker）从不复现该症状——唯一结构差异即 lockPass 自 v1.0 起随包携带并注册 PWA SW，其历史注册残留在 http://tauri.localhost 的 WebView2 用户目录中，冷启动首次导航被 SW 接管时产生浏览器级 404。

- **打包剥离**：`beforeBuildCommand` 追加 `node scripts/remove-dist-sw.mjs`，桌面包不再携带 `sw.js`（浏览器版/Pages 流程不受影响），从源头杜绝新的注册可能
- **自愈探针**：`core/boot-flag.js` 最先同步设置 `__LOCKPASS_BOOTED__`；Rust setup 注入一次性探针（500ms/1400ms/3000ms 三次 eval），首屏未完成引导则页面上下文内自动 reload（最多重试 2 次），替代手动点「刷新」
- **数据迁移桥**：发现历史上 `__TAURI__` 注入异常期间 file-store 从未激活、密码库一直存放在旧 origin 的 IndexedDB 中。新增一次性迁移——文件存储为空而 IDB(`PasswordVaultDB`) 有 salt+vault.main 时整体搬入 meta.json/vault.json（刻意排除 dirHandle，禁止把浏览器版句柄带入桌面）；所有读写经 openDB 闸门串行化保证 boot 首读前完成
- **设置面板外链升级**：桌面端改用 Rust 命令 `open_url`（协议白名单校验）直接在系统浏览器打开扩展下载/指南链接，剪贴板复制降级为兜底


### v1.0.8 (2026-08-27) ✅ 已发布

设置面板新增「浏览器扩展」分组（位于「备份」之后）：

- **下载扩展包**：一键打开 Pages 发布的 `lockpass-extension-v<版本>.zip`，版本号与主应用一致；浏览器直接新标签页下载
- **使用指南**：跳转 GitHub 文档《lockpass-扩展使用指南》（安装/配对/自动填充说明）
- **桌面版适配**：桌面端无 shell/opener 插件，点击后自动复制链接到剪贴板并提示在系统浏览器中打开（面板内有说明文案）


### v1.0.7 (2026-08-27) ✅ 已发布

修复 Windows 桌面版启动 404（需点「刷新」才能进入）复发问题：

- **根因**：与 v1.0.2 所修问题同源——桌面/浏览器判定依赖 `window.__TAURI__` 全局，而该用户 Windows 环境此全局注入缺失，v1.0.2 的「桌面跳过 SW 注册 + 清残留」逻辑从未执行：WebView2 在 `http://tauri.localhost` 注册了 PWA SW，旧 SW 拦截首屏导航返回 404 错误页
- **连锁确认**：同一缺失也是 v1.0.5/v1.0.6 所修「目录绑定入口暴露 → 句柄 JSON 落盘退化 → 每次写入报 getFileHandle 错」的源头；本次一并收口
- **修复**：新增 `src/core/tauri-env.js` 统一环境探测（最先加载）——`__TAURI__.core.invoke` 可用则直连，否则回退恒存在的 `__TAURI_INTERNALS__.invoke` 并输出警告日志，结果挂载 `window.LockTauri`；file-store / sw-register / tauri-bridge / tauri-server-bridge 四处消费方全部改为读取 LockTauri；sw-register 桌面分支提前到脚本求值期立即清残留（不再等 load），尽量缩小旧 SW 干扰窗口
- **升级用户**：安装本版后第一次打开若仍见 404，点一次「刷新」进入即可；此后每次启动恢复正常（残留 SW 已被清除）


### v1.0.6 (2026-08-27) ✅ 已发布

Windows 桌面端「绑定目录后每次写入报 getFileHandle not a function」加固：

- **背景**：Windows 上若 `window.__TAURI__` 全局注入异常，file 存储不启用，桌面被误判为浏览器 → 设置面板出现「绑定目录」入口；WebView2 选择器返回的目录句柄经 JSON 落盘（meta.json）后丢失全部方法，之后任何写入触发 syncNow 都抛 `getFileHandle is not a function`
- **修复**：① file-store 增加 `__TAURI_INTERNALS__` 兜底桥接——`__TAURI__` 缺失时仍以文件存储模式运行并输出警告日志；② 绑定入口、设置面板状态判定升级为双信号检测；③ `bindDirectory()` 在 Tauri 环境硬拒绝并提示「桌面版数据已由本地文件自动保存，无需绑定同步目录」，从源头杜绝误绑
- **对已有损坏状态**：升级到本版后首次写入会自动解绑失效句柄（Toast 提示一次）并恢复正常保存


### v1.0.5 (2026-08-27) ✅ 已发布

修复任何写入操作都报「本地文件同步失败：e.getFileHandle is not a function」的问题：

- **根因**：绑定的目录句柄（FileSystemDirectoryHandle）退化为普通对象——该对象无法经 JSON 序列化还原方法（桌面文件存储/异常迁移场景），或引擎升级导致旧句柄失配；同步流程仍照常读取并调用其 `getFileHandle`，每次保存（doSave 均触发 syncNow）都抛错弹 Toast
- **修复**：新增 `ensureUsableDirHandle()` 自愈式获取——检测到句柄无 `getFileHandle` 方法时自动解绑（清除存储句柄与绑定标记）、Toast 提示一次「本地文件同步已停用…可在设置中重新绑定」，此后未绑定状态静默跳过；自动快照浏览器分支与设置面板状态显示同步适配（面板显示「目录句柄失效，请重新绑定」）
- **影响**：密码数据本身始终保存在 IndexedDB / 桌面本地文件中，完全不受影响；重新在设置中绑定目录即可恢复文件同步


### v1.0.4 (2026-08-27) ✅ 已发布

回滚功能优化：「密码历史」升级为「修改历史」——

- **全字段记录**：不再只记密码。编辑保存时任意内容字段（标题/用户名/网址/备注/标签/端口/Root 账号/App ID/私钥等）有变更都会生成一条记录，内容为修改前的完整字段快照 + 变更字段列表；favorite / 显密等状态位变化不记录
- **确认弹窗防误操作**：点击「回滚」先弹出确认（提示将覆盖哪些字段），原「回滚前自动把当前密码存入历史」的保护方式取消
- **执行即删**：回滚成功后删除被执行的那条记录，避免重复执行
- **回滚不新增记录**：回滚不是编辑，不再产生新的历史条目
- 兼容旧版 `{ password, at }` 仅密码记录：仍可展示与回滚（只恢复密码），列表标注「旧版记录 · 仅密码」；每条目仍保留最近 5 版


### v1.0.3 (2026-08-27) ✅ 已发布

修复「批量导入」导入备份 JSON 报 `不支持的文件格式` 问题：

- **根因**：导入侧仅识别 `.vault` 导出的 `format: 'encrypted'` 标记或明文 `entries` 结构；而自动快照 / 文件同步生成的 JSON（`LockPass-backup-*.json`、`LockPass-vault.json`）使用 `format: 'LockPass-file-sync'` 信封，两条判断都不命中，直接弹出格式错误提示
- **修复**：「批量导入」弹窗与主窗口拖拽导入（`import-bridge.js`）均改为按加密封套结构识别——文件同时含 `salt + iv + data` 即走主密码解密流程；快照文件的展示时间回退读取 `updatedAt`
- **影响**：`.vault` 导出、自动快照、同步 JSON 三类加密备份现在均可直接导入；解密逻辑不变（PBKDF2 按文件自带 salt / iterations 派生密钥）


### v1.0.2 (2026-08-25) ✅ 已发布

修复 Windows 桌面版首次启动 404（点击刷新后恢复正常）问题：

- **根因**：Tauri 桌面版也注册了 PWA Service Worker，旧 SW 缓存的资源清单与安装包内嵌资源不一致时，首屏导航被旧 SW 拦截返回 404；刷新后新 SW 接管才正常
- **修复**：`sw-register.js` 增加 Tauri 环境检测（`window.__TAURI__`），桌面版跳过 SW 注册；启动时自动注销历史版本残留的 SW 并清空 CacheStorage，升级用户首次运行即完成清理，之后不再出现 404
- **影响**：浏览器版（file:// / localhost / GitHub Pages）SW 注册与 PWA 更新机制保持不变，仅桌面版行为变更


### v1.0.0 (2026-08-22) ✅ 已发布

PWA 更新机制修复 — 解决「添加到主屏幕」后线上代码更新无法触达用户的问题：

- **sw.js fetch 策略重构**：
  - 导航请求（index.html）从「缓存优先」改为「网络优先」— 用户每次打开 PWA 先尝试拿最新 HTML，网络失败时回退缓存保底离线可用
  - 静态资源（JS/CSS）从「缓存优先」改为「Stale-While-Revalidate」— 先返回缓存秒开，同时后台拉取新版写入缓存，下次打开生效
- **sw-register.js 新增 controllerchange 自动刷新**
- **6 种条目类型**：网站、服务器、数据库、AI、应用、其他凭证（服务器含 root 账号层级；应用含公钥/私钥多行 PEM；AI 含 Token）
- **二维码同步**：分享为加密二维码（LockPass-QR v1 载荷）+ 移动端扫码 / 上传 / 拖拽 / 拍照导入
- **回收站**：软删除 + 恢复 / 彻底删除 / 清空，删除数据不随导入导出迁移
- **标签体系**：合并「分类 + 标签」为统一标签注册表（颜色 + 图标），旧数据自动迁移
- **关联密码**：同 IP / 根域名 / 内网主机名 / 同账号自动关联
- **Vue 3 迁移**：全量迁移至 Vue 3 + Vite（iife 产物，file:// 双击可用），详见 `docs/superpowers/specs/2026-08-23-vue3-migration-design.md`
- **Bug 修复**：CSV 导入切行不一致（RFC 4180 引号字段内换行）；FileSync 同步失败无反馈；exportVault 迭代次数硬编码；importEncryptedVault 忽略文件自带迭代次数

---

