from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..database import get_db

router = APIRouter()

class FounderCreate(BaseModel):
    name: str
    role: Optional[str] = None
    id_number: Optional[str] = None
    join_date: Optional[str] = None
    employment_type: str = "full_time"
    notes: Optional[str] = None

class FounderUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    id_number: Optional[str] = None
    join_date: Optional[str] = None
    employment_type: Optional[str] = None
    notes: Optional[str] = None

class ChecklistUpdate(BaseModel):
    status: str
    statement: Optional[str] = None

class FounderFileCreate(BaseModel):
    item_code: Optional[str] = None
    file_name: str
    file_path: str
    notes: Optional[str] = None

FOUNDER_CHECKLIST = [
    {"code": "A1", "dimension": "A", "title": "姓名", "title_en": "Full Name", "item_type": "statement", "risk_level": "low"},
    {"code": "A2", "dimension": "A", "title": "国籍", "title_en": "Nationality", "item_type": "statement", "risk_level": "low"},
    {"code": "A3", "dimension": "A", "title": "身份证号", "title_en": "ID Number", "item_type": "statement", "risk_level": "low"},
    {"code": "A4", "dimension": "A", "title": "团队角色", "title_en": "Role in Team", "item_type": "statement", "risk_level": "low"},
    {"code": "A5", "dimension": "A", "title": "加入时间及全职/兼职状态", "title_en": "Join Date & Employment Type", "item_type": "statement", "risk_level": "medium"},
    {"code": "A6", "dimension": "A", "title": "个人简历（以时间为序，含所有任职经历）", "title_en": "CV (chronological, all positions)", "item_type": "file", "risk_level": "medium"},
    {"code": "B1", "dimension": "B", "title": "与前任职单位签署的劳动合同", "title_en": "Labor contract with prior employer", "item_type": "file", "risk_level": "high"},
    {"code": "B2", "dimension": "B", "title": "与前任职单位签署的保密协议", "title_en": "Confidentiality agreement with prior employer", "item_type": "file", "risk_level": "high"},
    {"code": "B3", "dimension": "B", "title": "与前任职单位签署的竞业限制协议（含期限、范围、补偿标准）", "title_en": "Non-compete agreement with prior employer (term, scope, compensation)", "item_type": "file", "risk_level": "high"},
    {"code": "B4", "dimension": "B", "title": "与前任职单位签署的知识产权归属协议", "title_en": "IP assignment agreement with prior employer", "item_type": "file", "risk_level": "high"},
    {"code": "B5", "dimension": "B", "title": "前任职单位出具的离职证明", "title_en": "Departure certificate from prior employer", "item_type": "file", "risk_level": "high"},
    {"code": "B6", "dimension": "B", "title": "竞业限制到期证明 / 豁免函（如适用）", "title_en": "Non-compete expiry certificate / waiver (if applicable)", "item_type": "file", "risk_level": "high"},
    {"code": "C1", "dimension": "C", "title": "是否持有与新业务相关的个人知识产权（专利、商标、软著）", "title_en": "Personal IP related to new business (patents, trademarks, software copyrights)", "item_type": "statement", "risk_level": "high"},
    {"code": "C2", "dimension": "C", "title": "是否存在在前雇主任职期间完成的、可能被认定为职务发明的技术", "title_en": "Any technology developed at prior employer that may be deemed employee invention", "item_type": "statement", "risk_level": "high"},
    {"code": "C3", "dimension": "C", "title": "是否存在与前雇主或第三方的IP纠纷", "title_en": "Any IP disputes with prior employer or third parties", "item_type": "statement", "risk_level": "high"},
    {"code": "D1", "dimension": "D", "title": "目前在其他公司的持股情况（含配偶/亲属代持）", "title_en": "Current shareholdings in other companies (including nominee holdings by spouse/relatives)", "item_type": "statement", "risk_level": "medium"},
    {"code": "D2", "dimension": "D", "title": "目前在其他公司的任职情况", "title_en": "Current positions at other companies", "item_type": "statement", "risk_level": "medium"},
    {"code": "D3", "dimension": "D", "title": "上述公司与新业务是否存在竞争关系", "title_en": "Whether above companies compete with the new business", "item_type": "statement", "risk_level": "high"},
    {"code": "E1", "dimension": "E", "title": "是否涉及刑事案件", "title_en": "Involved in any criminal cases", "item_type": "statement", "risk_level": "high"},
    {"code": "E2", "dimension": "E", "title": "是否涉及民事诉讼 / 仲裁", "title_en": "Involved in civil litigation / arbitration", "item_type": "statement", "risk_level": "high"},
    {"code": "E3", "dimension": "E", "title": "是否涉及行政处罚", "title_en": "Subject to administrative penalties", "item_type": "statement", "risk_level": "high"},
    {"code": "E4", "dimension": "E", "title": "是否被列为失信被执行人", "title_en": "Listed as dishonest judgment debtor", "item_type": "statement", "risk_level": "high"},
    {"code": "F1", "dimension": "F", "title": "与前创业项目投资人/股东签署的协议", "title_en": "Agreements with prior startup investors/shareholders", "item_type": "file", "risk_level": "medium"},
    {"code": "F2", "dimension": "F", "title": "前创业项目的退出文件（股权转让协议、注销文件等）", "title_en": "Exit documents from prior startup (equity transfer, dissolution, etc.)", "item_type": "file", "risk_level": "medium"},
    {"code": "F3", "dimension": "F", "title": "是否存在未了结的债务或纠纷", "title_en": "Any outstanding debts or disputes from prior startup", "item_type": "statement", "risk_level": "high"},
]

DIMENSION_LABELS = {
    "A": {"zh": "基本信息", "en": "Basic Information"},
    "B": {"zh": "前雇主劳动关系", "en": "Prior Employment"},
    "C": {"zh": "知识产权清洁性", "en": "IP Cleanliness"},
    "D": {"zh": "对外投资与任职", "en": "External Investments & Positions"},
    "E": {"zh": "纠纷与诉讼", "en": "Disputes & Litigation"},
    "F": {"zh": "前创业项目", "en": "Prior Startups"},
}

@router.get("/projects/{project_id}/founders")
def list_founders(project_id: int):
    db = get_db()
    rows = db.execute("SELECT * FROM founders WHERE project_id=?", (project_id,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

@router.post("/projects/{project_id}/founders", status_code=201)
def create_founder(project_id: int, data: FounderCreate):
    db = get_db()
    cur = db.execute(
        "INSERT INTO founders (project_id, name, role, id_number, join_date, employment_type, notes) VALUES (?,?,?,?,?,?,?)",
        (project_id, data.name, data.role, data.id_number, data.join_date, data.employment_type, data.notes)
    )
    db.commit()
    founder_id = cur.lastrowid
    db.close()
    return {"id": founder_id}

@router.put("/founders/{founder_id}")
def update_founder(founder_id: int, data: FounderUpdate):
    db = get_db()
    fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        db.execute(f"UPDATE founders SET {sets} WHERE id=?", (*fields.values(), founder_id))
        db.commit()
    db.close()
    return {"ok": True}

@router.delete("/founders/{founder_id}")
def delete_founder(founder_id: int):
    db = get_db()
    db.execute("DELETE FROM founder_files WHERE founder_id=?", (founder_id,))
    db.execute("DELETE FROM founder_checklist_status WHERE founder_id=?", (founder_id,))
    db.execute("DELETE FROM founders WHERE id=?", (founder_id,))
    db.commit()
    db.close()
    return {"ok": True}

@router.get("/founders/{founder_id}/checklist")
def get_checklist(founder_id: int):
    db = get_db()
    statuses = {
        r["item_code"]: dict(r)
        for r in db.execute("SELECT * FROM founder_checklist_status WHERE founder_id=?", (founder_id,)).fetchall()
    }
    files_by_code = {}
    for f in db.execute("SELECT * FROM founder_files WHERE founder_id=?", (founder_id,)).fetchall():
        code = f["item_code"] or ""
        files_by_code.setdefault(code, []).append(dict(f))
    db.close()

    result = []
    for item in FOUNDER_CHECKLIST:
        s = statuses.get(item["code"], {})
        result.append({
            **item,
            "status": s.get("status", "pending"),
            "statement": s.get("statement", ""),
            "files": files_by_code.get(item["code"], []),
        })
    return {"items": result, "dimensions": DIMENSION_LABELS}

@router.put("/founders/{founder_id}/checklist/{item_code}")
def update_checklist_item(founder_id: int, item_code: str, data: ChecklistUpdate):
    db = get_db()
    db.execute(
        """INSERT INTO founder_checklist_status (founder_id, item_code, status, statement, updated_at)
           VALUES (?,?,?,?, CURRENT_TIMESTAMP)
           ON CONFLICT(founder_id, item_code) DO UPDATE SET
           status=excluded.status, statement=excluded.statement, updated_at=excluded.updated_at""",
        (founder_id, item_code, data.status, data.statement)
    )
    db.commit()
    db.close()
    return {"ok": True}

@router.post("/founders/{founder_id}/files", status_code=201)
def add_founder_file(founder_id: int, data: FounderFileCreate):
    db = get_db()
    cur = db.execute(
        "INSERT INTO founder_files (founder_id, item_code, file_name, file_path, notes) VALUES (?,?,?,?,?)",
        (founder_id, data.item_code, data.file_name, data.file_path, data.notes)
    )
    db.commit()
    fid = cur.lastrowid
    db.close()
    return {"id": fid}

@router.get("/founders/{founder_id}/files")
def list_founder_files(founder_id: int):
    db = get_db()
    rows = db.execute("SELECT * FROM founder_files WHERE founder_id=?", (founder_id,)).fetchall()
    db.close()
    return [dict(r) for r in rows]

@router.delete("/founder-files/{file_id}")
def delete_founder_file(file_id: int):
    db = get_db()
    db.execute("DELETE FROM founder_files WHERE id=?", (file_id,))
    db.commit()
    db.close()
    return {"ok": True}
