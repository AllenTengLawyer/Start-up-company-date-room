# /plan：美国公司（US）数据室分类模板

## 目标
- 公司文件柜的分类树按 `US-Company-Data-Room/` 文档结构生成（12 个一级目录 + 对应二级目录）
- 新建项目选择 `company_type = us` 时自动种子化为 US 分类
- 对已存在项目提供“应用 US 模板”的迁移路径（尽量自动按文件路径回填分类）

## 约束
- 不引入新前端框架/依赖
- 不改变现有“未分类”机制（`files.category_id IS NULL`）
- 兼容现有导出/扫描/拖拽分类逻辑

## 分类来源
- 一级目录：`US-Company-Data-Room/README.md`（01–12）
- 二级目录：`US-Company-Data-Room/FOLDER-DESCRIPTIONS.md`

## 交付物
1. `backend/templates/us_categories.json`：US 分类树模板（name + children）
2. `seed.py`：按项目 `company_type` 选择分类模板（cn/us）
3.（可选）迁移接口：将“现有项目”切换为 US 分类并按路径自动回填 `files.category_id`
4.（可选）前端入口：在项目/文件柜页提供“应用美国公司分类模板”按钮（带二次确认）

## 实施步骤
### Step 1：生成 US 分类模板
- 创建 `backend/templates/us_categories.json`
- 结构：
  - 一级：`01-Corporate-Formation` … `12-Real-Estate-Assets`
  - 二级：按 `FOLDER-DESCRIPTIONS.md` 中每个一级下的子目录（例如 `01-Certificate-of-Incorporation`、`02-Bylaws` 等）
- 规则：
  - `name` 使用目录名（含数字前缀与连字符），确保与真实文件夹名一致，便于“按路径自动回填”
  - `sort_order` 由数组顺序决定

### Step 2：种子逻辑按 company_type 分流
- 修改 `backend/seed.py::_seed_categories`：
  - 查询 `projects.company_type`（默认 cn）
  - `cn` → `cn_categories.json`
  - `us` → `us_categories.json`
- 保持 `seed_project()` 现有调用链（`projects.py` / `ensure-seeded`）不变或最小变更

### Step 3（推荐）：给已存在项目提供迁移能力
新增后端接口（建议）：
- `POST /projects/{project_id}/apply-category-template`
  - 参数：`template=us|cn`，`reclassify_by_path=true|false`，`reset_existing=true|false`
  - 行为（建议默认：reset_existing=true，reclassify_by_path=true）：
    1) 将该项目下 `categories` 删除（或软重建）；将 `files.category_id` 置空（避免指向旧分类）
    2) 按模板重新插入 categories
    3) 若 `reclassify_by_path=true`：
       - 解析 `files.file_path` 的路径片段（优先 `/`，兼容 `\\`）
       - 先匹配一级目录名，再匹配二级目录名，将文件自动回填到最深可匹配的分类
       - 对无法匹配的文件保持未分类
    4) 调用 `create_category_folders` 生成磁盘目录（可选开关，默认开启）
  - 返回：迁移统计（新建分类数、回填文件数、仍未分类数）

### Step 4（可选）：前端入口
- 在“文件柜”页的分类面板区域增加一个小按钮/菜单项：
  - 文案：`应用美国公司分类模板`
  - 交互：二次确认（会重置分类；可选提示“将尝试按文件路径自动回填分类”）
- 调用 Step 3 的接口并展示结果摘要

## 验收标准（可测）
1. 新建项目选择 `Company Type = US` 后：
   - 分类树与 `US-Company-Data-Room` 完全一致（一级 12 个；二级与文档匹配）
   - 左侧分类目录展开/折叠/计数正常
2. 迁移接口执行后：
   - 已有文件若路径位于 `01-.../02-.../file.ext`，能自动回填到对应二级分类
   - 不能匹配的文件保持未分类，不报错
3. 不影响现有功能：
   - 扫描、注册、拖拽分类、分类计数、导出尽调包/分类 zip 均可正常工作

## 风险与回滚
- 风险：对“已存在项目”重置分类会导致分类 ID 变化
- 回滚策略：
  - 迁移接口支持 `reset_existing=false`（只新增，不删除）
  - 或提供“导出项目 JSON 备份 → 迁移 → 如失败再导入备份”的流程
