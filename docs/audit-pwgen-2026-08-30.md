# 密码生成器 UI/UX 专项评审（2026-08-30）

> 范围：`PasswordGeneratorModal.vue`（257 行）+ `generator.js` 引擎（183 行）+ `generator.css`（422 行）+ 编辑器/工具栏/右键集成点 + i18n 键
> 方法：静态代码审计（design-review 路由 / WCAG 2.2 AA 基线 / anti-ai-slop 清单）；未做真机像素走查

## 总评

**综合 8/10（良好，可发布水平）**。视觉与交互是长项，可达性是唯一明显短板。

| 维度 | 评分 | 一句话 |
|------|------|--------|
| 视觉美观 | 8.5/10 | 全令牌化、层级清晰、微动效克制有意义 |
| 交互易用 | 8/10 | 状态覆盖完整、语境切换正确；反馈有一处错位 |
| 可达性 | 6/10 | 全局 outline:none 后本组件零焦点样式（P2） |
| 一致性/i18n | 9/10 | zh/en 23 键齐全；复用 editor.strength 键 |

## 做得好的（保持）

1. **引擎密码学质量**：`randInt` 拒绝采样消除模偏差 + Fisher-Yates + minEachSet 逐组预置后洗牌 + maxRepeat 整体重试（24 次上限）——工具可信度的核心，实现正确
2. **命中区体系**：chip 44px、滑杆 thumb 22px 视觉 + 40px 命中、mini-btn 34px + 伪元素外扩 4px、移动端统一加大（48px chips / 40-44px 按钮）
3. **状态覆盖**：全字符集关闭 → 预览空态提示 + 引擎层回退双保险；footer 主按钮随语境切换（无目标=复制 / 有目标=填入）；复制反馈 1.6s 自动复位
4. **i18n 完备**：组件 22 键 + 引擎 5 键在 zh/en 全部命中（23 键定义，零缺失）
5. **深浅主题**：颜色/圆角/动效/字体全走设计令牌（含 N7 修复的强度色令牌化）
6. **reduced-motion 全局守护**覆盖逐字浮现/hover 微动效
7. **隐私设计**：会话历史仅内存、不落盘、去重、上限 5 条
8. **弱密码双反馈**：熵 <40 时强度条红色 + 预览文字同时变红
9. **方案 C 架构**：独立弹窗可叠加在编辑器之上，`pwGenFillNonce` 事件驱动回填、零耦合
10. **滑杆渐变填充**实时反映当前值（JS 计算 linear-gradient）

## 问题清单

### P2（应修，影响键盘/读屏用户与反馈正确性）

| # | 问题 | 位置 | 依据/影响 | 建议 |
|---|------|------|-----------|------|
| P2-A | **键盘焦点不可见**：`base.css:168-169` 全局 `outline:none`，而 generator.css 零 `:focus/:focus-within` 规则——chips（checkbox opacity:0 可聚焦）、高级折叠头（tabindex=0）、mini-btn、历史项、滑杆全部无焦点指示 | generator.css 全文 | WCAG 2.4.7 Focus Visible 失败；纯键盘用户无法定位焦点 | 为 `.chip:focus-within`、`.pwgen-adv-head:focus-visible`、`.mini-btn:focus-visible`、`.pwgen-history-item:focus-visible`、`.pwgen-range:focus-visible` 补 `box-shadow: 0 0 0 2px var(--accent-dim)` 焦点环（与 btn-icon 既有样式一致） |
| P2-B | **历史复制反馈错位**：点击历史第 N 条复制，反馈（绿框+「已复制」tip）出现在预览区——但预览区显示的是另一个密码，用户可能误以为复制的是当前预览 | PasswordGeneratorModal.vue `copyPw`/`.pwgen-preview.is-copied` | 反馈与动作对象不对应，违反映射一致性 | 历史项复制时给该项局部反馈（dot 变绿/背景闪烁）；或历史点击先 `preview=h` 再复制，使预览区反馈成立 |
| P2-C | **折叠头语义不完整**：`pwgen-adv-head` 有 `role=button tabindex=0 + keydown.enter`，但缺 Space 键触发与 `aria-expanded` 状态 | PasswordGeneratorModal.vue L188 | WCAG 2.1.1 / 4.1.2；读屏用户不知道展开状态，Space 不响应违背 button 惯例 | 加 `:aria-expanded="advOpen"` + `@keydown.space.prevent` |

### P3（建议，体验打磨）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| P3-D | 预览区 `user-select:none` 与 click-to-copy 互斥——无法手动选中部分密码（如取前 8 位做 PIN） | generator.css L35 | 产品权衡：1Password 允许选择。可改为仅点击整行复制、长按/双击进入选择，或维持现状（有完整复制兜底） |
| P3-E | 空态提示用 `--warning` 黄色，语义过重（是操作引导不是警告） | generator.css `.pwgen-empty` | 改 `--text-muted` |
| P3-F | 历史区无清空入口（投屏/演示场景想立刻清掉做不到） | PasswordGeneratorModal.vue 历史区 | 标题行右侧加「清空」文字按钮 |
| P3-G | `ModalBase aria-label="pwgen"` 非人类可读名称 | PasswordGeneratorModal.vue L136 | 改 `:aria-label="t('pwgen.title')"` |
| P3-H | 强度条无 `role=progressbar` / `aria-valuenow` | PasswordGeneratorModal.vue 强度条 | 加语义属性 |
| P3-I | pwgen 与编辑器弹窗同 z（200），叠加顺序靠 DOM 挂载顺序（ModalHost L46 在后）胜出——可用但脆弱 | ModalHost.vue / modal.css | pwgen 弹窗显式 +1 层或加注释固化 |
| P3-J | `✓`/`▾` 文本符号与全站 SVG 图标体系不一致 | chip 勾选框/折叠箭头 | 换 `Icons.check`/旋转 chevron SVG（与 anti-ai-slop「emoji 作 UI」条款同源的体系一致性要求，当前为 Unicode 符号非 emoji，轻度） |

## 修复路线建议

一个批次（v1.1.4）可完成全部 P2 + P3-E/F/G/H（约 6 个文件触点，改动小）：焦点环 CSS 一段 + 历史反馈逻辑 5 行 + aria 属性 4 处 + 颜色令牌 1 处。P3-D/I/J 可单独决策。

## 验证状态

- 静态审计：全部发现带文件:行号证据
- 未验证：真机（Tauri dev）像素级走查、读屏器实测——建议修复后跑一轮 `npm run tauri:dev` 键盘走查（Tab 顺序 + Space 折叠 + 滑杆方向键）
