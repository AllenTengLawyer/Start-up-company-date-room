"""
Version tracking service for file history and rollback.
"""
from datetime import datetime
from typing import Optional, List, Dict


def create_version(db, file_id: int, file_path: str, content_hash: Optional[str],
                   file_size: int = 0) -> Optional[int]:
    """
    Create a new version record for a file.
    Returns the version ID if created, None if skipped (duplicate).
    """
    # Get the latest version number
    latest = db.execute(
        "SELECT version_no, content_hash FROM file_versions WHERE file_id = ? ORDER BY version_no DESC LIMIT 1",
        (file_id,)
    ).fetchone()

    # Skip if hash hasn't changed
    if latest and latest["content_hash"] == content_hash:
        return None

    version_no = (latest["version_no"] + 1) if latest else 1

    cur = db.execute(
        """INSERT INTO file_versions (file_id, version_no, file_path, content_hash, file_size, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))""",
        (file_id, version_no, file_path, content_hash, file_size)
    )

    return cur.lastrowid


def get_versions(db, file_id: int) -> List[Dict]:
    """Get all versions for a file, ordered by version number (newest first)."""
    rows = db.execute(
        """SELECT id, version_no, file_path, content_hash, file_size, created_at
           FROM file_versions
           WHERE file_id = ?
           ORDER BY version_no DESC""",
        (file_id,)
    ).fetchall()

    return [dict(r) for r in rows]


def get_version(db, version_id: int) -> Optional[Dict]:
    """Get a specific version by ID."""
    row = db.execute(
        """SELECT id, file_id, version_no, file_path, content_hash, file_size, created_at
           FROM file_versions WHERE id = ?""",
        (version_id,)
    ).fetchone()

    return dict(row) if row else None


def rollback_to_version(db, file_id: int, version_id: int, project_root: str) -> Dict:
    """
    Rollback file to a specific version.
    Creates a new version with the old state (swap operation).
    """
    import os

    # Get current file state
    current = db.execute(
        "SELECT file_path, content_hash, file_size FROM files WHERE id = ?",
        (file_id,)
    ).fetchone()

    if not current:
        raise ValueError("File not found")

    # Get target version
    target = get_version(db, version_id)
    if not target:
        raise ValueError("Version not found")

    if target["file_id"] != file_id:
        raise ValueError("Version does not belong to this file")

    current_path = current["file_path"]
    target_path = target["file_path"]

    # Check if we need to rename physical file
    current_full = os.path.join(project_root, current_path)
    target_full = os.path.join(project_root, target_path)

    # If paths differ and target file exists, we need to swap
    if current_path != target_path:
        if os.path.exists(target_full):
            # Target file exists on disk - this is a swap
            temp_path = target_full + ".rollback_tmp"
            os.rename(current_full, temp_path)
            os.rename(target_full, current_full)
            os.rename(temp_path, target_full)
        else:
            # Target file doesn't exist - just rename current
            os.rename(current_full, target_full)

    # Create new version for the "before rollback" state (for undo capability)
    create_version(db, file_id, current["file_path"], current["content_hash"],
                   current["file_size"])

    # Update file record to target version
    db.execute(
        """UPDATE files
           SET file_path = ?, content_hash = ?, file_size = ?
           WHERE id = ?""",
        (target["file_path"], target["content_hash"], target["file_size"], file_id)
    )

    return {
        "file_id": file_id,
        "rolled_back_to_version": target["version_no"],
        "new_path": target["file_path"],
        "previous_path": current["file_path"]
    }


def compare_versions(db, version_id1: int, version_id2: int) -> Dict:
    """Compare two versions and return differences."""
    v1 = get_version(db, version_id1)
    v2 = get_version(db, version_id2)

    if not v1 or not v2:
        raise ValueError("Version not found")

    return {
        "path_changed": v1["file_path"] != v2["file_path"],
        "old_path": v1["file_path"],
        "new_path": v2["file_path"],
        "hash_changed": v1["content_hash"] != v2["content_hash"],
        "size_changed": v1["file_size"] != v2["file_size"],
        "old_size": v1["file_size"],
        "new_size": v2["file_size"]
    }


def cleanup_old_versions(db, file_id: int, keep_count: int = 10):
    """Remove old versions, keeping only the most recent N versions."""
    db.execute(
        """DELETE FROM file_versions
           WHERE file_id = ?
           AND id NOT IN (
               SELECT id FROM file_versions
               WHERE file_id = ?
               ORDER BY version_no DESC
               LIMIT ?
           )""",
        (file_id, file_id, keep_count)
    )
