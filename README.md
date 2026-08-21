# LockPass — 个人密码工作台

一款纯前端离线密码管理器，无需后端服务器，双击 `index.html` 即可在浏览器中使用。

---

## 功能清单

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 主密码验证 | [x] | 首次设置主密码，后续解锁需输入 |
| AES-256-GCM 加密 | [x] | Web Crypto API + PBKDF2（100000次迭代） |
| 密码增删改查 | [x] | 完整 CRUD 操作 |
| 分类管理 | [x] | 预设7个分类 + 自定义分类 |
| 标签系统 | [x] | 用逗号分隔的标签 |
| 收藏功能 | [x] | 一键收藏常用密码 |
| 全文搜索 | [x] | 按标题/用户名/URL/标签搜索 |
| 密码生成器 | [x] | 8-64位，可选字符集，实时强度计算 |
| 密码显示/隐藏 | [x] | 点击切换，默认掩码 |
| 一键复制 | [x] | 复制后自动清除剪贴板 |
| 导入/导出 | [x] | 加密 .vault 格式 + CSV 明文格式 |
| 自动锁定 | [x] | 无操作超时自动锁定 |
| 键盘快捷键 | [x] | ⌘ + K / ⌥ + N / ⌥ + L / ⌘ + , |
| IndexedDB 存储 | [x] | 浏览器本地持久化 |

---

## 快速开始

### 1. 打开应用

```bash
# 方式1：双击文件
双击 index.html

# 方式2：命令行打开
open index.html

# 方式3：拖拽到浏览器
将 index.html 拖拽到浏览器窗口
```

### 2. 创建密码库

首次打开会显示「创建密码保险箱」界面：

1. 输入主密码（8位以上，建议包含大小写字母、数字、符号）
2. 再次确认密码
3. 点击「确认创建」

> **注意：** 主密码是唯一解锁方式，忘记后将无法恢复数据！

### 3. 添加密码

- 点击左下角「添加密码」按钮
- 填写标题（必填）、用户名、密码（必填）、网址、分类、标签、备注
- 可使用密码生成器生成强密码
- 点击「保存」

### 4. 使用密码

- **查看详情**：点击密码条目
- **复制密码**：点击复制按钮，或打开详情面板后点击复制
- **显示/隐藏**：点击眼睛图标切换显示
- **编辑/删除**：在详情面板操作

---

## 安全机制

### 加密算法

```
主密码 → PBKDF2(SHA-256, 100000次迭代) → AES-256-GCM 密钥
数据   → AES-256-GCM 加密               → 密文存储到 IndexedDB
```

### 数据存储

| 数据 | 存储位置 | 加密状态 |
|------|----------|:--------:|
| 密码条目 | IndexedDB | 已加密 |
| 主密码 | 不存储 | — |
| 盐值 (Salt) | IndexedDB | 明文 |
| 分类列表 | IndexedDB | 加密（随密码一起） |

### 安全特性

| 特性 | 说明 |
|------|------|
| 零网络请求 | 所有数据在本地处理，无任何网络通信 |
| 自动锁定 | 无操作超时（可配置 1/5/15/30 分钟）后自动锁定 |
| 剪贴板清除 | 复制密码后自动清除剪贴板（可配置 10/30/60 秒） |
| 内存清理 | 锁定时清除内存中的明文数据 |

---

## 导入导出

### 导出

点击右上角「导出」按钮，选择格式：

| 格式 | 说明 | 安全性 |
|------|------|:------:|
| `.vault` | 加密备份文件 | 安全 |
| `.csv` | 明文表格文件 | 需妥善保管 |

**推荐使用 `.vault` 格式作为定期备份。**

### 导入

点击右上角「导入」按钮：

- 支持 `.vault` 加密文件（需要原主密码解密）
- 支持 `.csv` 明文文件
- 导入时会自动去重（按标题+用户名匹配）

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 聚焦搜索框 |
| `Ctrl/Cmd + N` | 新建密码条目 |
| `Ctrl/Cmd + L` | 锁定密码库 |
| `Ctrl/Cmd + ,` | 打开设置 |
| `Escape` | 关闭模态框/面板 |

---

## 技术架构

### 技术栈

- **前端框架**：纯 Vanilla JavaScript（无框架依赖）
- **存储**：IndexedDB（浏览器原生）
- **加密**：Web Crypto API（浏览器原生）
- **UI**：CSS Variables + Flexbox/Grid
- **字体**：system-ui 系统字体栈（零外部依赖，纯离线）

### 为什么选择 IndexedDB 而非 sql.js？

| 维度 | IndexedDB | sql.js (SQLite WASM) |
|------|-----------|---------------------|
| 数据容量 | 数百 MB ~ GB | 需加载整个 DB 到内存 |
| 持久化 | 浏览器自动管理 | 需手动导入/导出 |
| 初始化开销 | 零依赖 | 需加载 ~1MB WASM |
| 查询能力 | 索引查询足够 | 完整 SQL |

**结论**：密码管理器数据量有限（几十到几千条），IndexedDB 已足够，且零依赖、自动持久化。

---

## 项目结构

```
LockPass/
├── index.html           # 主 HTML 文件（轻量化，仅结构）
├── css/
│   └── main.css         # 主样式文件（734 行）
├── js/
│   ├── crypto.js        # 加密工具模块（AES-256-GCM）
│   ├── database.js      # IndexedDB 存储模块
│   ├── generator.js     # 密码生成器模块
│   ├── utils.js         # 工具函数模块
│   ├── app.js           # 主应用逻辑模块
│   ├── ui.js            # UI 渲染模块
│   ├── entries.js       # 条目管理模块
│   ├── editor.js        # 条目编辑模块
│   ├── import-export.js # 导入导出模块
│   ├── settings.js      # 设置模块
│   ├── shortcuts.js     # 快捷键模块
│   └── main.js          # 主初始化模块
├── assets/
│   └── icons/
│       └── favicon.svg  # 网站图标
├── SPEC.md              # 产品规格文档
└── README.md            # 使用说明（本文件）
```

**模块化优势**：
- 每个功能模块独立文件，便于维护和升级
- 所有脚本本地化，完全离线可用
- 清晰的依赖关系，便于调试和扩展

---

## CI 与在线版

### 发布自动打包（GitHub Actions）

推 `v*` 标签（如 `v1.0.2`）或手动触发，自动构建并发布：

| 平台 | 产物 |
|------|------|
| Windows | NSIS 安装包 (.exe) + MSI (.msi) |
| macOS | .app 压缩包 (.zip) + .dmg |

产物先上传 Actions Artifact，再汇总到 **Draft Release**，人工确认后发布。
Windows 安装包会有 SmartScreen 提示，点击"更多信息 → 仍要运行"即可。

#### macOS 安装说明（首次打开）

macOS 产物为 ad-hoc 签名（未配置 Apple Developer 证书），分发到其他 Mac 首次打开时，
系统会拦截并提示"已损坏，无法打开"。这是正常的 Gatekeeper 安全机制，解除方法如下：

**下载 dmg 后（以 .dmg 为例）：**

1. 双击挂载 dmg，拖动 LockPass.app 到 Applications 文件夹
2. **打开 Finder → 应用程序**，找到 LockPass.app
3. **首次运行**：不要直接双击，改用以下任一方式打开：

   **方式一（推荐）：右键打开**
   - 按住 `Control` 键，同时单击 LockPass.app
   - 在弹出菜单中选择"打开"
   - 弹出提示框，点"打开"

   **方式二（终端命令）：**
   ```bash
   # 解除隔离属性（只需执行一次）
   xattr -rd com.apple.quarantine /Applications/LockPass.app

   # 然后正常双击打开
   open /Applications/LockPass.app
   ```

   **方式三（适用于 .zip 方式）：**
   ```bash
   # 解压后，同样解除隔离
   xattr -rd com.apple.quarantine ~/Downloads/LockPass-macos-aarch64/LockPass.app

   # 打开
   open ~/Downloads/LockPass-macos-aarch64/LockPass.app
   ```

> **注意**：每次下载新版本安装时，都需要重新执行上述解除隔离步骤。
> 如果不需要桌面版，也可以直接使用[在线版](https://trexwb.github.io/lockPass/)，无需安装。

### 在线版（GitHub Pages）

`main` 分支推送后自动将浏览器版部署到 **GitHub Pages**：

- 访问地址：`https://trexwb.github.io/lockPass/`
- 首次需在仓库 Settings → Pages → Source 选择 **GitHub Actions**
- 在线版数据存在访问者浏览器（IndexedDB），与桌面版相互独立，可用 .vault 文件导入导出互通

---

## 安全注意事项

### 浏览器环境风险

| 风险 | 说明 | 防范措施 |
|------|------|----------|
| XSS 攻击 | 恶意脚本窃取内存中的明文密码 | 仅在受信任环境使用，避免安装可疑浏览器扩展 |
| 浏览器漏洞 | 浏览器被入侵可能读取内存 | 保持浏览器更新，使用主流浏览器 |
| 本地文件泄露 | 电脑被盗/被入侵 | 设置电脑登录密码，启用磁盘加密（FileVault/BitLocker） |
| 主密码遗忘 | 无法恢复数据 | 牢记主密码，或将主密码存储在安全的地方 |

### 最佳实践

1. 使用强主密码（12位以上，含大小写字母、数字、符号）
2. 定期导出 `.vault` 加密备份，存储在安全位置
3. 设置合理的自动锁定时间（建议 5 分钟）
4. 不要在公共场所的电脑上使用
5. 启用电脑磁盘加密（FileVault / BitLocker）
6. 不要将 `.csv` 明文导出文件长期保存在电脑上
7. 不要将主密码写在纸上贴在显示器旁边

---

## 数据迁移

### 从其他密码管理器迁移

大多数密码管理器支持导出 CSV 文件：

1. 从原密码管理器导出 CSV
2. 在 LockPass 中点击「导入」
3. 选择 CSV 文件
4. 确认导入

**支持的 CSV 列名**：`title`, `username`, `password`, `url`, `category`, `notes`

---

## 浏览器兼容性

| 浏览器 | 版本要求 |
|--------|----------|
| Chrome | 60+ |
| Firefox | 60+ |
| Safari | 12+ |
| Edge | 79+ |

---

## 更新日志

### v1.0.4 (2026-08-21)

- 全量代码审计修复（17 项）：
  - CSV 预览崩溃（`rows` 未定义）修复；CSV 解析支持 RFC 4180 引号字段内换行
  - 移除主密码可逆混淆存储（sessionStorage），改为仅内存保存，刷新后需重新解锁
  - 密码生成器字段名对齐（digits/special → numbers/symbols）；消除随机数模运算偏差（拒绝采样）
  - 修复列表排序就地污染数据源（改为副本排序）
  - 收窄 Tauri `fs` 权限（移除 `path: "**"`），新增 `export_text_file` / `read_text_file_any` Rust 命令并接入前端
  - 落地 CSP（index.html meta + tauri.conf.json）
  - 消除多类型表单重复 DOM ID（改用 `data-field` 属性）
  - 文件同步失败不再静默（设置面板展示失败状态 + Toast 提示）
  - 侧栏统计合并为单次遍历；清理占位符/死代码/冗余赋值；deriveKey 支持读取 meta iterations
  - 确认框快捷键独立映射（Enter 直接点击确认）
  - CSS 按注释分区拆分为 base/layout/entries/editor/settings/modal/particles 七个子文件（main.css 保留 @import 入口）
- 修复手机端「两次密码不一致」误报（本次修复不升版本号，并入 v1.0.4）：
  - 创建保险箱两个密码输入框移除 `name` 属性并增加 `autocapitalize="off"` / `autocorrect="off"` / `spellcheck="false"`，降低移动端浏览器/密码管理器将页面识别为密码表单并自动填充的概率
  - 创建场景初始化后 250ms 再清空一次输入框（仅当两框均未聚焦时），对抗移动端异步自动填充晚于同步清空的问题
  - 校验不一致时清空确认框并聚焦，提示「两次密码不一致，请重新输入确认密码」，引导手动重输消除自动填充干扰

### v1.0.3 (2026-08-21)

- 修复 Tauri 桌面版导出失败（dialog save 命令参数结构错误 `invalid args options`）：
  - `js/tauri-bridge.js` 中 `plugin:dialog|save` 调用将 `defaultPath`/`filters` 包进 `options` 对象，符合 Tauri v2 `tauri-plugin-dialog` 命令签名
  - 导出 `.vault` 加密备份与 `.csv` 明文备份恢复正常
- 修复 Tauri 桌面版链接点击无效（webview 中 `target=_blank` 不调起系统浏览器）：
  - `src-tauri/src/lib.rs` 新增 `open_url` 命令：协议白名单校验（仅 `http://` / `https://` / `mailto:`），按平台用 `open` / `cmd /C start` / `xdg-open` 调起系统浏览器
  - `js/tauri-bridge.js` 新增全局点击委托：拦截 `a[target="_blank"]` 链接，`preventDefault` 后调用 `open_url` 用系统浏览器打开
  - 网址链接与备注 markdown 解析链接点击恢复正常
- 侧边栏 UI 优化：
  - 「热门标签」标题可点击折叠/展开（chevron 指示器，localStorage 持久化折叠状态，默认展开）
  - 「退出」按钮始终固底：侧边栏内容移入 `.sidebar-scroll` 滚动容器，footer 不随内容滚动

### v1.0.2 (2026-08-20)

- 新增 GitHub Actions CI：
  - `.github/workflows/release.yml`：推 v* 标签自动构建 Windows（NSIS+MSI）与 macOS（.app+.dmg）安装包，上传至 Draft Release
  - `.github/workflows/pages.yml`：main 分支推送自动部署浏览器版到 GitHub Pages（在线版 [https://trexwb.github.io/lockPass/](https://trexwb.github.io/lockPass/)）

### v1.0.1 (2026-08-20)

- Tauri 桌面版新增本地文件存储 API（file_store_write/read/exists/delete/data_dir）：
  - 数据落盘到系统应用数据目录（macOS: ~/Library/Application Support/com.lockpass），meta 与 vault 分别存为 meta.json / vault.json
  - 前端新增 js/file-store.js：Tauri 环境下自动用文件版 DBUtils 替代 IndexedDB（接口完全一致，业务代码零改动），浏览器环境自动降级回 IndexedDB
  - 设置面板「本地文件同步」区在桌面版显示数据目录路径；Rust 命令含路径穿越防护

### v1.0.0 (2026-08-20)

- 更换应用图标：深海军蓝渐变底 + 青色 3D 金属保险箱 + 银白转盘（macOS/Windows 桌面图标与浏览器 favicon 同步更新）

### v1.0.0 (开发中)

- **6 种条目类型**：支持网站、服务器、数据库、AI、应用、其他凭证
  - 服务器：连接地址 + 端口 + 登录账号/密码 + root 账号/密码
  - 数据库：数据库地址 + 端口 + 用户名 + 密码（无 root 层级）
  - AI：服务名称 + API 地址 + Token
  - 应用：应用名称 + App ID + 公钥 + 私钥（多行 textarea）
  - 其他：凭证名称 + 凭证值
- **5 种条目类型**：支持网站、服务器、AI、应用、其他凭证
  - 服务器：连接地址 + 登录账号/密码 + root 账号/密码
  - AI：服务名称 + API 地址 + Token
  - 应用：应用名称 + App ID + 公钥 + 私钥（多行 textarea）
  - 其他：凭证名称 + 凭证值
- 公钥/私钥字段支持多行内容（含 PEM 证书格式）
- 详情面板按类型语义化渲染
- 卡片显示类型图标与语义化副标题
- CSV 导入/导出支持全部类型字段
- 二维码同步支持全部类型字段x
- 首次发布
- 完整的密码管理功能
- AES-256-GCM 加密
- IndexedDB 存储
- 导入导出功能
- 密码生成器
- 自动锁定
- 键盘快捷键

---

## License

MIT License - 自由使用、修改、分发。

---

## 常见问题

### Q: 忘记主密码怎么办？

**A: 无法恢复。** 主密码不存储在任何地方，是唯一解锁方式。如果忘记，只能销毁密码库重新开始。

### Q: 数据存储在哪里？

**A: 浏览器的 IndexedDB 数据库中。** 数据文件位于浏览器用户数据目录（Chrome: `~/Library/Application Support/Google/Chrome/Default/IndexedDB/`）。

### Q: 可以同步到其他设备吗？

**A: 手动同步。** 导出 `.vault` 文件，复制到其他设备，在浏览器中打开 `index.html` 后导入即可。

### Q: 可以在手机上使用吗？

**A: 理论上可以。** 在手机浏览器中打开 `index.html` 即可，但未针对移动端优化 UI。

### Q: 导出的 `.vault` 文件安全吗？

**A: 是的，已加密。** `.vault` 文件包含加密的密码数据，需要主密码才能解密。但请妥善保管主密码和 `.vault` 文件，不要同时泄露。

---

**保护好你的主密码，它守护着你所有的数字钥匙。**
