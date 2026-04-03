# 插画风格指南（Founder Day 1）

## 目标
- 现代、克制、有艺术气息；不抢内容注意力
- 更适合“创始人/尽调/文件治理”的语义（文档、路径、秩序、复盘）

## 颜色与对比
- 强调色（红）：#C0392B，仅用于小面积线条/点睛，透明度建议 0.18–0.35
- 辅助色（蓝）：#2B6CB0，用于辅助元素或“清晰/秩序”的暗示，透明度建议 0.12–0.18
- 中性色：#1A1A18（低透明度）与 #CCC8C0（边框/分割）
- 背景与底色：沿用现有 UI 的 --bg-base/--bg-surface 系列

对比度策略：
- 插画整体透明度建议 0.10–0.28 区间，确保不会影响主内容阅读
- 不在正文区域叠加高对比深色块

## 线条与形状
- 线宽：2–4px 为主（大屏可 3–4px，小屏 2–3px）
- 圆角：22–38px（与现有 UI radius 统一）
- 形状：文档/卡片/圆形/虚线轨迹（表达“流程”）

## 动效（可选）
- 动效必须克制：位移 ≤ 6px，周期 10–18s，ease-in-out
- 必须支持 `prefers-reduced-motion: reduce`（禁用动画）

## 使用规范
- 只在空白区域出现（如内容右侧或页面底部），避免遮挡表格/表单
- `pointer-events: none`，`aria-hidden="true"`
- 小屏（≤ 1100px）默认隐藏

## 文件结构（建议）
- 源文件：`frontend/illustrations/founder-day1.svg`
- 线稿版源文件：`frontend/illustrations/founder-day1-line.svg`
- 若需要导出 PNG：按 1x/2x/3x（例如宽 640/1280/1920）导出到同目录并命名：
  - `founder-day1@1x.png`
  - `founder-day1@2x.png`
  - `founder-day1@3x.png`
