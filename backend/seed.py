import json
import os

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")

def create_category_folders(db, project_id: int, root_path: str):
    """Create folders on disk mirroring the category tree under root_path."""
    rows = db.execute(
        "SELECT id, parent_id, name FROM categories WHERE project_id=?", (project_id,)
    ).fetchall()
    id_to_row = {r["id"]: r for r in rows}

    def get_path_parts(cat_id):
        parts = []
        cur = cat_id
        while cur is not None:
            row = id_to_row.get(cur)
            if row is None:
                break
            parts.append(row["name"])
            cur = row["parent_id"]
        return list(reversed(parts))

    for row in rows:
        parts = get_path_parts(row["id"])
        folder = os.path.join(root_path, *parts)
        try:
            os.makedirs(folder, exist_ok=True)
        except Exception:
            pass

def seed_project(db, project_id: int, root_path: str = None):
    """Seed categories and LDD items for a newly created established-mode project."""
    _seed_categories(db, project_id)
    _seed_ldd_items(db, project_id)
    if root_path:
        create_category_folders(db, project_id, root_path)

def _seed_categories(db, project_id: int):
    with open(os.path.join(TEMPLATES_DIR, "cn_categories.json"), encoding="utf-8") as f:
        cats = json.load(f)

    def insert(items, parent_id=None):
        for i, item in enumerate(items):
            cur = db.execute(
                "INSERT INTO categories (project_id, parent_id, name, sort_order) VALUES (?,?,?,?)",
                (project_id, parent_id, item["name"], i)
            )
            cid = cur.lastrowid
            if item.get("children"):
                insert(item["children"], cid)

    insert(cats)

def _seed_ldd_items(db, project_id: int):
    with open(os.path.join(TEMPLATES_DIR, "cn_ldd_checklist.json"), encoding="utf-8") as f:
        sections = json.load(f)

    order = 0
    for section in sections:
        for item in section["items"]:
            db.execute(
                """INSERT INTO ldd_items
                   (project_id, section_no, item_no, title, title_en, description,
                    item_type, risk_level, is_required, sort_order)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    project_id,
                    section["section_no"],
                    item["item_no"],
                    item["title"],
                    item.get("title_en", ""),
                    item.get("description", ""),
                    item.get("item_type", "file"),
                    item.get("risk_level", "medium"),
                    item.get("is_required", 1),
                    order,
                )
            )
            order += 1

def seed_default_templates(db):
    """Seed default LDD templates for different funding rounds."""
    import os

    # Check if already seeded
    count = db.execute("SELECT COUNT(*) as n FROM ldd_templates WHERE is_builtin = 1").fetchone()["n"]
    if count > 0:
        return

    # Load LDD checklist data
    with open(os.path.join(TEMPLATES_DIR, "cn_ldd_checklist.json"), encoding="utf-8") as f:
        sections = json.load(f)

    def build_items(sections_list):
        items = []
        order = 0
        for section in sections_list:
            for item in section["items"]:
                items.append({
                    "section_no": section["section_no"],
                    "item_no": item["item_no"],
                    "title": item["title"],
                    "title_en": item.get("title_en", ""),
                    "description": item.get("description", ""),
                    "item_type": item.get("item_type", "file"),
                    "risk_level": item.get("risk_level", "medium"),
                    "is_required": item.get("is_required", 1),
                    "sort_order": order
                })
                order += 1
        return items

    all_items = build_items(sections)

    # Angel Round: Focus on basic company docs, IP, founders
    angel_sections = {"1": True, "6": True, "8": True, "12": True}  # Company, IP, Employment, ESG
    angel_items = [i for i in all_items if i["section_no"][0] in angel_sections]

    # Series A: More comprehensive
    series_a_sections = {"1": True, "2": True, "4": True, "6": True, "7": True, "8": True, "12": True}
    series_a_items = [i for i in all_items if i["section_no"][0] in series_a_sections]

    # Series B: Full checklist
    series_b_items = all_items

    templates = [
        ("天使轮尽调清单", "angel", "早期项目基础尽调，重点关注公司架构、知识产权和团队", angel_items),
        ("A轮尽调清单", "series_a", "A轮融资标准尽调，增加业务和财务审查", series_a_items),
        ("B轮尽调清单", "series_b", "B轮融资全面尽调，覆盖所有方面", series_b_items),
    ]

    for name, round_type, desc, items in templates:
        cur = db.execute(
            """INSERT INTO ldd_templates (name, round_type, description, is_builtin)
               VALUES (?, ?, ?, 1)""",
            (name, round_type, desc)
        )
        template_id = cur.lastrowid

        for item in items:
            db.execute(
                """INSERT INTO ldd_template_items
                   (template_id, section_no, item_no, title, title_en, description,
                    item_type, risk_level, is_required, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (template_id, item["section_no"], item["item_no"], item["title"],
                 item["title_en"], item["description"], item["item_type"],
                 item["risk_level"], item["is_required"], item["sort_order"])
            )

    db.commit()
