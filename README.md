# 创业助手 · 公司文件整理系统

> Startup Assistant — Company Document Cabinet & Due Diligence Readiness Tool

本地优先的创业企业文件管理系统，帮助创始人整理公司文件、追踪版本历史，并为融资尽调（LDD）做好准备。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-green.svg)
![Vue](https://img.shields.io/badge/vue-3.x-4FC08D.svg)

---

## 功能特性

### 核心模块

| 模块 | 功能描述 |
|------|----------|
| **项目管理** | 支持"早期团队"和"成熟公司"两种模式，项目间快速切换 |
| **创始人档案** | 6 维度 25 项背景检查清单（股权、竞业、知识产权等） |
| **文件柜** | 多级分类树管理，支持批量扫描注册、自定义目录结构 |
| **LDD 尽调视图** | 13 章节 74 项检查点，自动评分，TODO 清单 |
| **文件-LDD 映射** | 将文件柜中的文件批量关联到 LDD 检查项 |

### 增强功能

| 功能 | 说明 |
|------|------|
| **文件去重检测** | 扫描时自动检测同名同大小文件，弹窗选择跳过或保留 |
| **全文搜索** | 支持 PDF、Word、TXT 内容搜索，FTS5 加速 |
| **版本历史** | 文件变更自动记录版本，支持一键回滚 |
| **批量操作** | 多选文件批量移动分类、重命名（日期/序号/自定义前缀）、删除 |
| **LDD 模板** | 内置天使轮/A轮/B轮尽调模板（为提高稳定性，已移除模板导入能力） |

### 导出功能

- **PDF 报告** — 带评分的尽调清单报告
- **HTML 报告** — 浏览器查看，支持打印
- **文件夹复制** — 按分类结构复制到指定目录
- **JSON 备份/恢复** — 完整项目数据备份（下载文件名已做兼容处理）
- **LDD 压缩包** — 按尽调章节整理文件
- **分类压缩包** — 导出某一分类及其子分类的全部文件

---

## 技术栈

- **后端**: Python 3.11+, FastAPI, SQLite
- **前端**: Vue 3 (CDN), Vue Router, Vue I18n
- **文本提取**: PyPDF2 (PDF), python-docx (Word)
- **全文搜索**: SQLite FTS5
- **导出**: WeasyPrint (PDF), Jinja2 (HTML模板)

---

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 启动应用

```bash
python app.py
```

访问 http://localhost:8000

如果 8000 端口被占用，可改用：

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8002
```

访问 http://127.0.0.1:8002

---

## 使用指南

### 1. 创建项目

点击"新建项目"，选择文件夹作为文档根目录：
- **早期团队模式** — 侧重创始人背景检查
- **成熟公司模式** — 完整的文件柜 + LDD 尽调功能

系统会自动创建分类文件夹结构。

### 2. 注册文件

进入文件柜，点击"扫描目录"或"批量注册"：
- 系统自动识别文件名关键词推荐分类
- 检测重复文件（同名同大小）并提示
- 支持一键注册所有建议分类的文件

### 3. 管理文件

**分类操作**:
- 点击左侧分类树筛选文件
- 拖拽或选择文件批量移动分类
- 导出某一分类为压缩包

**批量操作**:
- 勾选多选框选择多个文件
- 批量重命名：支持日期前缀、序号前缀、自定义前后缀
- 批量删除

**版本历史**:
- 点击文件行的 📋 图标查看版本历史
- 支持回滚到任意历史版本

### 4. 全文搜索

点击顶部的"🔍 搜索"按钮：
- 输入关键词搜索 PDF、Word、TXT 文件内容
- 搜索结果高亮显示匹配片段
- 点击结果直接打开文件

### 5. 准备尽调

切换到 LDD 视图：
- 查看 TODO 清单（高风险待办项）
- 点击"+ 添加文件"将文件关联到检查项
  - 支持按分类批量导入（选择父分类自动导入子分类文件）
- 跟踪完成进度和评分

### 6. 使用 LDD 模板

在 LDD 视图点击"模板管理"：
- **内置模板**: 天使轮、A轮、B轮尽调清单
- **应用模板**: 将模板应用到当前项目（替换现有清单）
- **导入/导出**: JSON 格式自定义模板

### 7. 导出资料

- **导出尽调包** — 一键生成按章节组织的 ZIP
- **导出面板** — PDF 报告、HTML 报告、文件夹复制

注意：
- **PDF 导出**依赖 WeasyPrint 的系统组件。在部分 Windows 环境可能无法生成 PDF；此时可使用 **HTML 预览**，再用浏览器“打印”另存为 PDF。
- **文件夹导出**建议选择一个有写权限的目标目录（导出面板提供“选择...”按钮可直接选目录）。

---

## 项目结构

```
startup-assistant/
├── app.py                      # 应用入口
├── requirements.txt            # Python 依赖
├── README.md                   # 本文件
├── backups/                    # 数据库备份
│   └── dataroom-v1.0-mvp.db
├── backend/
│   ├── database.py             # SQLite 数据库 + 迁移
│   ├── main.py                 # FastAPI 主应用
│   ├── seed.py                 # 初始数据 + 默认模板
│   ├── routers/                # API 路由
│   │   ├── projects.py         # 项目 CRUD
│   │   ├── categories.py       # 分类管理
│   │   ├── files.py            # 文件管理 + 搜索 + 批量操作
│   │   ├── founders.py         # 创始人档案
│   │   ├── ldd.py              # 尽调清单
│   │   ├── export.py           # 导出功能
│   │   ├── versions.py         # 版本历史
│   │   └── templates.py        # LDD 模板管理
│   ├── services/               # 业务服务
│   │   ├── text_extractor.py   # PDF/Word 文本提取
│   │   └── version_tracker.py  # 版本追踪
│   └── templates/              # 导出模板
│       ├── cn_categories.json
│       ├── cn_ldd_checklist.json
│       └── report_template.html
├── frontend/
│   ├── index.html              # 主页面
│   ├── style.css               # 样式
│   ├── app.js                  # Vue 应用
│   ├── components/             # Vue 组件
│   │   ├── FileScanner.js      # 文件柜（含批量操作）
│   │   ├── DuplicateWarningModal.js   # 去重弹窗
│   │   ├── BatchRenameModal.js        # 批量重命名
│   │   ├── VersionHistoryModal.js     # 版本历史
│   │   ├── SearchPanel.js             # 全文搜索
│   │   ├── TemplateManager.js         # 模板管理
│   │   ├── LddView.js          # LDD 尽调视图
│   │   ├── FounderList.js      # 创始人列表
│   │   ├── FounderDetail.js    # 创始人详情
│   │   ├── ProjectInit.js      # 项目创建
│   │   ├── ExportPanel.js      # 导出面板
│   │   └── CategoryTree.js     # 分类树
│   └── i18n/                   # 国际化
│       ├── zh.json
│       └── en.json
└── data/
    └── dataroom.db             # SQLite 数据库
```

---

## 数据库架构

### 核心表

- **projects** — 项目信息
- **categories** — 文件分类（支持多级嵌套）
- **files** — 文件记录（含 size, hash, last_modified）
- **file_versions** — 文件版本历史
- **file_content** — 提取的文本内容（FTS5 索引）
- **ldd_templates** — LDD 模板
- **ldd_template_items** — 模板检查项
- **ldd_items** — 项目 LDD 检查项
- **ldd_mappings** — 文件-LDD 关联

---

## 更新日志

### v1.1.0 (2026-04-03)

- ✨ 新增文件去重检测
- ✨ 新增全文搜索（PDF/Word/TXT）
- ✨ 新增版本历史与回滚
- ✨ 新增批量操作（移动、重命名、删除）
- ✨ 新增 LDD 模板管理（天使轮/A轮/B轮）
 - ✨ 文件柜：右侧详情抽屉、扫描/已注册分页、搜索可退出（返回/ESC）
 - 🐛 修复导出：HTML 报告可用、JSON 备份文件名兼容、PDF 失败自动引导使用 HTML 打印

### v1.0.0 (2025-04-02)

- 🎉 MVP 版本发布
- 项目创建与管理
- 文件柜分类管理
- LDD 尽调清单
- 多种导出格式

---

## 数据安全

- ✅ 所有数据存储在本地 SQLite 数据库
- ✅ 文件只存储路径，不读取内容（除非启用全文搜索）
- ✅ 可导出 JSON 备份，随时迁移
- ✅ 版本历史防止误操作丢失数据

---

## 开发计划

- [x] 基础文件柜功能
- [x] 多级分类管理
- [x] LDD 尽调清单
- [x] 文件-LDD 映射
- [x] 多种导出格式
- [x] 文件去重检测
- [x] 全文搜索
- [x] 版本历史
- [x] 批量操作
- [x] LDD 模板
- [ ] UI 重设计
- [ ] 文件内容 OCR 识别
- [ ] AI 辅助文件分类

---

## 贡献

欢迎提交 Issue 和 PR！

---

## License

MIT License

---

## 作者

Allen Teng — 律师 / 开发者

**GitHub**: [AllenTengLawyer](https://github.com/AllenTengLawyer)
