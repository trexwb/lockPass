# LockPass 文档中心

LockPass 项目文档按主题整理于此目录。**根目录的 `AGENTS.md`（Agent 开发规范）与 `README.md`（使用说明）为约定位置文件，保留在仓库根目录**：前者供 AI Agent 启动时自动加载，后者供 GitHub 仓库首页自动渲染。

## 文档索引

| 文档 | 定位 | 适用读者 |
|------|------|----------|
| [spec.md](./spec.md) | 产品规格：定位、技术选型、功能规格、数据结构、安全机制 | 产品 / 开发 |
| [tauri.md](./tauri.md) | Tauri v2 桌面封装：架构、构建命令、平台约束、发布说明 | 桌面端开发 / 打包 |
| [superpowers/specs/2026-08-23-vue3-migration-design.md](./superpowers/specs/2026-08-23-vue3-migration-design.md) | Vue 3 + Vite 迁移设计方案（superpowers 工作流产出） | 架构 / 开发 |
| [../extension/README.md](../extension/README.md) | 浏览器扩展使用指南：安装、填充流程、无痕模式、安全模型 | 扩展用户 / 开发 |
| [memory/](./memory/) | AI 工作记录（按日期 YYYY-MM-DD.md，自根目录 memory/ 迁入） | AI Agent |

## 根目录约定文件

| 文档 | 定位 | 说明 |
|------|------|------|
| [../AGENTS.md](../AGENTS.md) | Agent 开发规范（版本管理、开发规范、命名、测试清单） | 所有 AI Agent 开发时必须遵循；`npm run version:set` 同步版本号 |
| [../README.md](../README.md) | 使用说明（功能、快速开始、导入导出、CI 与在线版、FAQ） | GitHub 仓库首页展示；更新日志需人工维护 |

## 文档维护约定

- 版本号由 `npm run version:set <x.y.z>` 统一维护（真源为 `package.json` 与 `src-tauri/tauri.conf.json`），`docs/spec.md` 的版本字段由脚本同步。
- 新增技术文档默认放入本目录，并在上方索引表登记。
