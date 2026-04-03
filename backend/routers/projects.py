import json
import os
import threading
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sqlite3
from typing import Optional
from ..database import get_db
from ..seed import seed_project, create_category_folders

router = APIRouter()

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

class ProjectCreate(BaseModel):
    name: str
    root_path: str
    company_type: str = "cn"
    mode: str = "established"

class ModeUpdate(BaseModel):
    mode: str

class OpenFileDirRequest(BaseModel):
    file_id: int

class OpenFileRequest(BaseModel):
    file_id: int

class OpenCategoryDirRequest(BaseModel):
    category_id: int

def _open_in_explorer(path: str):
    if not path:
        raise HTTPException(400, "路径为空")
    if not os.path.exists(path):
        raise HTTPException(400, f"路径不存在: {path}")
    try:
        os.startfile(path)
    except Exception as e:
        raise HTTPException(500, f"打开失败: {e}")

@router.api_route("/browse-folder", methods=["GET", "POST"])
def browse_folder():
    """Open a native OS folder picker dialog and return the selected path."""
    result = {"path": None}
    def _pick():
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.wm_attributes("-topmost", True)
            path = filedialog.askdirectory(title="选择文件夹")
            root.destroy()
            result["path"] = path or None
        except Exception:
            result["path"] = None
    t = threading.Thread(target=_pick)
    t.start()
    t.join(timeout=120)
    return {"path": result["path"]}

@router.get("/projects")
def list_projects():
    db = get_db()
    rows = db.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
    db.close()
    return [dict(r) for r in rows]

@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate):
    if not os.path.isdir(data.root_path):
        raise HTTPException(400, f"目录不存在: {data.root_path}")
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO projects (name, root_path, company_type, mode) VALUES (?,?,?,?)",
            (data.name, data.root_path, data.company_type, data.mode)
        )
        project_id = cur.lastrowid
        if data.mode == "established":
            seed_project(db, project_id, data.root_path)
        db.commit()
        return {"id": project_id, "name": data.name, "mode": data.mode}
    except sqlite3.OperationalError as e:
        db.rollback()
        if "locked" in str(e).lower():
            raise HTTPException(503, "数据库正忙（database is locked），请稍后重试")
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

@router.get("/projects/{project_id}")
def get_project(project_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "项目不存在")
    return dict(row)

@router.put("/projects/{project_id}/mode")
def update_mode(project_id: int, data: ModeUpdate):
    db = get_db()
    row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(404, "项目不存在")
    db.execute("UPDATE projects SET mode=? WHERE id=?", (data.mode, project_id))
    if data.mode == "established":
        existing = db.execute("SELECT id FROM ldd_items WHERE project_id=?", (project_id,)).fetchone()
        if not existing:
            seed_project(db, project_id, row["root_path"])
        else:
            create_category_folders(db, project_id, row["root_path"])
    db.commit()
    db.close()
    return {"ok": True}

@router.post("/projects/{project_id}/ensure-seeded")
def ensure_seeded(project_id: int):
    db = get_db()
    try:
        proj = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "项目不存在")
        if proj["mode"] != "established":
            return {"ok": True, "seeded": False}

        has_cats = db.execute("SELECT 1 FROM categories WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
        has_ldd = db.execute("SELECT 1 FROM ldd_items WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
        if has_cats and has_ldd:
            return {"ok": True, "seeded": False}

        seed_project(db, project_id, proj["root_path"])
        db.commit()
        return {"ok": True, "seeded": True}
    except sqlite3.OperationalError as e:
        db.rollback()
        if "locked" in str(e).lower():
            raise HTTPException(503, "数据库正忙（database is locked），请稍后重试")
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

@router.api_route("/projects/{project_id}/open-root", methods=["GET", "POST"])
def open_project_root(project_id: int):
    db = get_db()
    row = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(404, "项目不存在")
    root = row["root_path"]
    _open_in_explorer(root)
    return {"ok": True}

@router.api_route("/projects/{project_id}/open-file-dir", methods=["GET", "POST"])
def open_file_dir(project_id: int, data: OpenFileDirRequest):
    db = get_db()
    proj = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    if not proj:
        db.close()
        raise HTTPException(404, "项目不存在")
    f = db.execute(
        "SELECT file_path FROM files WHERE id=? AND project_id=?",
        (data.file_id, project_id)
    ).fetchone()
    db.close()
    if not f:
        raise HTTPException(404, "文件不存在")
    full = os.path.normpath(os.path.join(proj["root_path"], f["file_path"].replace("/", os.sep)))
    folder = os.path.dirname(full)
    _open_in_explorer(folder if folder else proj["root_path"])
    return {"ok": True}

@router.api_route("/projects/{project_id}/open-file", methods=["GET", "POST"])
def open_file(project_id: int, data: OpenFileRequest):
    db = get_db()
    proj = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    if not proj:
        db.close()
        raise HTTPException(404, "项目不存在")
    f = db.execute(
        "SELECT file_path FROM files WHERE id=? AND project_id=?",
        (data.file_id, project_id)
    ).fetchone()
    db.close()
    if not f:
        raise HTTPException(404, "文件不存在")
    full = os.path.normpath(os.path.join(proj["root_path"], f["file_path"].replace("/", os.sep)))
    _open_in_explorer(full)
    return {"ok": True}

@router.api_route("/projects/{project_id}/open-category-dir", methods=["GET", "POST"])
def open_category_dir(project_id: int, data: OpenCategoryDirRequest):
    db = get_db()
    proj = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    if not proj:
        db.close()
        raise HTTPException(404, "项目不存在")
    rows = db.execute(
        "SELECT id, parent_id, name FROM categories WHERE project_id=?",
        (project_id,)
    ).fetchall()
    db.close()
    id_to_row = {r["id"]: r for r in rows}
    if data.category_id not in id_to_row:
        raise HTTPException(404, "分类不存在")

    parts = []
    cur = data.category_id
    while cur is not None:
        r = id_to_row.get(cur)
        if r is None:
            break
        parts.append(r["name"])
        cur = r["parent_id"]
    parts.reverse()
    folder = os.path.join(proj["root_path"], *parts)
    _open_in_explorer(folder)
    return {"ok": True}

@router.delete("/projects/{project_id}")
def delete_project(project_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(404, "项目不存在")
    try:
        file_ids = [
            r["id"]
            for r in db.execute("SELECT id FROM files WHERE project_id=?", (project_id,)).fetchall()
        ]
        founder_ids = [
            r["id"]
            for r in db.execute("SELECT id FROM founders WHERE project_id=?", (project_id,)).fetchall()
        ]
        ldd_item_ids = [
            r["id"]
            for r in db.execute("SELECT id FROM ldd_items WHERE project_id=?", (project_id,)).fetchall()
        ]

        if ldd_item_ids:
            placeholders = ",".join(["?"] * len(ldd_item_ids))
            db.execute(f"DELETE FROM ldd_mappings WHERE ldd_item_id IN ({placeholders})", ldd_item_ids)
            db.execute(f"DELETE FROM ldd_status WHERE ldd_item_id IN ({placeholders})", ldd_item_ids)
            db.execute(f"DELETE FROM ldd_items WHERE id IN ({placeholders})", ldd_item_ids)

        if founder_ids:
            placeholders = ",".join(["?"] * len(founder_ids))
            db.execute(f"DELETE FROM founder_files WHERE founder_id IN ({placeholders})", founder_ids)
            db.execute(f"DELETE FROM founder_checklist_status WHERE founder_id IN ({placeholders})", founder_ids)
            db.execute(f"DELETE FROM founders WHERE id IN ({placeholders})", founder_ids)

        if file_ids:
            placeholders = ",".join(["?"] * len(file_ids))
            db.execute(f"DELETE FROM ldd_mappings WHERE file_id IN ({placeholders})", file_ids)
            db.execute(f"DELETE FROM file_content_fts WHERE rowid IN ({placeholders})", file_ids)
            db.execute(f"DELETE FROM file_versions WHERE file_id IN ({placeholders})", file_ids)
            db.execute(f"DELETE FROM file_content WHERE file_id IN ({placeholders})", file_ids)
            db.execute(f"DELETE FROM files WHERE id IN ({placeholders})", file_ids)

        db.execute("DELETE FROM categories WHERE project_id=?", (project_id,))
        db.execute("DELETE FROM projects WHERE id=?", (project_id,))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {"ok": True}
