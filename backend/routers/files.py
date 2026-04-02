import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db

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
    rows = db.execute("SELECT id, name FROM categories WHERE project_id=?", (project_id,)).fetchall()
    return [dict(r) for r in rows]

class FileRegister(BaseModel):
    file_name: str
    file_path: str
    category_id: Optional[int] = None
    notes: Optional[str] = None
    keyword_suggested: int = 0

class FileUpdate(BaseModel):
    category_id: Optional[int] = None
    notes: Optional[str] = None

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
        r["file_path"]
        for r in db.execute("SELECT file_path FROM files WHERE project_id=?", (project_id,)).fetchall()
    }
    categories = get_all_categories_flat(db, project_id)
    db.close()

    found = []
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
            if rel_path in registered:
                continue
            suggested_id = suggest_category(fname, categories)
            found.append({
                "file_name": fname,
                "file_path": rel_path,
                "suggested_category_id": suggested_id,
                "suggested_category_name": next(
                    (c["name"] for c in categories if c["id"] == suggested_id), None
                ) if suggested_id else None,
            })
    return {"files": found, "count": len(found)}

@router.post("/projects/{project_id}/files", status_code=201)
def register_files(project_id: int, files: List[FileRegister]):
    db = get_db()
    ids = []
    for f in files:
        cur = db.execute(
            "INSERT INTO files (project_id, category_id, file_name, file_path, notes, keyword_suggested) VALUES (?,?,?,?,?,?)",
            (project_id, f.category_id, f.file_name, f.file_path, f.notes, f.keyword_suggested)
        )
        ids.append(cur.lastrowid)
    db.commit()
    db.close()
    return {"ids": ids}

@router.get("/projects/{project_id}/files")
def list_files(project_id: int):
    db = get_db()
    rows = db.execute("""
        SELECT f.*, c.name as category_name
        FROM files f
        LEFT JOIN categories c ON f.category_id = c.id
        WHERE f.project_id=?
        ORDER BY f.registered_at DESC
    """, (project_id,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

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
    db.execute("DELETE FROM files WHERE id=?", (file_id,))
    db.commit()
    db.close()
    return {"ok": True}
