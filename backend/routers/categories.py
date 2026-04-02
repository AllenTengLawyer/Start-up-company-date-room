from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
from ..database import get_db
from ..seed import create_category_folders

router = APIRouter()

class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    sort_order: int = 0

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None

def build_tree(rows, parent_id=None):
    result = []
    for r in rows:
        if r["parent_id"] == parent_id:
            node = dict(r)
            node["children"] = build_tree(rows, r["id"])
            result.append(node)
    result.sort(key=lambda x: x["sort_order"])
    return result

@router.get("/projects/{project_id}/categories")
def list_categories(project_id: int):
    db = get_db()
    rows = db.execute("SELECT * FROM categories WHERE project_id=?", (project_id,)).fetchall()
    db.close()
    return build_tree([dict(r) for r in rows])

@router.post("/projects/{project_id}/categories", status_code=201)
def create_category(project_id: int, data: CategoryCreate):
    db = get_db()
    project = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    cur = db.execute(
        "INSERT INTO categories (project_id, parent_id, name, sort_order) VALUES (?,?,?,?)",
        (project_id, data.parent_id, data.name, data.sort_order)
    )
    db.commit()
    cid = cur.lastrowid
    if project:
        create_category_folders(db, project_id, project["root_path"])
    db.close()
    return {"id": cid}

@router.put("/categories/{category_id}")
def update_category(category_id: int, data: CategoryUpdate):
    db = get_db()
    fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.execute(f"UPDATE categories SET {sets} WHERE id=?", (*fields.values(), category_id))
        db.commit()
    db.close()
    return {"ok": True}

@router.delete("/categories/{category_id}")
def delete_category(category_id: int):
    db = get_db()
    has_files = db.execute("SELECT id FROM files WHERE category_id=?", (category_id,)).fetchone()
    if has_files:
        db.close()
        raise HTTPException(400, "该分类下存在文件，请先移除文件后再删除分类")
    has_children = db.execute("SELECT id FROM categories WHERE parent_id=?", (category_id,)).fetchone()
    if has_children:
        db.close()
        raise HTTPException(400, "该分类下存在子分类，请先删除子分类")
    db.execute("DELETE FROM categories WHERE id=?", (category_id,))
    db.commit()
    db.close()
    return {"ok": True}
