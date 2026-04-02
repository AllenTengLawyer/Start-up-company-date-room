from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..database import get_db

router = APIRouter()

class StatusUpdate(BaseModel):
    status: str  # provided / partial / pending / na
    statement: Optional[str] = None

class MappingCreate(BaseModel):
    file_id: int

@router.get("/projects/{project_id}/ldd")
def get_ldd(project_id: int):
    db = get_db()
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
        SELECT lm.*, f.file_name, f.file_path, f.category_id,
               c.name as category_name, c.parent_id as category_parent_id
        FROM ldd_mappings lm
        JOIN files f ON lm.file_id = f.id
        JOIN ldd_items li ON lm.ldd_item_id = li.id
        LEFT JOIN categories c ON f.category_id = c.id
        WHERE li.project_id=?
    """, (project_id,)).fetchall()

    mappings_by_item = {}
    for m in mappings_raw:
        mappings_by_item.setdefault(m["ldd_item_id"], []).append(dict(m))

    sections = {}
    for item in items:
        item_dict = dict(item)
        s = statuses.get(item["id"], {})
        item_dict["status"] = s.get("status", "pending")
        item_dict["statement"] = s.get("statement", "")
        item_dict["mapped_files"] = mappings_by_item.get(item["id"], [])
        sec = item["section_no"]
        sections.setdefault(sec, {"section_no": sec, "items": []})
        sections[sec]["items"].append(item_dict)

    db.close()
    return {"sections": list(sections.values())}

@router.get("/projects/{project_id}/ldd/todo")
def get_ldd_todo(project_id: int):
    """Return high/medium risk items that are still pending or partial, sorted by risk then order."""
    db = get_db()
    items = db.execute("""
        SELECT li.*, COALESCE(ls.status, 'pending') as status, COALESCE(ls.statement, '') as statement
        FROM ldd_items li
        LEFT JOIN ldd_status ls ON ls.ldd_item_id = li.id
        WHERE li.project_id=?
          AND li.is_required=1
          AND COALESCE(ls.status, 'pending') IN ('pending', 'partial')
        ORDER BY
          CASE li.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          li.sort_order
    """, (project_id,)).fetchall()

    mappings_raw = db.execute("""
        SELECT lm.*, f.file_name, f.category_id, c.name as category_name
        FROM ldd_mappings lm
        JOIN files f ON lm.file_id = f.id
        JOIN ldd_items li ON lm.ldd_item_id = li.id
        LEFT JOIN categories c ON f.category_id = c.id
        WHERE li.project_id=?
    """, (project_id,)).fetchall()
    mappings_by_item = {}
    for m in mappings_raw:
        mappings_by_item.setdefault(m["ldd_item_id"], []).append(dict(m))

    result = []
    for item in items:
        d = dict(item)
        d["mapped_files"] = mappings_by_item.get(item["id"], [])
        result.append(d)

    db.close()
    return {"items": result}

@router.put("/ldd/{item_id}/status")
def update_status(item_id: int, data: StatusUpdate):
    db = get_db()
    db.execute("""
        INSERT INTO ldd_status (ldd_item_id, status, statement, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ldd_item_id) DO UPDATE SET
        status=excluded.status, statement=excluded.statement, updated_at=excluded.updated_at
    """, (item_id, data.status, data.statement))
    db.commit()
    db.close()
    return {"ok": True}

@router.post("/ldd/{item_id}/mappings", status_code=201)
def add_mapping(item_id: int, data: MappingCreate):
    db = get_db()
    existing = db.execute(
        "SELECT id FROM ldd_mappings WHERE ldd_item_id=? AND file_id=?", (item_id, data.file_id)
    ).fetchone()
    if existing:
        db.close()
        return {"id": existing["id"]}
    cur = db.execute(
        "INSERT INTO ldd_mappings (ldd_item_id, file_id) VALUES (?,?)", (item_id, data.file_id)
    )
    db.commit()
    mid = cur.lastrowid
    db.close()
    return {"id": mid}

@router.delete("/ldd/mappings/{mapping_id}")
def delete_mapping(mapping_id: int):
    db = get_db()
    db.execute("DELETE FROM ldd_mappings WHERE id=?", (mapping_id,))
    db.commit()
    db.close()
    return {"ok": True}

@router.get("/projects/{project_id}/ldd/score")
def get_score(project_id: int):
    db = get_db()
    total = db.execute(
        "SELECT COUNT(*) as n FROM ldd_items WHERE project_id=? AND is_required=1", (project_id,)
    ).fetchone()["n"]

    counts = db.execute("""
        SELECT ls.status, COUNT(*) as n
        FROM ldd_status ls
        JOIN ldd_items li ON ls.ldd_item_id = li.id
        WHERE li.project_id=? AND li.is_required=1
        GROUP BY ls.status
    """, (project_id,)).fetchall()

    status_counts = {r["status"]: r["n"] for r in counts}
    provided = status_counts.get("provided", 0)
    partial = status_counts.get("partial", 0)
    na = status_counts.get("na", 0)
    pending = total - provided - partial - na

    effective_total = total - na
    score_pct = round((provided + partial * 0.5) / effective_total * 100) if effective_total > 0 else 0

    db.close()
    return {
        "total": total,
        "provided": provided,
        "partial": partial,
        "pending": pending,
        "na": na,
        "score_pct": score_pct,
    }

@router.get("/projects/{project_id}/founders/summary")
def get_founders_summary(project_id: int):
    """Return each founder's checklist completion stats for display in LDD view."""
    db = get_db()
    founders = db.execute(
        "SELECT id, name, role FROM founders WHERE project_id=? ORDER BY id", (project_id,)
    ).fetchall()

    # Total checklist items per founder = 25 (static checklist)
    TOTAL_ITEMS = 25

    result = []
    for f in founders:
        counts = db.execute("""
            SELECT status, COUNT(*) as n
            FROM founder_checklist_status
            WHERE founder_id=?
            GROUP BY status
        """, (f["id"],)).fetchall()
        sc = {r["status"]: r["n"] for r in counts}
        provided = sc.get("provided", 0)
        partial = sc.get("partial", 0)
        na = sc.get("na", 0)
        pending = TOTAL_ITEMS - provided - partial - na
        effective = TOTAL_ITEMS - na
        score_pct = round((provided + partial * 0.5) / effective * 100) if effective > 0 else 0
        result.append({
            "id": f["id"],
            "name": f["name"],
            "role": f["role"],
            "total": TOTAL_ITEMS,
            "provided": provided,
            "partial": partial,
            "pending": pending,
            "na": na,
            "score_pct": score_pct,
        })

    db.close()
    return result
