# Release Notes — v2.1.0

## Highlights
- US 公司数据室分类模板：新增 US 分类树模板，支持新建项目按 company_type 自动初始化
- 分类迁移：支持一键应用模板并按文件路径自动回填分类
- 报告导出：HTML/Word 报告支持中英文（跟随应用语言）；文件与备注分列；Word 不再导出背景图
- 尽调包导出：修复中文文件名导致的下载失败（Content-Disposition 编码问题）

## Changes
### Data Room / Categories
- Add `backend/templates/us_categories.json` for US data room structure
- Seed categories based on `projects.company_type` (cn/us)
- Add `POST /api/projects/{project_id}/apply-category-template`:
  - Reset categories (optional)
  - Recreate categories from template
  - Reclassify files by path (optional)
  - Create folders on disk (optional)
- Add “Apply US template” entry in cabinet category panel for US projects

### Export
- HTML report:
  - Add `lang` support via query (`?lang=zh|en`)
  - Split “provided files / notes” into two columns (file name vs notes)
  - Keep item statement shown as a separate note area
- Word report:
  - Add `lang` support via query (`?lang=zh|en`)
  - Follow HTML layout (table columns aligned)
  - Remove background/illustration image export
  - Improve CJK font handling to avoid garbled text
- LDD zip export:
  - Fix non-ASCII filename in `Content-Disposition` headers (RFC 5987)

## Notes
- GitHub Release UI is recommended to publish release notes (this repository does not bundle an installer artifact by default).
