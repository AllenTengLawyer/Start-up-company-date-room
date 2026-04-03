import os
import html
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..services.text_extractor import (
    calculate_file_hash, get_file_size, get_file_mtime,
    extract_text, should_extract_text
)
from ..services.version_tracker import create_version

router = APIRouter()

# Keyword → category name mapping for auto-suggestion
KEYWORD_MAP = [
    (["营业执照"], "营业执照与章程"),
    (["公司章程", "章程"], "营业执照与章程"),
    (["股权结构", "股权架构", "股权图"], "股权结构"),
    (["股东会决议", "董事会决议"], "股东会与董事会决议"),
    (["增资协议", "投资协议", "SPA", "认购协议", "股东协议"], "融资文件"),
    (["SAFE", "safe协议"], "融资文件"),
    (["期权", "ESOP", "股权激励", "限制性股份"], "股权激励（ESOP）"),
    (["VIE", "BVI", "开曼", "香港公司", "WFOE", "境外"], "海外架构"),
    (["客户合同", "销售合同", "服务合同"], "客户合同"),
    (["采购合同", "供应商合同"], "供应商合同"),
    (["合作协议", "战略合作"], "合作协议"),
    (["代理合同", "经销合同"], "代理经销合同"),
    (["贷款合同", "借款合同", "信贷"], "银行贷款"),
    (["股东借款", "关联借款"], "股东借款"),
    (["担保合同", "抵押", "质押"], "担保文件"),
    (["财务报表", "资产负债表", "损益表", "现金流量表"], "财务报表"),
    (["审计报告"], "审计报告"),
    (["银行流水", "银行回单"], "银行流水"),
    (["房产证", "不动产证", "土地证"], "不动产（房产/土地）"),
    (["租赁合同", "房屋租赁", "办公室租赁"], "租赁合同"),
    (["专利证书", "专利申请", "发明专利", "实用新型"], "专利"),
    (["商标注册证", "商标申请"], "商标"),
    (["软件著作权", "软著"], "软件著作权"),
    (["域名", "ICP备案"], "域名与ICP备案"),
    (["开源协议", "开源许可"], "开源协议"),
    (["纳税申报", "税务申报"], "纳税申报"),
    (["高新技术", "税收优惠", "双软认证"], "税务优惠资质"),
    (["政府补贴", "财政补贴"], "政府补贴"),
    (["劳动合同"], "劳动合同"),
    (["竞业限制", "竞业协议"], "竞业限制与保密协议"),
    (["保密协议", "NDA"], "竞业限制与保密协议"),
    (["知识产权归属", "IP归属"], "知识产权归属协议"),
    (["社保", "公积金"], "社保公积金"),
    (["员工手册", "HR政策"], "员工手册与HR政策"),
    (["保险单", "责任险", "财产险"], "保险单"),
    (["起诉状", "判决书", "仲裁裁决", "行政处罚"], "诉讼与仲裁"),
    (["数据合规", "个人信息保护", "隐私政策", "网络安全"], "数据合规与网络安全"),
    (["资质证书", "认证证书", "3C", "CE认证"], "行业资质与产品认证"),
]

def index_file_content(db, file_id: int, file_path: str, project_root: str):
    """Extract and index file content for full-text search."""
    full_path = os.path.join(project_root, file_path)
    if not should_extract_text(full_path):
        return

    content = extract_text(full_path)
    if not content:
        return

    # Store content
    db.execute(
        """INSERT OR REPLACE INTO file_content (file_id, content, extracted_at)
           VALUES (?, ?, datetime('now'))""",
        (file_id, content)
    )

    # Update FTS index
    try:
        db.execute(
            "INSERT OR REPLACE INTO file_content_fts (rowid, content) VALUES (?, ?)",
            (file_id, content)
        )
    except Exception:
        # FTS5 might not be available
        pass

def suggest_category(file_name: str, categories: list) -> Optional[int]:
    name_lower = file_name.lower()
    cat_name_map = {c["name"]: c["id"] for c in categories}
    for keywords, cat_name in KEYWORD_MAP:
        for kw in keywords:
            if kw.lower() in name_lower:
                if cat_name in cat_name_map:
                    return cat_name_map[cat_name]
    return None

def get_all_categories_flat(db, project_id):
    rows = db.execute("SELECT id, name, parent_id FROM categories WHERE project_id=?", (project_id,)).fetchall()
    return [dict(r) for r in rows]

class AutoCategorizeRequest(BaseModel):
    only_unclassified: bool = True

@router.post("/projects/{project_id}/files/auto-categorize")
def auto_categorize_files(project_id: int, req: AutoCategorizeRequest):
    db = get_db()
    try:
        categories = get_all_categories_flat(db, project_id)
        categories_simple = [{"id": c["id"], "name": c["name"]} for c in categories]
        if req.only_unclassified:
            files = db.execute(
                "SELECT id, file_name, file_path, category_id FROM files WHERE project_id=? AND category_id IS NULL",
                (project_id,)
            ).fetchall()
        else:
            files = db.execute(
                "SELECT id, file_name, file_path, category_id FROM files WHERE project_id=?",
                (project_id,)
            ).fetchall()

        updated = 0
        updated_ids = []
        for f in files:
            suggested_id = suggest_category(f["file_name"], categories_simple)
            if not suggested_id:
                continue
            if f["category_id"] == suggested_id:
                continue
            db.execute("UPDATE files SET category_id=? WHERE id=?", (suggested_id, f["id"]))
            updated += 1
            updated_ids.append(f["id"])

        db.commit()
        return {"ok": True, "updated": updated, "updated_ids": updated_ids}
    finally:
        db.close()

class FileRegister(BaseModel):
    file_name: str
    file_path: str
    category_id: Optional[int] = None
    notes: Optional[str] = None
    keyword_suggested: int = 0

class FileUpdate(BaseModel):
    category_id: Optional[int] = None
    notes: Optional[str] = None

class BatchUpdateRequest(BaseModel):
    file_ids: List[int]
    category_id: Optional[int]

class BatchRenameRequest(BaseModel):
    file_ids: List[int]
    pattern: str  # 'date', 'sequence', 'prefix', 'suffix'
    prefix: Optional[str] = None
    suffix: Optional[str] = None
    start_number: int = 1

class BatchDeleteRequest(BaseModel):
    file_ids: List[int]

@router.post("/projects/{project_id}/scan")
def scan_directory(project_id: int):
    db = get_db()
    project = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    root = project["root_path"]
    if not os.path.isdir(root):
        db.close()
        raise HTTPException(400, f"目录不存在: {root}")

    registered = {
        r["file_path"]: dict(r)
        for r in db.execute("SELECT file_path, file_name, file_size, content_hash FROM files WHERE project_id=?", (project_id,)).fetchall()
    }
    registered_by_name_size = {}
    for rp, info in registered.items():
        key = (info.get("file_name"), info.get("file_size"))
        if key not in registered_by_name_size:
            registered_by_name_size[key] = rp
    categories = get_all_categories_flat(db, project_id)
    id_to_cat = {c["id"]: c for c in categories}

    def cat_path_parts(cat_id: int):
        parts = []
        cur = cat_id
        while cur is not None:
            row = id_to_cat.get(cur)
            if not row:
                break
            parts.append(row["name"])
            cur = row.get("parent_id")
        parts.reverse()
        return tuple(parts)

    category_path_map = {cat_path_parts(c["id"]): c["id"] for c in categories}

    def suggest_category_by_path(rel_path: str) -> Optional[int]:
        dir_parts = rel_path.split("/")[:-1]
        if not dir_parts:
            return None
        for depth in range(len(dir_parts), 0, -1):
            key = tuple(dir_parts[:depth])
            if key in category_path_map:
                return category_path_map[key]
        return None
    db.close()

    found = []
    duplicates = []  # List of potential duplicates
    max_depth = 3

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip hidden directories
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        depth = dirpath.replace(root, "").count(os.sep)
        if depth >= max_depth:
            dirnames.clear()
        for fname in filenames:
            if fname.startswith("."):
                continue
            fpath = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(fpath, root).replace("\\", "/")

            # Check if already registered
            if rel_path in registered:
                continue

            # Calculate file metadata for duplicate detection
            file_size = get_file_size(fpath)
            last_modified = get_file_mtime(fpath)

            # Check for duplicates by name + size
            dup_info = registered_by_name_size.get((fname, file_size))

            suggested_id = suggest_category_by_path(rel_path) or suggest_category(fname, categories)
            file_info = {
                "file_name": fname,
                "file_path": rel_path,
                "file_size": file_size,
                "last_modified": last_modified,
                "suggested_category_id": suggested_id,
                "suggested_category_name": next(
                    (c["name"] for c in categories if c["id"] == suggested_id), None
                ) if suggested_id else None,
            }

            if dup_info:
                duplicates.append({
                    "new_file": file_info,
                    "existing_file": dup_info,
                    "reason": "same_name_size"
                })

            found.append(file_info)

    return {
        "files": found,
        "count": len(found),
        "duplicates": duplicates,
        "duplicate_count": len(duplicates)
    }

@router.post("/projects/{project_id}/files", status_code=201)
def register_files(project_id: int, files: List[FileRegister]):
    db = get_db()
    project = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    root = project["root_path"] if project else ""

    ids = []
    for f in files:
        # Calculate file metadata
        full_path = os.path.join(root, f.file_path) if root else f.file_path
        file_size = get_file_size(full_path) if os.path.isfile(full_path) else 0
        content_hash = calculate_file_hash(full_path) if os.path.isfile(full_path) else None
        last_modified = get_file_mtime(full_path) if os.path.isfile(full_path) else None

        cur = db.execute(
            """INSERT INTO files (project_id, category_id, file_name, file_path, file_size,
                content_hash, last_modified, notes, keyword_suggested)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (project_id, f.category_id, f.file_name, f.file_path, file_size,
             content_hash, last_modified, f.notes, f.keyword_suggested)
        )
        file_id = cur.lastrowid
        ids.append(file_id)

        # Index content for search
        if root and os.path.isfile(full_path):
            index_file_content(db, file_id, f.file_path, root)

    db.commit()
    db.close()
    return {"ids": ids}

@router.get("/projects/{project_id}/files")
def list_files(
    project_id: int,
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    category_id: Optional[int] = Query(None, description="Filter by category id"),
    include_descendants: bool = Query(False, description="Include descendant categories when filtering by category_id"),
    unclassified: bool = Query(False, description="Only files without category"),
    sort_key: str = Query("registered_at"),
    sort_dir: str = Query("desc")
):
    db = get_db()
    try:
        if limit is None and offset == 0 and category_id is None and not unclassified and sort_key == "registered_at" and sort_dir == "desc":
            rows = db.execute("""
                SELECT f.*, c.name as category_name
                FROM files f
                LEFT JOIN categories c ON f.category_id = c.id
                WHERE f.project_id=?
                ORDER BY f.registered_at DESC
            """, (project_id,)).fetchall()
            return [dict(r) for r in rows]

        allowed_sort = {
            "registered_at": "f.registered_at",
            "file_name": "f.file_name COLLATE NOCASE",
            "file_size": "f.file_size",
            "last_modified": "f.last_modified",
        }
        order_by = allowed_sort.get(sort_key, "f.registered_at")
        direction = "ASC" if str(sort_dir).lower() == "asc" else "DESC"

        where = ["f.project_id=?"]
        params: List[object] = [project_id]
        if category_id is not None:
            if include_descendants:
                cats = db.execute(
                    "SELECT id, parent_id FROM categories WHERE project_id=?",
                    (project_id,)
                ).fetchall()
                target = {int(category_id)}
                changed = True
                while changed:
                    changed = False
                    for c in cats:
                        if c["parent_id"] in target and c["id"] not in target:
                            target.add(int(c["id"]))
                            changed = True
                placeholders = ",".join("?" * len(target))
                where.append(f"f.category_id IN ({placeholders})")
                params.extend(list(target))
            else:
                where.append("f.category_id=?")
                params.append(category_id)
        elif unclassified:
            where.append("f.category_id IS NULL")

        where_sql = " AND ".join(where)

        total = db.execute(
            f"SELECT COUNT(1) as cnt FROM files f WHERE {where_sql}",
            tuple(params)
        ).fetchone()["cnt"]

        unclassified_count = db.execute(
            "SELECT COUNT(1) as cnt FROM files WHERE project_id=? AND category_id IS NULL",
            (project_id,)
        ).fetchone()["cnt"]

        rows = db.execute(f"""
            SELECT f.*, c.name as category_name
            FROM files f
            LEFT JOIN categories c ON f.category_id = c.id
            WHERE {where_sql}
            ORDER BY {order_by} {direction}
            LIMIT ? OFFSET ?
        """, (*params, limit, offset)).fetchall()

        return {
            "items": [dict(r) for r in rows],
            "total": int(total),
            "limit": int(limit),
            "offset": int(offset),
            "unclassified_count": int(unclassified_count),
        }
    finally:
        db.close()


@router.get("/projects/{project_id}/files/counts")
def file_counts(project_id: int):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT category_id, COUNT(1) as cnt FROM files WHERE project_id=? GROUP BY category_id",
            (project_id,)
        ).fetchall()
        direct_by_category = {}
        total = 0
        unclassified_count = 0
        for r in rows:
            cnt = int(r["cnt"])
            total += cnt
            if r["category_id"] is None:
                unclassified_count = cnt
            else:
                direct_by_category[int(r["category_id"])] = cnt

        cats = db.execute(
            "SELECT id, parent_id FROM categories WHERE project_id=?",
            (project_id,)
        ).fetchall()
        children = {}
        for c in cats:
            pid = c["parent_id"]
            if pid is None:
                continue
            children.setdefault(int(pid), []).append(int(c["id"]))

        agg_cache = {}
        def agg(cid: int) -> int:
            if cid in agg_cache:
                return agg_cache[cid]
            s = int(direct_by_category.get(cid, 0))
            for ch in children.get(cid, []):
                s += agg(ch)
            agg_cache[cid] = s
            return s

        by_category = {}
        for c in cats:
            by_category[int(c["id"])] = agg(int(c["id"]))

        return {
            "total": total,
            "unclassified_count": unclassified_count,
            "by_category": by_category,
            "direct_by_category": direct_by_category
        }
    finally:
        db.close()

@router.put("/files/batch")
def batch_update_category(req: BatchUpdateRequest):
    """Update category for multiple files."""
    if not req.file_ids:
        return {"ok": True, "updated": 0}

    db = get_db()
    placeholders = ",".join("?" * len(req.file_ids))

    # Verify all files exist
    existing = db.execute(
        f"SELECT id FROM files WHERE id IN ({placeholders})",
        tuple(req.file_ids)
    ).fetchall()
    existing_ids = {r["id"] for r in existing}

    if not existing_ids:
        db.close()
        raise HTTPException(404, "未找到文件")

    # Update in transaction
    placeholders_existing = ",".join("?" * len(existing_ids))
    db.execute(
        f"UPDATE files SET category_id = ? WHERE id IN ({placeholders_existing})",
        (req.category_id, *existing_ids)
    )

    db.commit()
    db.close()
    return {"ok": True, "updated": len(existing_ids)}

@router.get("/files/{file_id}/details")
def get_file_details(file_id: int):
    db = get_db()
    try:
        row = db.execute("""
            SELECT f.*, c.name as category_name, fc.extracted_at
            FROM files f
            LEFT JOIN categories c ON f.category_id = c.id
            LEFT JOIN file_content fc ON fc.file_id = f.id
            WHERE f.id=?
        """, (file_id,)).fetchone()
        if not row:
            raise HTTPException(404, "文件不存在")
        versions = db.execute(
            "SELECT COUNT(1) as cnt FROM file_versions WHERE file_id=?",
            (file_id,)
        ).fetchone()["cnt"]
        d = dict(row)
        d["version_count"] = int(versions)
        d["indexed"] = bool(d.get("extracted_at"))
        return d
    finally:
        db.close()

@router.put("/files/{file_id}")
def update_file(file_id: int, data: FileUpdate):
    db = get_db()
    fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.execute(f"UPDATE files SET {sets} WHERE id=?", (*fields.values(), file_id))
        db.commit()
    db.close()
    return {"ok": True}

@router.delete("/files/{file_id}")
def delete_file(file_id: int):
    db = get_db()
    db.execute("DELETE FROM ldd_mappings WHERE file_id=?", (file_id,))
    db.execute("DELETE FROM file_content WHERE file_id=?", (file_id,))
    db.execute("DELETE FROM file_content_fts WHERE rowid=?", (file_id,))
    db.execute("DELETE FROM file_versions WHERE file_id=?", (file_id,))
    db.execute("DELETE FROM files WHERE id=?", (file_id,))
    db.commit()
    db.close()
    return {"ok": True}


# ── Duplicate Detection ──────────────────────────────────────────────────────

@router.get("/projects/{project_id}/duplicates")
def get_duplicates(project_id: int):
    """Get list of duplicate files (same name + size)."""
    db = get_db()
    rows = db.execute("""
        SELECT f1.id as id1, f1.file_name as name1, f1.file_path as path1,
               f2.id as id2, f2.file_path as path2, f1.file_size
        FROM files f1
        JOIN files f2 ON f1.file_name = f2.file_name
                     AND f1.file_size = f2.file_size
                     AND f1.id < f2.id
        WHERE f1.project_id = ? AND f2.project_id = ?
        ORDER BY f1.file_name
    """, (project_id, project_id)).fetchall()
    db.close()

    groups = {}
    for r in rows:
        key = (r["name1"], r["file_size"])
        if key not in groups:
            groups[key] = {"file_name": r["name1"], "file_size": r["file_size"], "files": []}
        groups[key]["files"].append({"id": r["id1"], "path": r["path1"]})
        groups[key]["files"].append({"id": r["id2"], "path": r["path2"]})

    # Deduplicate files in groups
    for g in groups.values():
        seen = set()
        unique = []
        for f in g["files"]:
            if f["id"] not in seen:
                seen.add(f["id"])
                unique.append(f)
        g["files"] = unique

    return {"duplicate_groups": list(groups.values()), "group_count": len(groups)}


# ── Full-Text Search ──────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/search")
def search_files(
    project_id: int,
    q: str = Query(..., min_length=1, description="Search query"),
    category_id: Optional[int] = Query(None, description="Filter by category")
):
    """Full-text search across file content."""
    db = get_db()

    # Check if FTS5 is available
    try:
        db.execute("SELECT * FROM file_content_fts LIMIT 1")
        fts_available = True
    except Exception:
        fts_available = False

    results = []

    if fts_available:
        # Use FTS5 for search with snippets
        query = q
        sql = """
            SELECT f.id, f.file_name, f.file_path, f.category_id, c.name as category_name,
                   snippet(file_content_fts, 0, '[[[H]]]', '[[[/H]]]', '...', 64) as snippet,
                   bm25(file_content_fts) as score
            FROM file_content_fts
            JOIN file_content fc ON file_content_fts.rowid = fc.file_id
            JOIN files f ON fc.file_id = f.id
            LEFT JOIN categories c ON f.category_id = c.id
            WHERE file_content_fts MATCH ? AND f.project_id = ?
            ORDER BY score
            LIMIT 50
        """
        params = [query, project_id]
        if category_id:
            sql = sql.replace("WHERE file_content_fts MATCH ? AND f.project_id = ?", "WHERE file_content_fts MATCH ? AND f.project_id = ? AND f.category_id = ?")
            params.append(category_id)

        try:
            rows = db.execute(sql, params).fetchall()
            results = [dict(r) for r in rows]
        except Exception:
            # Fallback to LIKE search
            fts_available = False

    if not fts_available:
        # Fallback: search in file_content table with LIKE
        pattern = f"%{q}%"
        sql = """
            SELECT f.id, f.file_name, f.file_path, f.category_id, c.name as category_name,
                   substr(fc.content, 1, 200) as snippet
            FROM file_content fc
            JOIN files f ON fc.file_id = f.id
            LEFT JOIN categories c ON f.category_id = c.id
            WHERE fc.content LIKE ? AND f.project_id = ?
            LIMIT 50
        """
        params = [pattern, project_id]
        if category_id:
            sql = sql.replace("LIMIT 50", "AND f.category_id = ? LIMIT 50")
            params.insert(1, category_id)

        rows = db.execute(sql, params).fetchall()
        results = [dict(r) for r in rows]

    for r in results:
        s = r.get("snippet")
        if s is None:
            continue
        safe = html.escape(s)
        safe = safe.replace("[[[H]]]", "<mark>").replace("[[[/H]]]", "</mark>")
        r["snippet"] = safe

    db.close()
    return {"query": q, "results": results, "count": len(results), "fts_enabled": fts_available}


@router.post("/files/batch-rename")
def batch_rename(req: BatchRenameRequest, project_id: int):
    """Batch rename files with pattern."""
    if not req.file_ids:
        return {"ok": True, "renamed": []}

    from datetime import datetime

    db = get_db()
    project = db.execute("SELECT root_path FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        db.close()
        raise HTTPException(404, "项目不存在")

    root = project["root_path"]
    placeholders = ",".join("?" * len(req.file_ids))

    files = db.execute(
        f"SELECT id, file_name, file_path FROM files WHERE id IN ({placeholders}) AND project_id=?",
        (*req.file_ids, project_id)
    ).fetchall()

    renamed = []
    errors = []

    for i, f in enumerate(files, start=req.start_number):
        old_name = f["file_name"]
        base, ext = os.path.splitext(old_name)

        # Build new name based on pattern
        if req.pattern == "date":
            date_str = datetime.now().strftime("%Y%m%d")
            new_base = f"{date_str}_{base}"
        elif req.pattern == "sequence":
            new_base = f"{i:03d}_{base}"
        elif req.pattern == "prefix":
            new_base = f"{req.prefix or ''}{base}"
        elif req.pattern == "suffix":
            new_base = f"{base}{req.suffix or ''}"
        else:
            new_base = base

        new_name = f"{new_base}{ext}"

        # Check for collision in same directory
        old_path = f["file_path"]
        dir_path = os.path.dirname(old_path)
        new_path = os.path.join(dir_path, new_name).replace("\\", "/") if dir_path else new_name

        collision = db.execute(
            "SELECT id FROM files WHERE file_path = ? AND project_id = ? AND id != ?",
            (new_path, project_id, f["id"])
        ).fetchone()

        if collision:
            errors.append({"id": f["id"], "name": old_name, "error": "目标名称已存在"})
            continue

        # Rename physical file
        old_full = os.path.join(root, old_path)
        new_full = os.path.join(root, new_path)

        try:
            if os.path.isfile(old_full):
                os.rename(old_full, new_full)
        except Exception as e:
            errors.append({"id": f["id"], "name": old_name, "error": str(e)})
            continue

        # Create version before update
        create_version(db, f["id"], old_path, f.get("content_hash"), f.get("file_size", 0))

        # Update database
        db.execute(
            "UPDATE files SET file_name = ?, file_path = ? WHERE id = ?",
            (new_name, new_path, f["id"])
        )
        renamed.append({"id": f["id"], "old_name": old_name, "new_name": new_name})

    db.commit()
    db.close()

    return {"ok": True, "renamed": renamed, "errors": errors, "count": len(renamed)}


@router.post("/files/batch-delete")
def batch_delete(req: BatchDeleteRequest):
    """Delete multiple files."""
    if not req.file_ids:
        return {"ok": True, "deleted": 0}

    db = get_db()
    placeholders = ",".join("?" * len(req.file_ids))

    # Delete related records first
    db.execute(f"DELETE FROM ldd_mappings WHERE file_id IN ({placeholders})", tuple(req.file_ids))
    db.execute(f"DELETE FROM file_content WHERE file_id IN ({placeholders})", tuple(req.file_ids))
    try:
        db.execute(f"DELETE FROM file_content_fts WHERE rowid IN ({placeholders})", tuple(req.file_ids))
    except Exception:
        pass
    db.execute(f"DELETE FROM file_versions WHERE file_id IN ({placeholders})", tuple(req.file_ids))

    # Delete files
    cur = db.execute(f"DELETE FROM files WHERE id IN ({placeholders})", tuple(req.file_ids))
    deleted = cur.rowcount

    db.commit()
    db.close()
    return {"ok": True, "deleted": deleted}
