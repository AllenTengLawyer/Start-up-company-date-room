"""
File version history and rollback API.
"""
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..services.version_tracker import get_versions, rollback_to_version, create_version

router = APIRouter()


class RollbackRequest(BaseModel):
    version_id: int


@router.get("/files/{file_id}/versions")
def list_versions(file_id: int):
    """Get version history for a file."""
    db = get_db()

    # Verify file exists
    file = db.execute(
        "SELECT id, file_name, project_id FROM files WHERE id = ?",
        (file_id,)
    ).fetchone()

    if not file:
        db.close()
        raise HTTPException(404, "文件不存在")

    versions = get_versions(db, file_id)
    db.close()

    return {
        "file_id": file_id,
        "file_name": file["file_name"],
        "versions": versions,
        "count": len(versions)
    }


@router.post("/files/{file_id}/rollback")
def rollback_file(file_id: int, req: RollbackRequest):
    """Rollback file to a specific version."""
    db = get_db()

    # Get file info and project root
    file = db.execute(
        """SELECT f.*, p.root_path
           FROM files f
           JOIN projects p ON f.project_id = p.id
           WHERE f.id = ?""",
        (file_id,)
    ).fetchone()

    if not file:
        db.close()
        raise HTTPException(404, "文件不存在")

    try:
        result = rollback_to_version(db, file_id, req.version_id, file["root_path"])
        db.commit()
        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"回滚失败: {str(e)}")
    finally:
        db.close()


@router.delete("/versions/{version_id}")
def delete_version(version_id: int):
    """Delete a specific version (does not affect current file)."""
    db = get_db()

    version = db.execute(
        "SELECT * FROM file_versions WHERE id = ?",
        (version_id,)
    ).fetchone()

    if not version:
        db.close()
        raise HTTPException(404, "版本不存在")

    db.execute("DELETE FROM file_versions WHERE id = ?", (version_id,))
    db.commit()
    db.close()

    return {"ok": True}


@router.post("/files/{file_id}/versions/cleanup")
def cleanup_versions(file_id: int, keep_count: int = 10):
    """Clean up old versions, keeping only the most recent N."""
    from ..services.version_tracker import cleanup_old_versions

    db = get_db()

    # Verify file exists
    file = db.execute("SELECT id FROM files WHERE id = ?", (file_id,)).fetchone()
    if not file:
        db.close()
        raise HTTPException(404, "文件不存在")

    # Count versions before cleanup
    before = db.execute(
        "SELECT COUNT(*) as n FROM file_versions WHERE file_id = ?",
        (file_id,)
    ).fetchone()["n"]

    cleanup_old_versions(db, file_id, keep_count)

    # Count versions after cleanup
    after = db.execute(
        "SELECT COUNT(*) as n FROM file_versions WHERE file_id = ?",
        (file_id,)
    ).fetchone()["n"]

    db.commit()
    db.close()

    return {
        "ok": True,
        "deleted": before - after,
        "remaining": after
    }
