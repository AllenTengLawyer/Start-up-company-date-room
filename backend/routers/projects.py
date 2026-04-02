import json
import os
import threading
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
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

@router.get("/browse-folder")
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
    cur = db.execute(
        "INSERT INTO projects (name, root_path, company_type, mode) VALUES (?,?,?,?)",
        (data.name, data.root_path, data.company_type, data.mode)
    )
    project_id = cur.lastrowid
    db.commit()
    if data.mode == "established":
        seed_project(db, project_id, data.root_path)
        db.commit()
    db.close()
    return {"id": project_id, "name": data.name, "mode": data.mode}

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
