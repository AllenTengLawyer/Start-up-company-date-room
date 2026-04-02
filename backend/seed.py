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
        os.makedirs(folder, exist_ok=True)

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
