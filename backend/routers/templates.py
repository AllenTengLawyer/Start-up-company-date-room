"""
LDD Template management API for different funding rounds.
"""
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db

router = APIRouter()


class TemplateCreate(BaseModel):
    name: str
    round_type: str = 'custom'  # 'angel', 'series_a', 'series_b', 'custom'
    description: Optional[str] = None


class TemplateItemCreate(BaseModel):
    section_no: str
    item_no: str
    title: str
    title_en: Optional[str] = None
    description: Optional[str] = None
    item_type: str = 'file'
    risk_level: str = 'medium'
    is_required: int = 1
    sort_order: int = 0


class TemplateImport(BaseModel):
    name: str
    round_type: str
    description: Optional[str] = None
    items: List[TemplateItemCreate]


@router.get("/ldd/templates")
def list_templates(round_type: Optional[str] = None):
    """List all templates, optionally filtered by round type."""
    db = get_db()

    if round_type:
        rows = db.execute(
            "SELECT * FROM ldd_templates WHERE round_type = ? ORDER BY is_builtin DESC, created_at DESC",
            (round_type,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM ldd_templates ORDER BY is_builtin DESC, created_at DESC"
        ).fetchall()

    templates = [dict(r) for r in rows]

    # Count items for each template
    for t in templates:
        count = db.execute(
            "SELECT COUNT(*) as n FROM ldd_template_items WHERE template_id = ?",
            (t["id"],)
        ).fetchone()["n"]
        t["item_count"] = count

    db.close()
    return {"templates": templates}


@router.get("/ldd/templates/{template_id}")
def get_template(template_id: int):
    """Get a template with all its items."""
    db = get_db()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    items = db.execute(
        "SELECT * FROM ldd_template_items WHERE template_id = ? ORDER BY sort_order",
        (template_id,)
    ).fetchall()

    db.close()

    return {
        **dict(template),
        "items": [dict(r) for r in items]
    }


@router.post("/ldd/templates", status_code=201)
def create_template(data: TemplateCreate):
    """Create a new template."""
    db = get_db()

    cur = db.execute(
        """INSERT INTO ldd_templates (name, round_type, description, is_builtin)
           VALUES (?, ?, ?, 0)""",
        (data.name, data.round_type, data.description)
    )
    template_id = cur.lastrowid
    db.commit()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()
    db.close()

    return dict(template)


@router.put("/ldd/templates/{template_id}")
def update_template(template_id: int, data: TemplateCreate):
    """Update a template."""
    db = get_db()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    if template["is_builtin"]:
        db.close()
        raise HTTPException(403, "内置模板不能修改")

    db.execute(
        "UPDATE ldd_templates SET name = ?, round_type = ?, description = ? WHERE id = ?",
        (data.name, data.round_type, data.description, template_id)
    )
    db.commit()

    updated = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()
    db.close()

    return dict(updated)


@router.delete("/ldd/templates/{template_id}")
def delete_template(template_id: int):
    """Delete a template and all its items."""
    db = get_db()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    if template["is_builtin"]:
        db.close()
        raise HTTPException(403, "内置模板不能删除")

    # Items will be deleted by CASCADE
    db.execute("DELETE FROM ldd_templates WHERE id = ?", (template_id,))
    db.commit()
    db.close()

    return {"ok": True}


@router.post("/ldd/templates/{template_id}/items", status_code=201)
def add_template_item(template_id: int, item: TemplateItemCreate):
    """Add an item to a template."""
    db = get_db()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    cur = db.execute(
        """INSERT INTO ldd_template_items
           (template_id, section_no, item_no, title, title_en, description,
            item_type, risk_level, is_required, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (template_id, item.section_no, item.item_no, item.title, item.title_en,
         item.description, item.item_type, item.risk_level, item.is_required, item.sort_order)
    )
    item_id = cur.lastrowid
    db.commit()

    new_item = db.execute(
        "SELECT * FROM ldd_template_items WHERE id = ?",
        (item_id,)
    ).fetchone()
    db.close()

    return dict(new_item)


@router.delete("/ldd/templates/{template_id}/items/{item_id}")
def delete_template_item(template_id: int, item_id: int):
    """Delete an item from a template."""
    db = get_db()

    item = db.execute(
        "SELECT * FROM ldd_template_items WHERE id = ? AND template_id = ?",
        (item_id, template_id)
    ).fetchone()

    if not item:
        db.close()
        raise HTTPException(404, "检查项不存在")

    db.execute("DELETE FROM ldd_template_items WHERE id = ?", (item_id,))
    db.commit()
    db.close()

    return {"ok": True}


@router.post("/projects/{project_id}/apply-template")
def apply_template(project_id: int, template_id: int):
    """Apply a template to a project (creates LDD items)."""
    db = get_db()

    # Verify project exists
    project = db.execute(
        "SELECT * FROM projects WHERE id = ?",
        (project_id,)
    ).fetchone()

    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    # Get template with items
    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    items = db.execute(
        "SELECT * FROM ldd_template_items WHERE template_id = ? ORDER BY sort_order",
        (template_id,)
    ).fetchall()

    # Clear existing LDD items for this project
    db.execute("DELETE FROM ldd_items WHERE project_id = ?", (project_id,))

    # Create new LDD items from template
    created = 0
    for item in items:
        db.execute(
            """INSERT INTO ldd_items
               (project_id, section_no, item_no, title, title_en, description,
                item_type, risk_level, is_required, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, item["section_no"], item["item_no"], item["title"],
             item["title_en"], item["description"], item["item_type"],
             item["risk_level"], item["is_required"], item["sort_order"])
        )
        created += 1

    db.commit()
    db.close()

    return {
        "ok": True,
        "template_name": template["name"],
        "items_created": created
    }


@router.get("/ldd/templates/{template_id}/export")
def export_template(template_id: int):
    """Export template as JSON."""
    db = get_db()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()

    if not template:
        db.close()
        raise HTTPException(404, "模板不存在")

    items = db.execute(
        "SELECT * FROM ldd_template_items WHERE template_id = ? ORDER BY sort_order",
        (template_id,)
    ).fetchall()

    db.close()

    export_data = {
        "version": 1,
        "name": template["name"],
        "round_type": template["round_type"],
        "description": template["description"],
        "items": [dict(r) for r in items]
    }

    return export_data


@router.post("/ldd/templates/import", status_code=201)
def import_template(data: TemplateImport):
    """Import template from JSON."""
    db = get_db()

    # Create template
    cur = db.execute(
        """INSERT INTO ldd_templates (name, round_type, description, is_builtin)
           VALUES (?, ?, ?, 0)""",
        (data.name, data.round_type, data.description)
    )
    template_id = cur.lastrowid

    # Create items
    for item in data.items:
        db.execute(
            """INSERT INTO ldd_template_items
               (template_id, section_no, item_no, title, title_en, description,
                item_type, risk_level, is_required, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (template_id, item.section_no, item.item_no, item.title,
             item.title_en, item.description, item.item_type,
             item.risk_level, item.is_required, item.sort_order)
        )

    db.commit()

    template = db.execute(
        "SELECT * FROM ldd_templates WHERE id = ?",
        (template_id,)
    ).fetchone()
    db.close()

    return {
        "ok": True,
        "template": dict(template),
        "items_imported": len(data.items)
    }
