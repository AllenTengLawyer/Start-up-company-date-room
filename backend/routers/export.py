from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse
from jinja2 import Environment, FileSystemLoader
from pydantic import BaseModel
import os
import io
import re
import shutil
import json
import zipfile

router = APIRouter()

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

def get_report_data(project_id: int):
    from ..database import get_db
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    items = db.execute(
        "SELECT * FROM ldd_items WHERE project_id=? ORDER BY sort_order", (project_id,)
    ).fetchall()
    statuses = {
        r["ldd_item_id"]: dict(r)
        for r in db.execute("""
            SELECT ls.* FROM ldd_status ls
            JOIN ldd_items li ON ls.ldd_item_id = li.id
            WHERE li.project_id=?
        """, (project_id,)).fetchall()
    }
    mappings_raw = db.execute("""
        SELECT lm.ldd_item_id, f.file_name
        FROM ldd_mappings lm
        JOIN files f ON lm.file_id = f.id
        JOIN ldd_items li ON lm.ldd_item_id = li.id
        WHERE li.project_id=?
    """, (project_id,)).fetchall()
    mappings_by_item = {}
    for m in mappings_raw:
        mappings_by_item.setdefault(m["ldd_item_id"], []).append(m["file_name"])

    score_data = db.execute("""
        SELECT ls.status, COUNT(*) as n
        FROM ldd_status ls JOIN ldd_items li ON ls.ldd_item_id=li.id
        WHERE li.project_id=? AND li.is_required=1 GROUP BY ls.status
    """, (project_id,)).fetchall()
    sc = {r["status"]: r["n"] for r in score_data}
    total = db.execute("SELECT COUNT(*) as n FROM ldd_items WHERE project_id=? AND is_required=1", (project_id,)).fetchone()["n"]
    db.close()

    provided = sc.get("provided", 0)
    partial = sc.get("partial", 0)
    na = sc.get("na", 0)
    effective = total - na
    score_pct = round((provided + partial * 0.5) / effective * 100) if effective > 0 else 0

    sections = {}
    for item in items:
        d = dict(item)
        s = statuses.get(item["id"], {})
        d["status"] = s.get("status", "pending")
        d["statement"] = s.get("statement", "")
        d["files"] = mappings_by_item.get(item["id"], [])
        sec = item["section_no"]
        sections.setdefault(sec, {"section_no": sec, "items": []})
        sections[sec]["items"].append(d)

    return {
        "project": dict(project),
        "sections": list(sections.values()),
        "score_pct": score_pct,
        "total": total,
        "provided": provided,
        "partial": partial,
        "na": na,
        "pending": total - provided - partial - na,
    }

@router.get("/projects/{project_id}/export/html")
def export_html(project_id: int):
    data = get_report_data(project_id)
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    tmpl = env.get_template("report_template.html")
    html = tmpl.render(**data)
    return HTMLResponse(content=html)

@router.get("/projects/{project_id}/export/pdf")
def export_pdf(project_id: int):
    data = get_report_data(project_id)
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    tmpl = env.get_template("report_template.html")
    html = tmpl.render(**data)

    try:
        import weasyprint
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=DD_Report_{project_id}.pdf"}
        )
    except Exception as e:
        raise HTTPException(500, f"PDF生成失败，请使用HTML导出后在浏览器中打印为PDF。错误：{str(e)}")


# ── Cabinet → Folder export ──────────────────────────────────────────────────

_ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|]')

def _sanitize(name: str) -> str:
    name = _ILLEGAL_CHARS.sub("_", name)
    return name.strip(". ") or "_"

def _unique_dest(folder: str, filename: str) -> str:
    """Return a non-colliding destination path, appending _(2), _(3) etc."""
    dest = os.path.join(folder, filename)
    if not os.path.exists(dest):
        return dest
    base, ext = os.path.splitext(filename)
    n = 2
    while True:
        dest = os.path.join(folder, f"{base}_({n}){ext}")
        if not os.path.exists(dest):
            return dest
        n += 1

class FolderExportRequest(BaseModel):
    dest_path: str

@router.post("/projects/{project_id}/export/folder")
def export_folder(project_id: int, req: FolderExportRequest):
    from ..database import get_db
    dest = req.dest_path.strip()
    if not dest:
        raise HTTPException(400, "目标路径不能为空")

    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    root_path = project["root_path"]
    if os.path.normcase(os.path.abspath(dest)) == os.path.normcase(os.path.abspath(root_path)):
        db.close()
        raise HTTPException(400, "目标路径不能与源路径相同")

    # Build category_id → absolute folder path mapping
    cats = db.execute(
        "SELECT id, parent_id, name, sort_order FROM categories WHERE project_id=? ORDER BY sort_order",
        (project_id,)
    ).fetchall()
    id_to_cat = {r["id"]: dict(r) for r in cats}

    # Group children by parent to get sort-order index for prefix
    children_of = {}
    for c in cats:
        pid = c["parent_id"]
        children_of.setdefault(pid, []).append(c["id"])

    def folder_path(cat_id):
        parts = []
        cur = cat_id
        while cur is not None:
            cat = id_to_cat.get(cur)
            if cat is None:
                break
            siblings = children_of.get(cat["parent_id"], [])
            idx = siblings.index(cur) + 1 if cur in siblings else 1
            parts.append(f"{idx:02d}_{_sanitize(cat['name'])}")
            cur = cat["parent_id"]
        return os.path.join(dest, *reversed(parts))

    cat_paths = {cid: folder_path(cid) for cid in id_to_cat}

    # Load all registered files
    files = db.execute(
        "SELECT id, file_name, file_path, category_id FROM files WHERE project_id=?",
        (project_id,)
    ).fetchall()
    db.close()

    try:
        os.makedirs(dest, exist_ok=True)
    except PermissionError as e:
        raise HTTPException(400, f"无法创建目标目录：权限不足 ({dest})")

    copied = 0
    skipped = []

    for f in files:
        src = os.path.join(root_path, f["file_path"])
        if not os.path.isfile(src):
            skipped.append({"file_name": f["file_name"], "reason": "源文件不存在"})
            continue

        if f["category_id"] and f["category_id"] in cat_paths:
            target_folder = cat_paths[f["category_id"]]
        else:
            target_folder = os.path.join(dest, "_uncategorized")

        # Check path length (Windows MAX_PATH guard)
        candidate = os.path.join(target_folder, f["file_name"])
        if len(candidate) > 240:
            skipped.append({"file_name": f["file_name"], "reason": "目标路径超过系统长度限制"})
            continue

        try:
            os.makedirs(target_folder, exist_ok=True)
            dest_file = _unique_dest(target_folder, f["file_name"])
            shutil.copy2(src, dest_file)
            copied += 1
        except Exception as e:
            skipped.append({"file_name": f["file_name"], "reason": str(e)})

    return {"ok": True, "dest_path": dest, "copied": copied, "skipped": skipped}


# ── JSON backup / restore ─────────────────────────────────────────────────────

def _rows(db, sql, params=()):
    return [dict(r) for r in db.execute(sql, params).fetchall()]

@router.get("/projects/{project_id}/export/json")
def export_json(project_id: int):
    from ..database import get_db
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    data = {
        "version": 1,
        "project": dict(project),
        "categories": _rows(db, "SELECT * FROM categories WHERE project_id=?", (project_id,)),
        "files": _rows(db, "SELECT * FROM files WHERE project_id=?", (project_id,)),
        "ldd_items": _rows(db, "SELECT * FROM ldd_items WHERE project_id=?", (project_id,)),
        "ldd_status": _rows(db, """
            SELECT ls.* FROM ldd_status ls
            JOIN ldd_items li ON ls.ldd_item_id = li.id
            WHERE li.project_id=?""", (project_id,)),
        "ldd_mappings": _rows(db, """
            SELECT lm.* FROM ldd_mappings lm
            JOIN ldd_items li ON lm.ldd_item_id = li.id
            WHERE li.project_id=?""", (project_id,)),
        "founders": _rows(db, "SELECT * FROM founders WHERE project_id=?", (project_id,)),
        "founder_checklist_status": _rows(db, """
            SELECT fcs.* FROM founder_checklist_status fcs
            JOIN founders f ON fcs.founder_id = f.id
            WHERE f.project_id=?""", (project_id,)),
        "founder_files": _rows(db, """
            SELECT ff.* FROM founder_files ff
            JOIN founders f ON ff.founder_id = f.id
            WHERE f.project_id=?""", (project_id,)),
    }
    db.close()

    project_name = dict(project)["name"].replace(" ", "_")
    filename = f"backup_{project_name}_{project_id}.json"
    content = json.dumps(data, ensure_ascii=False, indent=2)
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.post("/projects/import", status_code=201)
async def import_json(request: Request):
    from ..database import get_db
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "无效的JSON文件")

    if data.get("version") != 1:
        raise HTTPException(400, "不支持的备份版式")

    db = get_db()
    proj = data["project"]

    # Insert new project (new ID to avoid conflicts)
    cur = db.execute(
        "INSERT INTO projects (name, root_path, company_type, mode) VALUES (?,?,?,?)",
        (proj["name"] + " (导入)", proj["root_path"], proj.get("company_type", "cn"), proj.get("mode", "established"))
    )
    new_pid = cur.lastrowid

    # Map old IDs → new IDs for each table
    cat_map = {}
    for c in data.get("categories", []):
        r = db.execute(
            "INSERT INTO categories (project_id, parent_id, name, sort_order) VALUES (?,?,?,?)",
            (new_pid, None, c["name"], c.get("sort_order", 0))
        )
        cat_map[c["id"]] = r.lastrowid
    # Fix parent_id references
    for c in data.get("categories", []):
        if c.get("parent_id") and c["parent_id"] in cat_map:
            db.execute("UPDATE categories SET parent_id=? WHERE id=?",
                       (cat_map[c["parent_id"]], cat_map[c["id"]]))

    file_map = {}
    for f in data.get("files", []):
        r = db.execute(
            "INSERT INTO files (project_id, category_id, file_name, file_path, notes, keyword_suggested) VALUES (?,?,?,?,?,?)",
            (new_pid, cat_map.get(f.get("category_id")), f["file_name"], f["file_path"],
             f.get("notes", ""), f.get("keyword_suggested", 0))
        )
        file_map[f["id"]] = r.lastrowid

    ldd_map = {}
    for item in data.get("ldd_items", []):
        r = db.execute(
            """INSERT INTO ldd_items (project_id, section_no, item_no, title, title_en, description,
               item_type, risk_level, is_required, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (new_pid, item["section_no"], item["item_no"], item["title"], item.get("title_en", ""),
             item.get("description", ""), item.get("item_type", "file"), item.get("risk_level", "medium"),
             item.get("is_required", 1), item.get("sort_order", 0))
        )
        ldd_map[item["id"]] = r.lastrowid

    for s in data.get("ldd_status", []):
        new_item_id = ldd_map.get(s["ldd_item_id"])
        if new_item_id:
            db.execute(
                "INSERT OR IGNORE INTO ldd_status (ldd_item_id, status, statement) VALUES (?,?,?)",
                (new_item_id, s["status"], s.get("statement", ""))
            )

    for m in data.get("ldd_mappings", []):
        new_item_id = ldd_map.get(m["ldd_item_id"])
        new_file_id = file_map.get(m["file_id"])
        if new_item_id and new_file_id:
            db.execute("INSERT OR IGNORE INTO ldd_mappings (ldd_item_id, file_id) VALUES (?,?)",
                       (new_item_id, new_file_id))

    founder_map = {}
    for f in data.get("founders", []):
        r = db.execute(
            "INSERT INTO founders (project_id, name, role, id_number, join_date, employment_type, notes) VALUES (?,?,?,?,?,?,?)",
            (new_pid, f["name"], f.get("role", ""), f.get("id_number", ""),
             f.get("join_date", ""), f.get("employment_type", "full_time"), f.get("notes", ""))
        )
        founder_map[f["id"]] = r.lastrowid

    for s in data.get("founder_checklist_status", []):
        new_fid = founder_map.get(s["founder_id"])
        if new_fid:
            db.execute(
                "INSERT OR IGNORE INTO founder_checklist_status (founder_id, item_code, status, statement) VALUES (?,?,?,?)",
                (new_fid, s["item_code"], s["status"], s.get("statement", ""))
            )

    for ff in data.get("founder_files", []):
        new_fid = founder_map.get(ff["founder_id"])
        if new_fid:
            db.execute(
                "INSERT INTO founder_files (founder_id, item_code, file_name, file_path, notes) VALUES (?,?,?,?,?)",
                (new_fid, ff["item_code"], ff["file_name"], ff["file_path"], ff.get("notes", ""))
            )

    db.commit()
    db.close()
    return {"id": new_pid, "name": proj["name"] + " (导入)"}


# ── LDD zip export ────────────────────────────────────────────────────────────

SECTION_NAMES = {
    '1': '集团公司基本文件', '2': '业务与重大合同', '3': '借款和担保',
    '4': '财务和会计', '5': '动产和不动产', '6': '知识产权',
    '7': '税务及财政补贴', '8': '雇员和不竞争', '9': '保险',
    '10': '诉讼、执行及行政处罚', '11': '网络安全、数据合规', '12': 'ESG', '13': '其他'
}

@router.get("/projects/{project_id}/export/ldd-zip")
def export_ldd_zip(project_id: int):
    from ..database import get_db
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    root_path = project["root_path"]

    # Build category id → full path parts (for sub-folder hierarchy inside each LDD item)
    cats = db.execute(
        "SELECT id, parent_id, name FROM categories WHERE project_id=? ORDER BY sort_order",
        (project_id,)
    ).fetchall()
    id_to_cat = {r["id"]: dict(r) for r in cats}

    def cat_path_parts(cat_id):
        """Return list of category names from root to leaf."""
        parts = []
        cur = cat_id
        while cur is not None:
            cat = id_to_cat.get(cur)
            if cat is None:
                break
            parts.append(_sanitize(cat["name"]))
            cur = cat["parent_id"]
        return list(reversed(parts))

    # Load LDD items with their mappings
    items = db.execute(
        "SELECT * FROM ldd_items WHERE project_id=? ORDER BY sort_order", (project_id,)
    ).fetchall()

    mappings = db.execute("""
        SELECT lm.ldd_item_id, f.file_name, f.file_path, f.category_id,
               c.name as category_name, c.parent_id as category_parent_id
        FROM ldd_mappings lm
        JOIN files f ON lm.file_id = f.id
        JOIN ldd_items li ON lm.ldd_item_id = li.id
        LEFT JOIN categories c ON f.category_id = c.id
        WHERE li.project_id=?
    """, (project_id,)).fetchall()

    mappings_by_item = {}
    for m in mappings:
        mappings_by_item.setdefault(m["ldd_item_id"], []).append(dict(m))

    db.close()

    # Build zip in memory
    buf = io.BytesIO()
    seen_paths = {}  # track duplicates within zip

    def unique_zip_path(path):
        if path not in seen_paths:
            seen_paths[path] = 1
            return path
        seen_paths[path] += 1
        base, ext = os.path.splitext(path)
        return f"{base}_({seen_paths[path]}){ext}"

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            item_files = mappings_by_item.get(item["id"], [])
            if not item_files:
                continue

            sec = str(item["section_no"])
            sec_name = SECTION_NAMES.get(sec, sec)
            sec_folder = _sanitize(f"§{sec}_{sec_name}")
            item_folder = _sanitize(f"{item['item_no']}_{item['title']}")

            for f in item_files:
                src = os.path.join(root_path, f["file_path"])
                if not os.path.isfile(src):
                    continue

                # Build sub-path from category hierarchy
                if f["category_id"]:
                    sub_parts = cat_path_parts(f["category_id"])
                else:
                    sub_parts = []

                zip_parts = [sec_folder, item_folder] + sub_parts + [f["file_name"]]
                zip_path = unique_zip_path("/".join(zip_parts))

                try:
                    zf.write(src, zip_path)
                except Exception:
                    pass  # skip unreadable files

    buf.seek(0)
    project_name = _sanitize(project["name"])
    filename = f"LDD_{project_name}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ── Category zip export ───────────────────────────────────────────────────────

@router.get("/projects/{project_id}/export/category-zip")
def export_category_zip(project_id: int, cat_id: int):
    from ..database import get_db
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    root_path = project["root_path"]

    # Load all categories for this project
    cats = db.execute(
        "SELECT id, parent_id, name FROM categories WHERE project_id=? ORDER BY sort_order",
        (project_id,)
    ).fetchall()
    id_to_cat = {r["id"]: dict(r) for r in cats}

    # Collect all descendant category IDs (including cat_id itself)
    def descendant_ids(root_id):
        result = {root_id}
        changed = True
        while changed:
            changed = False
            for c in cats:
                if c["parent_id"] in result and c["id"] not in result:
                    result.add(c["id"])
                    changed = True
        return result

    target_ids = descendant_ids(cat_id)

    # Build relative folder path for a category (from cat_id root downward)
    def rel_folder(cid):
        parts = []
        cur = cid
        while cur is not None and cur != id_to_cat.get(cat_id, {}).get("parent_id"):
            cat = id_to_cat.get(cur)
            if cat is None:
                break
            parts.append(_sanitize(cat["name"]))
            cur = cat["parent_id"]
            if cur == id_to_cat[cat_id]["parent_id"]:
                break
        return "/".join(reversed(parts))

    # Load files in target categories
    placeholders = ",".join("?" * len(target_ids))
    files = db.execute(
        f"SELECT id, file_name, file_path, category_id FROM files WHERE project_id=? AND category_id IN ({placeholders})",
        (project_id, *target_ids)
    ).fetchall()
    db.close()

    buf = io.BytesIO()
    seen_paths = {}

    def unique_zip_path(path):
        if path not in seen_paths:
            seen_paths[path] = 1
            return path
        seen_paths[path] += 1
        base, ext = os.path.splitext(path)
        return f"{base}_({seen_paths[path]}){ext}"

    root_cat_name = _sanitize(id_to_cat[cat_id]["name"]) if cat_id in id_to_cat else str(cat_id)

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            src = os.path.join(root_path, f["file_path"])
            if not os.path.isfile(src):
                continue
            folder = rel_folder(f["category_id"]) if f["category_id"] else root_cat_name
            zip_path = unique_zip_path(f"{folder}/{f['file_name']}")
            try:
                zf.write(src, zip_path)
            except Exception:
                pass

    buf.seek(0)
    filename = f"{root_cat_name}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
