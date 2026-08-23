# LockPass Vue 3 迁移设计

- 日期：2026-08-23
- 状态：已确认
- 分支：refactor/vue
- 基准版本：v1.0.0

## 背景与动机

LockPass 为纯前端离线密码管理器（原生 HTML+JS+CSS，PWA + Tauri v2 桌面封装），当前约 18 个 JS 模块。用户计划后续扩展较复杂新功能（TOTP、多设备同步、浏览器扩展），原生 DOM 操作开发效率低，决定全量迁移至 Vue 3 + Vite，为后续功能迭代铺路。

## 约束（已与用户确认）

1. 全量重写：整个应用迁移到 Vue 3 + Vite，一次到位
2. 浏览器版必须保留"双击 index.html 即用"能力（file:// 直开）
3. 本次只做等量迁移，不新增功能（TOTP 等后续再议）
4. 保留"约束从简"偏好：不引入重型依赖

## 1. 技术栈

| 项 | 选择 | 说明 |
|----|------|------|
| 框架 | Vue 3 + Composition API（`<script setup>`） | 组件化 + 响应式 |
| 构建 | Vite | 取代 copy-frontend 拷贝式构建 |
| 状态管理 | composables（不引 Pinia） | 项目规模用 Pinia 过重 |
| 路由 | 不引入 vue-router | 单视图架构，侧边栏筛选不需要路由 |
| UI 库 | 无，自绘组件 | 保留现有设计令牌，零视觉回归 |
| 双击即用 | vite-plugin-singlefile | 双产物模式 |

新增 devDependencies：`vue`、`@vitejs/plugin-vue`、`vite`、`vite-plugin-singlefile`；保留 `@tauri-apps/cli`。

## 2. 目录结构

```
src/
├── main.js               # Vue 入口（挂载 + 快捷键初始化）
├── App.vue               # 根组件：auth（创建/解锁）→ 主界面
├── index.html            # Vite 入口（原 index.html 改造）
├── core/                 # 核心逻辑层（原样迁移为 ES module，算法零改动）
│   ├── crypto.js         # AES-256-GCM 加密
│   ├── database.js       # IndexedDB 存储
│   ├── file-sync.js      # 数据目录绑定与文件同步
│   ├── generator.js      # 密码生成器
│   ├── utils.js          # 工具函数 + SvgIcons
│   ├── tauri-bridge.js   # Tauri 桥接
│   └── shortcuts.js      # 快捷键定义
├── components/           # UI 组件（SFC）
│   ├── layout/           # AppShell / Sidebar / Header / DetailPanel
│   ├── auth/             # CreateVault / UnlockVault
│   ├── entries/          # EntryList / EntryCard / EntryEditor
│   ├── modals/           # ImportModal / ExportModal / SettingsModal / QRImportModal / ChangePasswordModal
│   └── common/           # Modal / Button / Field / PasswordInput / ConfirmDialog
├── composables/          # useVault / useEntries / useFilters / useShortcuts / useSync
├── styles/               # 保留现有设计令牌（CSS 变量），按组件拆分
└── assets/
```

迁移目标目录为 `src/` 内重组：原 `src/js/` 拆为 `core/`（纯逻辑）与组件层；原 `src/css/main.css` 拆入 `styles/`；`sw.js`、`manifest.json`、`assets/` 保留。

## 3. 状态与数据流

- 现有 `App.state` 迁移为 composables 管理的响应式状态：`useVault`（锁定/解锁/主密码会话）、`useEntries`（条目/回收站/筛选）、`useFilters`（当前筛选/搜索）、`useSync`（文件同步）
- 核心逻辑层不依赖 Vue：`core/` 模块保持纯函数/纯类，组件仅通过 composables 调用
- IndexedDB 数据结构完全不变，旧数据无缝可用，无需迁移脚本

## 4. 功能迁移清单（等量对齐，逐项验收）

| 功能域 | 现状模块 | 迁移方式 |
|--------|---------|---------|
| 创建/解锁/修改主密码 + 强度指示 | template/ui/main | Vue 组件 |
| 条目 CRUD、收藏、回收站、类型/标签筛选 | entries/ui | Vue 组件 + useEntries |
| 全局搜索 + 27 项快捷键 | shortcuts/ui | composables 保留原逻辑 |
| 二维码添加（上传/粘贴/拖拽/扫码） | qr-sync | Vue 组件，逻辑复用 |
| CSV/vault 导入导出 | import-export | Vue 组件，逻辑复用 |
| 设置（锁定超时/剪贴板清除/快捷键表） | settings | Vue 组件 |
| 数据目录绑定 + 文件同步 | file-sync | core 原样迁移 |
| 关联密码（同 IP/域名/账号） | related | core 迁移 |
| 工作区粒子背景 | particles | 独立组件包装 canvas |
| PWA（manifest/sw.js） | 保留 | 标准产物启用，双击模式天然失效 |
| Tauri 桥接 | tauri-bridge | core 迁移，frontendDist 不变 |
| 响应式（≤1024 抽屉模式、移动端） | css/layout | 组件 + 样式保留 |

## 5. 构建与部署

- 双产物：
  - `vite build`（默认）→ `dist/`：Tauri frontendDist 与 GitHub Pages 使用（保留 SW/PWA）
  - `vite build --mode single` → `dist-single/`：vite-plugin-singlefile 产出单文件 index.html，浏览器双击即用
- `scripts/serve.mjs` 废弃，dev 命令改为 `vite dev`
- Tauri `beforeBuildCommand` 改为 `vite build`；`copy-frontend.mjs` 退役
- `bump-version.mjs` / `check-version.mjs` 适配新版本号位置：APP_VERSION 收敛至单一来源 `src/core/version.js`；sw.js CACHE_NAME 随目录变化同步；移除对已退役路径的检查

## 6. 风险控制与验收

- 数据安全：加密与存储层零改动，IndexedDB 结构不变，旧保险箱直接可用
- 验收标准：迁移完成后按第 4 节清单逐项人工回归，与 v1.0.0 行为对齐（视觉、交互、快捷键）
- 分批落地：每完成一个功能域先在浏览器验证，再继续下一个
- 回退保障：独立分支 refactor/vue，原 dev 分支保持可用

## 实施顺序（概要）

1. 搭 Vite + Vue 骨架（main.js、App.vue、双产物构建配置）
2. core 逻辑层模块化迁移（crypto/database/file-sync/generator/utils/tauri-bridge 等）
3. 认证流程组件（创建/解锁）
4. 主界面布局（sidebar/content/header）
5. 条目列表/详情/编辑
6. 模态框族（导入导出/设置/二维码/改密）
7. 快捷键、粒子、PWA、Tauri 桥接收尾
8. 双产物验证 + 功能回归
