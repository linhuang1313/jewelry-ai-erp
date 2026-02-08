from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..fbl_database import get_fbl_db
from typing import Optional, List, Dict, Any
from datetime import date, datetime
import logging
import json
import os
from pydantic import BaseModel

router = APIRouter(prefix="/api/fbl-finance", tags=["梵贝琳财务系统"])
logger = logging.getLogger(__name__)

@router.get("/connection-test")
async def test_connection(db: Session = Depends(get_fbl_db)):
    """
    测试与梵贝琳财务数据库的连接
    """
    try:
        # 执行简单的查询来验证连接
        result = db.execute(text("SELECT 1"))
        row = result.fetchone()
        
        return {
            "success": True,
            "message": "已成功连接到梵贝琳财务数据库",
            "data": {
                "result": row[0] if row else None,
                "database": "fbl_finance_data"
            }
        }
    except Exception as e:
        logger.error(f"梵贝琳数据库连接测试失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"连接失败: {str(e)}",
            "error": str(e)
        }

@router.get("/voucher-types")
async def get_voucher_types(db: Session = Depends(get_fbl_db)):
    """获取所有凭证类别"""
    try:
        result = db.execute(text("SELECT id, name FROM aa_doctype ORDER BY id"))
        types = [dict(row._mapping) for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/accounts")
async def get_accounts(db: Session = Depends(get_fbl_db)):
    """获取所有末级科目"""
    try:
        # Fetch accounts that are leaf nodes (isEndNode = 1) and not disabled
        # Note: Adjust 'isEndNode' and 'disabled' based on actual schema if needed.
        # Based on schema analysis: isEndNode (INTEGER), disabled (INTEGER)
        query = text("""
            SELECT id, code, name 
            FROM aa_account 
            WHERE "isEndNode" = 1 AND (disabled IS NULL OR disabled = 0)
            ORDER BY code
        """)
        result = db.execute(query)
        accounts = [dict(row._mapping) for row in result]
        return {"success": True, "data": accounts}
    except Exception as e:
        logger.error(f"获取科目列表失败: {e}")
        return {"success": False, "message": str(e)}

class VoucherEntryCreate(BaseModel):
    summary: str
    account_id: int
    debit: float
    credit: float

class VoucherCreate(BaseModel):
    voucher_date: str
    voucher_type_id: int
    entry_rows: List[VoucherEntryCreate]
    maker: str = "System"  # Default maker

@router.post("/vouchers")
async def create_voucher(voucher: VoucherCreate, db: Session = Depends(get_fbl_db)):
    """创建新凭证"""
    try:
        # 1. Validation
        total_debit = sum(e.debit for e in voucher.entry_rows)
        total_credit = sum(e.credit for e in voucher.entry_rows)
        
        if abs(total_debit - total_credit) > 0.000001:
             return {"success": False, "message": "借贷不平衡"}

        # 2. Transaction
        # Parse date
        v_date = datetime.strptime(voucher.voucher_date, "%Y-%m-%d")
        year = v_date.year
        period = v_date.month

        # Generate Code (Simple Max + 1 logic for now)
        # Find max code for this period and type
        # Note: This is a simplified generation. FBL might have complex logic.
        max_code_query = text("""
            SELECT MAX(code) FROM gl_doc 
            WHERE accountingyear = :year AND accountingperiod = :period AND iddoctype = :type_id
        """)
        max_code_res = db.execute(max_code_query, {"year": year, "period": period, "type_id": voucher.voucher_type_id}).scalar()
        
        new_code_num = 1
        if max_code_res:
            try:
                # Assuming code format is purely numeric or ends with numbers
                # T+ code is usually just a number string?
                new_code_num = int(max_code_res) + 1
            except:
                pass # Fallback to 1 if parsing fails
        
        # Format code? Keeping it simple str(num) for now as schema says varchar
        new_code = f"{new_code_num:04d}" # Pad with zeros? e.g. 0001
        
        # Generate ID manually as it has no default
        max_id_query = text("SELECT MAX(id) FROM gl_doc")
        max_id = db.execute(max_id_query).scalar()
        new_doc_id = (max_id or 0) + 1
        
        # Insert Header
        insert_doc_query = text("""
            INSERT INTO gl_doc (
                id, code, voucherdate, iddoctype, 
                maker, accountingyear, accountingperiod, 
                createdtime, docbusinesstype, docsourcetype, "PrintCount"
            ) VALUES (
                :id, :code, :date, :type_id, 
                :maker, :year, :period, 
                NOW(), 0, 0, 0
            )
        """)
        
        db.execute(insert_doc_query, {
            "id": new_doc_id,
            "code": new_code,
            "date": v_date,
            "type_id": voucher.voucher_type_id,
            "maker": voucher.maker,
            "year": year,
            "period": period
        })
        
        doc_id = new_doc_id
        
        # Get starting ID for entries
        max_entry_id_query = text("SELECT MAX(id) FROM gl_entry")
        max_entry_id = db.execute(max_entry_id_query).scalar()
        current_entry_id = (max_entry_id or 0)

        # Insert Entries
        insert_entry_query = text("""
            INSERT INTO gl_entry (
                id, "idDocDTO", summary, idaccount, 
                amountdr, amountcr,
                origamountdr, origamountcr,
                sequencenumber,
                idcurrency, exchangerate
            ) VALUES (
                :id, :doc_id, :summary, :account_id, 
                :debit, :credit,
                :debit, :credit,
                :seq,
                1, 1.0
            )
        """)
        
        for idx, entry in enumerate(voucher.entry_rows):
            current_entry_id += 1
            db.execute(insert_entry_query, {
                "id": current_entry_id,
                "doc_id": doc_id,
                "summary": entry.summary,
                "account_id": entry.account_id,
                "debit": entry.debit,
                "credit": entry.credit,
                "seq": idx + 1
            })
            
        db.commit()
        
        return {"success": True, "message": "凭证创建成功", "data": {"id": doc_id, "code": new_code}}

    except Exception as e:
        db.rollback()
        logger.error(f"创建凭证失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建失败: {str(e)}"
        }

@router.delete("/vouchers/{voucher_id}")
async def delete_voucher(voucher_id: int, db: Session = Depends(get_fbl_db)):
    """删除凭证"""
    try:
        # Check if exists
        check_query = text("SELECT id FROM gl_doc WHERE id = :id")
        if not db.execute(check_query, {"id": voucher_id}).fetchone():
            return {"success": False, "message": "凭证不存在"}

        # Delete entries first
        delete_entries = text('DELETE FROM gl_entry WHERE "idDocDTO" = :id')
        db.execute(delete_entries, {"id": voucher_id})

        # Delete doc
        delete_doc = text("DELETE FROM gl_doc WHERE id = :id")
        db.execute(delete_doc, {"id": voucher_id})

        db.commit()
        return {"success": True, "message": "删除成功"}
    except Exception as e:
        db.rollback()
        logger.error(f"删除凭证失败: {e}")
        return {"success": False, "message": str(e)}

# --- Financial Admin Management ---
DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "financial_admins.json")

def load_admins():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Support both old format (list of strings) and new format (list of objects)
            if data and isinstance(data[0], str):
                # Convert old format to new format with auto-incrementing IDs
                return [{"id": f"FA{str(i+1).zfill(3)}", "name": name} for i, name in enumerate(data)]
            return data
    except:
        return []

def save_admins(admins):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(admins, f, ensure_ascii=False, indent=2)

class AdminCreate(BaseModel):
    name: str

@router.get("/admins")
async def get_admins():
    """获取财务管理员列表"""
    try:
        admins = load_admins()
        return {"success": True, "data": admins}
    except Exception as e:
        logger.error(f"获取管理员列表失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/admins")
async def add_admin(admin: AdminCreate):
    """添加财务管理员"""
    try:
        admins = load_admins()
        
        # Check if name already exists
        if any(a["name"] == admin.name for a in admins):
            return {"success": False, "message": "管理员已存在"}
        
        # Generate new ID
        if admins:
            # Find max ID number and increment
            max_num = max([int(a["id"][2:]) for a in admins])  # Extract number from "FA001" format
            new_id = f"FA{str(max_num + 1).zfill(3)}"
        else:
            new_id = "FA001"
        
        new_admin = {"id": new_id, "name": admin.name}
        admins.append(new_admin)
        save_admins(admins)
        return {"success": True, "message": "添加成功", "data": admins}
    except Exception as e:
        logger.error(f"添加管理员失败: {e}")
        return {"success": False, "message": str(e)}

@router.delete("/admins/{name}")
async def delete_admin(name: str):
    """删除财务管理员"""
    try:
        admins = load_admins()
        
        # Find admin by name
        admin_to_delete = next((a for a in admins if a["name"] == name), None)
        if not admin_to_delete:
            return {"success": False, "message": "管理员不存在"}
        
        admins.remove(admin_to_delete)
        save_admins(admins)
        return {"success": True, "message": "删除成功", "data": admins}
    except Exception as e:
        logger.error(f"删除管理员失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/vouchers")
async def get_vouchers(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=10000, description="每页数量"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    voucher_code: Optional[str] = Query(None, description="凭证号/外部单号"),
    account_code: Optional[str] = Query(None, description="科目代码/名称"),
    voucher_type: Optional[str] = Query(None, description="凭证类别ID"),
    related_unit: Optional[str] = Query(None, description="往来单位"),
    maker: Optional[str] = Query(None, description="制单人"),
    db: Session = Depends(get_fbl_db)
):
    """
    获取梵贝琳凭证列表
    
    支持按日期、凭证号、科目、凭证类别、往来单位筛选
    """
    try:
        # 1. Build FROM and WHERE clauses first to separate Count and Data queries
        from_where = """
            FROM gl_doc d
            LEFT JOIN aa_doctype dt ON d.iddoctype = dt.id
            WHERE 1=1
        """
        
        params = {}
        
        if start_date:
            from_where += " AND d.voucherdate >= :start_date"
            params["start_date"] = start_date
            
        if end_date:
            from_where += " AND d.voucherdate <= :end_date"
            params["end_date"] = end_date
            
        if voucher_code:
            from_where += " AND d.code LIKE :voucher_code"
            params["voucher_code"] = f"%{voucher_code}%"
            
        if account_code:
            # Use EXISTS for account filter
            from_where += """
                AND EXISTS (
                    SELECT 1 FROM gl_entry ae 
                    JOIN aa_account aa ON ae.idaccount = aa.id 
                    WHERE ae."idDocDTO" = d.id 
                    AND (aa.code LIKE :account_code OR aa.name LIKE :account_code)
                )
            """
            params["account_code"] = f"%{account_code}%"

        if voucher_type:
            # Assuming voucher_type param is the ID
            try:
                type_id = int(voucher_type)
                from_where += " AND d.iddoctype = :voucher_type"
                params["voucher_type"] = type_id
            except ValueError:
                # If string name passed, handle differently or ignore
                pass

        if related_unit:
            # Use EXISTS subquery
            from_where += """
                AND EXISTS (
                    SELECT 1 FROM gl_entry sub_e 
                    WHERE sub_e."idDocDTO" = d.id 
                    AND sub_e."AuxiliaryItems" LIKE :related_unit
                )
            """
            params["related_unit"] = f"%{related_unit}%"

        if maker:
            from_where += " AND d.maker LIKE :maker"
            params["maker"] = f"%{maker}%"
                
        # 2. Count total (using only FROM/WHERE, no heavy subqueries)
        count_query = text(f"SELECT COUNT(*) {from_where}")
        total = db.execute(count_query, params).scalar()
        
        # 3. Data query using CTE for performance to ensure subquery only runs on paged results
        data_query = f"""
            WITH paged_vouchers AS (
                SELECT 
                    d.id, 
                    d.code, 
                    d.voucherdate as voucher_date, 
                    d.maker,
                    dt.name as voucher_type_name
                {from_where}
                ORDER BY d.voucherdate DESC, d.code DESC
                LIMIT :limit OFFSET :offset
            )
            SELECT 
                pv.*,
                (
                    SELECT STRING_AGG(DISTINCT sub_e."AuxiliaryItems", ', ') 
                    FROM gl_entry sub_e 
                    WHERE sub_e."idDocDTO" = pv.id 
                    AND sub_e."AuxiliaryItems" IS NOT NULL 
                    AND sub_e."AuxiliaryItems" != ''
                ) as related_units
            FROM paged_vouchers pv
            ORDER BY pv.voucher_date DESC, pv.code DESC
        """
        
        params["limit"] = page_size
        params["offset"] = (page - 1) * page_size
        
        result = db.execute(text(data_query), params)
        
        vouchers = []
        for row in result:
            voucher = dict(row._mapping)
            
            # 2. Get entries for each voucher
            entries_query = text("""
                SELECT 
                    e.summary, 
                    a.code as account_code, 
                    a.name as account_name, 
                    e.amountdr as debit, 
                    e.amountcr as credit
                FROM gl_entry e
                LEFT JOIN aa_account a ON e.idaccount = a.id
                WHERE e."idDocDTO" = :doc_id
            """)
            entries_result = db.execute(entries_query, {"doc_id": voucher["id"]})
            entries = [dict(e._mapping) for e in entries_result]
            
            # Calculate totals
            total_dr = sum(e["debit"] or 0 for e in entries)
            total_cr = sum(e["credit"] or 0 for e in entries)
            
            vouchers.append({
                **voucher,
                "voucher_date": voucher["voucher_date"].strftime("%Y-%m-%d") if voucher.get("voucher_date") else None,
                "entries": entries,
                "total_dr": total_dr,
                "total_cr": total_cr
            })
        
        return {
            "success": True,
            "data": vouchers,
            "total": total,
            "page": page,
            "page_size": page_size
        }
        
    except Exception as e:
        logger.error(f"获取凭证列表失败: {e}", exc_info=True)
        # 提供更详细的错误信息，特别是如果是表不存在
        error_msg = str(e)
        if "relation" in error_msg and "does not exist" in error_msg:
             return {
                "success": False,
                "message": f"查询失败: 表名可能不正确。请确认梵贝琳数据库中凭证表名是否为 gl_doc? 错误信息: {error_msg}",
                "error": error_msg
            }
            
        return {
            "success": False,
            "message": f"获取凭证列表失败: {error_msg}",
            "error": error_msg
        }

# ==================== Settings APIs ====================

# --- Accounts (aa_account) ---
@router.get("/settings/accounts")
async def get_settings_accounts(db: Session = Depends(get_fbl_db)):
    """获取所有科目（按 code 去重并按层级排序）"""
    try:
        # 使用 DISTINCT ON (code) 按 code 去重，只取每个 code 的第一条记录
        result = db.execute(text('''
            SELECT DISTINCT ON (code) id, code, name, disabled, "idParent", depth
            FROM aa_account
            ORDER BY code, id
        '''))
        accounts = [dict(row._mapping) for row in result]
        return {"success": True, "data": accounts}
    except Exception as e:
        logger.error(f"获取科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/accounts")
async def create_account(data: dict, db: Session = Depends(get_fbl_db)):
    """创建科目"""
    try:
        query = text("INSERT INTO aa_account (code, name, disabled) VALUES (:code, :name, 0) RETURNING id")
        result = db.execute(query, {"code": data.get("code"), "name": data.get("name")})
        new_id = result.fetchone()[0]
        db.commit()
        return {"success": True, "data": {"id": new_id}}
    except Exception as e:
        db.rollback()
        logger.error(f"创建科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.put("/settings/accounts/{id}")
async def update_account(id: int, data: dict, db: Session = Depends(get_fbl_db)):
    """更新科目"""
    try:
        query = text("UPDATE aa_account SET code = :code, name = :name WHERE id = :id")
        db.execute(query, {"id": id, "code": data.get("code"), "name": data.get("name")})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"更新科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.delete("/settings/accounts/{id}")
async def delete_account(id: int, db: Session = Depends(get_fbl_db)):
    """删除科目"""
    try:
        db.execute(text("DELETE FROM aa_account WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除科目失败: {e}")
        return {"success": False, "message": str(e)}

# --- Voucher Types (aa_doctype) ---
@router.get("/settings/voucher-types")
async def get_settings_voucher_types(db: Session = Depends(get_fbl_db)):
    """获取所有凭证类别"""
    try:
        result = db.execute(text("SELECT id, code, name, docword, disabled FROM aa_doctype ORDER BY id"))
        types = [dict(row._mapping) for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/voucher-types")
async def create_voucher_type(data: dict, db: Session = Depends(get_fbl_db)):
    """创建凭证类别"""
    try:
        query = text("INSERT INTO aa_doctype (code, name, docword, disabled) VALUES (:code, :name, :docword, 0) RETURNING id")
        result = db.execute(query, {"code": data.get("code"), "name": data.get("name"), "docword": data.get("docword", "")})
        new_id = result.fetchone()[0]
        db.commit()
        return {"success": True, "data": {"id": new_id}}
    except Exception as e:
        db.rollback()
        logger.error(f"创建凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.put("/settings/voucher-types/{id}")
async def update_voucher_type(id: int, data: dict, db: Session = Depends(get_fbl_db)):
    """更新凭证类别"""
    try:
        query = text("UPDATE aa_doctype SET code = :code, name = :name, docword = :docword WHERE id = :id")
        db.execute(query, {"id": id, "code": data.get("code"), "name": data.get("name"), "docword": data.get("docword", "")})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"更新凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.delete("/settings/voucher-types/{id}")
async def delete_voucher_type(id: int, db: Session = Depends(get_fbl_db)):
    """删除凭证类别"""
    try:
        db.execute(text("DELETE FROM aa_doctype WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

# --- Partners (aa_partner) ---
@router.get("/settings/partners")
async def get_partners(db: Session = Depends(get_fbl_db)):
    """获取所有往来单位"""
    try:
        result = db.execute(text("SELECT id, code, name, disabled FROM aa_partner ORDER BY code"))
        partners = [dict(row._mapping) for row in result]
        return {"success": True, "data": partners}
    except Exception as e:
        logger.error(f"获取往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/partners")
async def create_partner(data: dict, db: Session = Depends(get_fbl_db)):
    """创建往来单位"""
    try:
        query = text("INSERT INTO aa_partner (code, name, disabled) VALUES (:code, :name, 0) RETURNING id")
        result = db.execute(query, {"code": data.get("code"), "name": data.get("name")})
        new_id = result.fetchone()[0]
        db.commit()
        return {"success": True, "data": {"id": new_id}}
    except Exception as e:
        db.rollback()
        logger.error(f"创建往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.put("/settings/partners/{id}")
async def update_partner(id: int, data: dict, db: Session = Depends(get_fbl_db)):
    """更新往来单位"""
    try:
        query = text("UPDATE aa_partner SET code = :code, name = :name WHERE id = :id")
        db.execute(query, {"id": id, "code": data.get("code"), "name": data.get("name")})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"更新往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.delete("/settings/partners/{id}")
async def delete_partner(id: int, db: Session = Depends(get_fbl_db)):
    """删除往来单位"""
    try:
        db.execute(text("DELETE FROM aa_partner WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除往来单位失败: {e}")
        return {"success": False, "message": str(e)}
