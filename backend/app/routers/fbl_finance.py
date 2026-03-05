from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..fbl_database import get_fbl_db
from typing import Optional, List, Dict, Any
from datetime import date, datetime
import logging
import json
import os
from collections import defaultdict
from pydantic import BaseModel

router = APIRouter(prefix="/api/fbl-finance", tags=["梵贝琳财务系统"])
logger = logging.getLogger(__name__)

@router.get("/diagnostic/duplicate-ids")
def diagnostic_duplicate_ids(db: Session = Depends(get_fbl_db)):
    """诊断接口：查找 gl_doc 中 id 重复的记录"""
    try:
        dup_query = text("""
            SELECT d.id, d.code, d.voucherdate, d.maker, d.madedate, d.ispost,
                   dt.name as voucher_type_name
            FROM gl_doc d
            LEFT JOIN aa_doctype dt ON d.iddoctype = dt.id
            WHERE d.id IN (
                SELECT id FROM gl_doc GROUP BY id HAVING COUNT(*) > 1
            )
            ORDER BY d.id, d.code
        """)
        rows = db.execute(dup_query).fetchall()
        
        total_dup_ids = text("SELECT id, COUNT(*) as cnt FROM gl_doc GROUP BY id HAVING COUNT(*) > 1 ORDER BY cnt DESC")
        dup_summary = db.execute(total_dup_ids).fetchall()
        
        return {
            "success": True,
            "duplicate_id_count": len(dup_summary),
            "summary": [{"id": r.id, "count": r.cnt} for r in dup_summary],
            "detail": [
                {
                    "id": r.id,
                    "code": r.code,
                    "voucher_date": str(r.voucherdate) if r.voucherdate else None,
                    "maker": r.maker,
                    "made_date": str(r.madedate) if r.madedate else None,
                    "is_post": r.ispost,
                    "voucher_type": r.voucher_type_name,
                }
                for r in rows
            ]
        }
    except Exception as e:
        logger.error(f"诊断重复ID失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/connection-test")
def test_connection(db: Session = Depends(get_fbl_db)):
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
def get_voucher_types(db: Session = Depends(get_fbl_db)):
    """获取所有凭证类别"""
    try:
        result = db.execute(text("SELECT id, code, name FROM aa_doctype ORDER BY id"))
        types = [dict(row._mapping) for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/accounts")
def get_accounts(
    year: Optional[int] = Query(None, description="会计年份（优先匹配，非硬过滤）"),
    db: Session = Depends(get_fbl_db)
):
    """获取所有末级科目，年份作为去重优先条件"""
    try:
        if year:
            query = text("""
                SELECT DISTINCT ON (code) id, code, name 
                FROM aa_account 
                WHERE isEndNode = 1 AND (disabled IS NULL OR disabled = 0)
                ORDER BY code, (CASE WHEN accountingyear = :year THEN 0 ELSE 1 END), id DESC
            """)
            result = db.execute(query, {"year": year})
        else:
            query = text("""
                SELECT DISTINCT ON (code) id, code, name 
                FROM aa_account 
                WHERE isEndNode = 1 AND (disabled IS NULL OR disabled = 0)
                ORDER BY code, id
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
    unit: str = "克"
    quantity: float = 0.0
    price: float = 0.0
    direction: str = "debit"  # 'debit' or 'credit'
    # 外币字段（可选）
    currency_id: Optional[int] = None       # 外币币种ID，不填则为本币(4)
    exchange_rate: Optional[float] = None   # 汇率
    orig_amount: Optional[float] = None     # 原币金额
    # 往来单位（可选）
    partner_id: Optional[int] = None        # 往来单位ID（aa_partner.id）

class VoucherCreate(BaseModel):
    voucher_date: str
    voucher_type_id: int
    entry_rows: List[VoucherEntryCreate]
    maker: str = "System"  # Default maker

@router.post("/vouchers")
def create_voucher(voucher: VoucherCreate, db: Session = Depends(get_fbl_db)):
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
            except (ValueError, TypeError):
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
                createdtime, madedate, docbusinesstype, docsourcetype, "PrintCount"
            ) VALUES (
                :id, :code, :date, :type_id, 
                :maker, :year, :period, 
                NOW(), :madedate, 0, 0, 0
            )
        """)
        
        db.execute(insert_doc_query, {
            "id": new_doc_id,
            "code": new_code,
            "date": v_date,
            "type_id": voucher.voucher_type_id,
            "maker": voucher.maker,
            "year": year,
            "period": period,
            "madedate": v_date
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
                quantitydr, quantitycr, price, unit,
                sequencenumber,
                idcurrency, exchangerate
            ) VALUES (
                :id, :doc_id, :summary, :account_id, 
                :debit, :credit,
                :origdr, :origcr,
                :quantitydr, :quantitycr, :price, :unit,
                :seq,
                :currency_id, :exchange_rate
            )
        """)
        
        for idx, entry in enumerate(voucher.entry_rows):
            current_entry_id += 1
            
            # Logic for quantitydr/quantitycr based on direction
            quantitydr = 0.0
            quantitycr = 0.0
            if entry.direction == 'debit':
                quantitydr = entry.quantity
            else:
                quantitycr = entry.quantity

            # 外币处理
            is_foreign = entry.currency_id is not None and entry.currency_id != 4
            currency_id = entry.currency_id if is_foreign else 4
            exchange_rate = entry.exchange_rate if is_foreign and entry.exchange_rate else 1.0
            
            if is_foreign and entry.orig_amount is not None:
                # 外币分录：orig = 原币金额，amount = 本币金额（已由前端计算）
                orig_dr = entry.orig_amount if entry.direction == 'debit' else 0.0
                orig_cr = entry.orig_amount if entry.direction == 'credit' else 0.0
            else:
                # 本币分录：orig = 本币金额
                orig_dr = entry.debit
                orig_cr = entry.credit
                
            db.execute(insert_entry_query, {
                "id": current_entry_id,
                "doc_id": doc_id,
                "summary": entry.summary,
                "account_id": entry.account_id,
                "debit": entry.debit,
                "credit": entry.credit,
                "origdr": orig_dr,
                "origcr": orig_cr,
                "quantitydr": quantitydr,
                "quantitycr": quantitycr,
                "price": entry.price,
                "unit": entry.unit,
                "seq": idx + 1,
                "currency_id": currency_id,
                "exchange_rate": exchange_rate,
            })

            # 如果指定了往来单位，插入 gl_auxiliaryinfo
            if entry.partner_id:
                max_aux_id_query = text("SELECT MAX(\"ID\") FROM gl_auxiliaryinfo")
                max_aux_id = db.execute(max_aux_id_query).scalar()
                new_aux_id = (max_aux_id or 0) + 1
                
                insert_aux_query = text("""
                    INSERT INTO gl_auxiliaryinfo (
                        "ID", code, "DocId", "idEntryDTO", "idauxAccCustomer", exchangerate
                    ) VALUES (
                        :aux_id, '0000', :doc_id, :entry_id, :partner_id, :exchange_rate
                    )
                """)
                db.execute(insert_aux_query, {
                    "aux_id": new_aux_id,
                    "doc_id": doc_id,
                    "entry_id": current_entry_id,
                    "partner_id": entry.partner_id,
                    "exchange_rate": exchange_rate,
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
def delete_voucher(voucher_id: int, db: Session = Depends(get_fbl_db)):
    """删除凭证"""
    try:
        # Check if exists and get ispost status
        check_query = text("SELECT id, ispost FROM gl_doc WHERE id = :id")
        result = db.execute(check_query, {"id": voucher_id}).fetchone()
        if not result:
            return {"success": False, "message": "凭证不存在"}
        
        # Check if posted
        if result.ispost:
            return {"success": False, "message": "已记账的凭证不能删除,请先反记账"}

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
    except Exception:
        return []

def save_admins(admins):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(admins, f, ensure_ascii=False, indent=2)

class AdminCreate(BaseModel):
    name: str

@router.get("/admins")
def get_admins():
    """获取财务管理员列表"""
    try:
        admins = load_admins()
        return {"success": True, "data": admins}
    except Exception as e:
        logger.error(f"获取管理员列表失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/admins")
def add_admin(admin: AdminCreate):
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
def delete_admin(name: str):
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


# Sort column whitelist mapping (frontend field name -> SQL column expression)
SORT_COLUMN_MAP = {
    "voucher_date": "d.voucherdate",
    "code": "d.code",
    "ispost": "d.ispost",
    "post_date": "d.postdate",
    "maker": "d.maker",
    "voucher_type_name": "dt.name",
}

# Same mapping but for the outer query using pv alias
SORT_COLUMN_MAP_PV = {
    "voucher_date": "pv.voucher_date",
    "code": "pv.code",
    "ispost": "pv.ispost",
    "post_date": "pv.post_date",
    "maker": "pv.maker",
    "voucher_type_name": "pv.voucher_type_name",
}

def _get_sort_clause(sort_by: Optional[str], sort_order: Optional[str], prefix: str = 'd') -> str:
    """Generate safe ORDER BY clause from sort parameters"""
    col_map = SORT_COLUMN_MAP_PV if prefix == 'pv' else SORT_COLUMN_MAP
    direction = "ASC" if sort_order and sort_order.lower() == "asc" else "DESC"
    
    if sort_by and sort_by in col_map:
        col = col_map[sort_by]
        nulls = "NULLS LAST" if direction == "DESC" else "NULLS FIRST"
        return f"{col} {direction} {nulls}"
    
    # Default sort
    if prefix == 'pv':
        return "pv.post_date DESC NULLS LAST, pv.voucher_date DESC, pv.code DESC"
    return "d.postdate DESC NULLS LAST, d.voucherdate DESC, d.code DESC"

@router.get("/vouchers")
def get_vouchers(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=10000, description="每页数量"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    filter_year: Optional[int] = Query(None, description="筛选年份"),
    filter_month: Optional[int] = Query(None, description="筛选月份 1-12"),
    voucher_code: Optional[str] = Query(None, description="凭证号/外部单号"),
    account_code: Optional[str] = Query(None, description="科目代码/名称"),
    voucher_type: Optional[str] = Query(None, description="凭证类别ID"),
    related_unit: Optional[str] = Query(None, description="往来单位"),
    maker: Optional[str] = Query(None, description="制单人"),
    summary: Optional[str] = Query(None, description="摘要筛选 (e.g. 结转)"),
    posted_status: Optional[str] = Query(None, description="记账状态: all/posted/unposted"),
    sort_by: Optional[str] = Query(None, description="排序字段"),
    sort_order: Optional[str] = Query("desc", description="排序方向: asc/desc"),
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
        
        # Month filter (mutually exclusive with date range on frontend)
        if filter_year:
            from_where += " AND d.accountingyear = :filter_year"
            params["filter_year"] = filter_year
        if filter_month:
            from_where += " AND d.accountingperiod = :filter_month"
            params["filter_month"] = filter_month
            
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

        if summary:
            # Filter by summary in entries
            from_where += """
                AND EXISTS (
                    SELECT 1 FROM gl_entry se 
                    WHERE se."idDocDTO" = d.id 
                    AND se.summary LIKE :summary
                )
            """
            params["summary"] = f"%{summary}%"

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
            
        if posted_status:
            if posted_status == "posted":
                from_where += " AND d.ispost = 1"
            elif posted_status == "unposted":
                from_where += " AND (d.ispost = 0 OR d.ispost IS NULL)"
                
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
                    d.madedate as made_date,
                    d.postdate as post_date,
                    d.maker,
                    dt.name as voucher_type_name,
                    d.ispost
                {from_where}
                ORDER BY {_get_sort_clause(sort_by, sort_order)}
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
            ORDER BY {_get_sort_clause(sort_by, sort_order, prefix='pv')}
        """
        
        params["limit"] = page_size
        params["offset"] = (page - 1) * page_size
        
        result = db.execute(text(data_query), params)
        result_rows = list(result)
        
        vouchers = []
        voucher_ids = [row.id for row in result_rows]
        entries_by_doc = defaultdict(list)
        
        if voucher_ids:
            # Query all entries for these vouchers in one go
            entries_query = text(f"""
                SELECT 
                    e."idDocDTO" as doc_id,
                    e.summary, 
                    a.code as account_code, 
                    a.name as account_name, 
                    e.amountdr as debit, 
                    e.amountcr as credit
                FROM gl_entry e
                LEFT JOIN aa_account a ON e.idaccount = a.id
                WHERE e."idDocDTO" IN ({','.join(map(str, voucher_ids))})
                ORDER BY e.sequencenumber ASC NULLS LAST, e.id ASC
            """)
            entries_result = db.execute(entries_query)
            for e in entries_result:
                e_dict = dict(e._mapping)
                doc_id = e_dict.pop("doc_id")
                entries_by_doc[doc_id].append(e_dict)
                
        for row in result_rows:
            voucher = dict(row._mapping)
            entries = entries_by_doc.get(voucher["id"], [])
            
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
@router.get("/settings/account-years")
def get_account_years(db: Session = Depends(get_fbl_db)):
    """获取科目表中所有可用的会计年份"""
    try:
        result = db.execute(text('''
            SELECT DISTINCT accountingyear 
            FROM aa_account 
            WHERE accountingyear IS NOT NULL 
            ORDER BY accountingyear DESC
        '''))
        years = [row.accountingyear for row in result]
        return {"success": True, "data": years}
    except Exception as e:
        logger.error(f"获取科目年份失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/settings/accounts")
def get_settings_accounts(
    year: Optional[int] = Query(None, description="会计年份"),
    db: Session = Depends(get_fbl_db)
):
    """获取所有科目（按 code 去重并按层级排序，支持按年份筛选）"""
    try:
        if year:
            result = db.execute(text('''
                SELECT id, code, name, disabled, "idParent", depth, accountingyear
                FROM aa_account
                WHERE accountingyear = :year
                ORDER BY code, id
            '''), {"year": year})
        else:
            result = db.execute(text('''
                SELECT DISTINCT ON (code) id, code, name, disabled, "idParent", depth, accountingyear
                FROM aa_account
                ORDER BY code, id
            '''))
        accounts = [dict(row._mapping) for row in result]
        return {"success": True, "data": accounts}
    except Exception as e:
        logger.error(f"获取科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/accounts")
def create_account(data: dict, db: Session = Depends(get_fbl_db)):
    """创建科目（支持新增子科目）"""
    try:
        parent_id = data.get("parent_id")
        code = data.get("code")
        name = data.get("name")

        if parent_id:
            # 新增子科目：设置 idParent、depth，并将父科目的 isEndNode 置为 0
            parent = db.execute(text('SELECT id, code, depth, "isEndNode" FROM aa_account WHERE id = :id'), {"id": parent_id}).fetchone()
            if not parent:
                return {"success": False, "message": "父科目不存在"}
            child_depth = (parent.depth or 1) + 1
            # 将同 code 的父科目记录全部标记为非末级
            db.execute(text('UPDATE aa_account SET "isEndNode" = 0 WHERE code = :code'), {"code": parent.code})
            query = text('''
                INSERT INTO aa_account (code, name, disabled, "idParent", depth, "isEndNode")
                VALUES (:code, :name, 0, :parent_id, :depth, 1)
                RETURNING id
            ''')
            result = db.execute(query, {"code": code, "name": name, "parent_id": parent_id, "depth": child_depth})
        else:
            # 新增顶级科目
            query = text('''
                INSERT INTO aa_account (code, name, disabled, depth, "isEndNode")
                VALUES (:code, :name, 0, 1, 1)
                RETURNING id
            ''')
            result = db.execute(query, {"code": code, "name": name})

        new_id = result.fetchone()[0]
        db.commit()
        return {"success": True, "data": {"id": new_id}}
    except Exception as e:
        db.rollback()
        logger.error(f"创建科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/settings/accounts/{id}/next-child-code")
def get_next_child_code(id: int, db: Session = Depends(get_fbl_db)):
    """获取下一个子科目编码"""
    try:
        parent = db.execute(text("SELECT code FROM aa_account WHERE id = :id"), {"id": id}).fetchone()
        if not parent:
            return {"success": False, "message": "科目不存在"}
        parent_code = parent.code
        # 查找以该 code 开头的直接子科目（编码长度 = 父编码长度 + 2）
        child_len = len(parent_code) + 2
        children = db.execute(text("""
            SELECT DISTINCT code FROM aa_account
            WHERE code LIKE :prefix AND LENGTH(code) = :clen
            ORDER BY code DESC LIMIT 1
        """), {"prefix": parent_code + "%", "clen": child_len}).fetchone()
        if children:
            last_suffix = int(children.code[len(parent_code):])
            next_code = parent_code + str(last_suffix + 1).zfill(2)
        else:
            next_code = parent_code + "01"
        return {"success": True, "data": {"next_code": next_code}}
    except Exception as e:
        logger.error(f"获取下一个子科目编码失败: {e}")
        return {"success": False, "message": str(e)}

@router.put("/settings/accounts/{id}")
def update_account(id: int, data: dict, db: Session = Depends(get_fbl_db)):
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
def delete_account(id: int, db: Session = Depends(get_fbl_db)):
    """删除科目"""
    try:
        db.execute(text("DELETE FROM aa_account WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除科目失败: {e}")
        return {"success": False, "message": str(e)}

@router.patch("/settings/accounts/{id}/toggle")
def toggle_account(id: int, db: Session = Depends(get_fbl_db)):
    """切换科目启用/禁用状态（同时更新同code的所有记录）"""
    try:
        row = db.execute(text("SELECT code, disabled FROM aa_account WHERE id = :id"), {"id": id}).fetchone()
        if not row:
            return {"success": False, "message": "科目不存在"}
        new_status = 0 if row.disabled else 1
        # 更新同 code 的所有记录，保持一致
        db.execute(text("UPDATE aa_account SET disabled = :d WHERE code = :code"), {"d": new_status, "code": row.code})
        db.commit()
        return {"success": True, "disabled": new_status}
    except Exception as e:
        db.rollback()
        logger.error(f"切换科目状态失败: {e}")
        return {"success": False, "message": str(e)}

# --- Voucher Types (aa_doctype) ---
@router.get("/settings/voucher-types")
def get_settings_voucher_types(db: Session = Depends(get_fbl_db)):
    """获取所有凭证类别"""
    try:
        result = db.execute(text("SELECT id, code, name, docword, disabled FROM aa_doctype ORDER BY id"))
        types = [dict(row._mapping) for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/voucher-types")
def create_voucher_type(data: dict, db: Session = Depends(get_fbl_db)):
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
def update_voucher_type(id: int, data: dict, db: Session = Depends(get_fbl_db)):
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
def delete_voucher_type(id: int, db: Session = Depends(get_fbl_db)):
    """删除凭证类别"""
    try:
        db.execute(text("DELETE FROM aa_doctype WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除凭证类别失败: {e}")
        return {"success": False, "message": str(e)}

@router.patch("/settings/voucher-types/{id}/toggle")
def toggle_voucher_type(id: int, db: Session = Depends(get_fbl_db)):
    """切换凭证类别启用/禁用状态"""
    try:
        row = db.execute(text("SELECT disabled FROM aa_doctype WHERE id = :id"), {"id": id}).fetchone()
        if not row:
            return {"success": False, "message": "凭证类别不存在"}
        new_status = 0 if row.disabled else 1
        db.execute(text("UPDATE aa_doctype SET disabled = :d WHERE id = :id"), {"d": new_status, "id": id})
        db.commit()
        return {"success": True, "disabled": new_status}
    except Exception as e:
        db.rollback()
        logger.error(f"切换凭证类别状态失败: {e}")
        return {"success": False, "message": str(e)}

# --- Partners (aa_partner) ---
@router.get("/settings/partners")
def get_partners(db: Session = Depends(get_fbl_db)):
    """获取所有往来单位"""
    try:
        result = db.execute(text("SELECT id, code, name, disabled FROM aa_partner ORDER BY code"))
        partners = [dict(row._mapping) for row in result]
        return {"success": True, "data": partners}
    except Exception as e:
        logger.error(f"获取往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/settings/partners")
def create_partner(data: dict, db: Session = Depends(get_fbl_db)):
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
def update_partner(id: int, data: dict, db: Session = Depends(get_fbl_db)):
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
def delete_partner(id: int, db: Session = Depends(get_fbl_db)):
    """删除往来单位"""
    try:
        db.execute(text("DELETE FROM aa_partner WHERE id = :id"), {"id": id})
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        logger.error(f"删除往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.patch("/settings/partners/{id}/toggle")
def toggle_partner(id: int, db: Session = Depends(get_fbl_db)):
    """切换往来单位启用/禁用状态"""
    try:
        row = db.execute(text("SELECT disabled FROM aa_partner WHERE id = :id"), {"id": id}).fetchone()
        if not row:
            return {"success": False, "message": "往来单位不存在"}
        new_status = 0 if row.disabled else 1
        db.execute(text("UPDATE aa_partner SET disabled = :d WHERE id = :id"), {"d": new_status, "id": id})
        db.commit()
        return {"success": True, "disabled": new_status}
    except Exception as e:
        db.rollback()
        logger.error(f"切换往来单位状态失败: {e}")
        return {"success": False, "message": str(e)}

# ==================== Voucher Posting APIs ====================

@router.post("/vouchers/{voucher_id}/post")
def post_voucher(voucher_id: int, db: Session = Depends(get_fbl_db)):
    """记账 - 将凭证标记为已记账"""
    try:
        # Check if voucher exists
        check_query = text("SELECT id, ispost FROM gl_doc WHERE id = :id")
        result = db.execute(check_query, {"id": voucher_id}).fetchone()
        if not result:
            return {"success": False, "message": "凭证不存在"}
        
        # Check if already posted
        if result.ispost:
            return {"success": False, "message": "凭证已经记账"}
        
        # Update ispost, postdate, accountingyear, accountingperiod
        now = datetime.now()
        update_query = text("""
            UPDATE gl_doc SET ispost = 1, postdate = :now, 
            accountingyear = :year, accountingperiod = :month 
            WHERE id = :id
        """)
        db.execute(update_query, {"id": voucher_id, "now": now, "year": now.year, "month": now.month})
        db.commit()
        
        return {"success": True, "message": "记账成功"}
    except Exception as e:
        db.rollback()
        logger.error(f"记账失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/vouchers/{voucher_id}/unpost")
def unpost_voucher(voucher_id: int, db: Session = Depends(get_fbl_db)):
    """反记账 - 取消凭证的记账状态"""
    try:
        # Check if voucher exists
        check_query = text("SELECT id, ispost FROM gl_doc WHERE id = :id")
        result = db.execute(check_query, {"id": voucher_id}).fetchone()
        if not result:
            return {"success": False, "message": "凭证不存在"}
        
        # Check if not posted
        if not result.ispost:
            return {"success": False, "message": "凭证尚未记账"}
        
        # Update ispost to 0 and clear postdate
        update_query = text("UPDATE gl_doc SET ispost = 0, postdate = NULL WHERE id = :id")
        db.execute(update_query, {"id": voucher_id})
        db.commit()
        
        return {"success": True, "message": "反记账成功"}
    except Exception as e:
        db.rollback()
        logger.error(f"反记账失败: {e}")
        return {"success": False, "message": str(e)}

class BatchPostRequest(BaseModel):
    year: int
    month: int

@router.post("/vouchers/batch-post")
def batch_post_vouchers(data: BatchPostRequest, db: Session = Depends(get_fbl_db)):
    """批量记账 - 按月份批量记账"""
    try:
        # Validate month
        if data.month < 1 or data.month > 12:
            return {"success": False, "message": "月份必须在1-12之间"}
        
        # Update all unposted vouchers in the specified year and month
        update_query = text("""
            UPDATE gl_doc 
            SET ispost = 1, postdate = NOW(),
            accountingyear = :year, accountingperiod = :month 
            WHERE accountingyear = :year 
            AND accountingperiod = :month 
            AND (ispost = 0 OR ispost IS NULL)
        """)
        
        result = db.execute(update_query, {"year": data.year, "month": data.month})
        db.commit()
        
        affected_rows = result.rowcount
        return {
            "success": True, 
            "message": f"批量记账成功，共记账 {affected_rows} 张凭证",
            "count": affected_rows
        }
    except Exception as e:
        db.rollback()
        logger.error(f"批量记账失败: {e}")
        return {"success": False, "message": str(e)}

# Period Closing Endpoints

@router.get("/closing/check")
def check_closing_conditions(
    year: int = Query(..., description="Accounting Year"),
    period: int = Query(..., description="Accounting Period"),
    db: Session = Depends(get_fbl_db)
):
    """
    Check if the period can be closed.
    Checks for unposted vouchers and if period is already closed.
    """
    try:
        errors = []

        # 检查是否已经结账
        try:
            closed_row = db.execute(text(
                "SELECT is_closed FROM fbl_period_status WHERE year = :year AND period = :period"
            ), {"year": year, "period": period}).fetchone()
            if closed_row and closed_row.is_closed:
                errors.append(f"{year}年{period}期 已结账，如需修改请先反结账。")
                return {
                    "success": True,
                    "can_close": False,
                    "is_already_closed": True,
                    "unposted_count": 0,
                    "errors": errors
                }
        except Exception:
            # 表可能还不存在，忽略
            pass

        # Check for unposted vouchers
        # ispost: 0 = unposted, 1 = posted. Handle NULL as 0.
        query = text("""
            SELECT COUNT(*) FROM gl_doc 
            WHERE accountingyear = :year 
            AND accountingperiod = :period 
            AND (ispost = 0 OR ispost IS NULL)
        """)
        result = db.execute(query, {"year": year, "period": period}).scalar()
        unposted_count = result or 0
        
        if unposted_count > 0:
            errors.append(f"本期存在 {unposted_count} 张未记账凭证，不能结账。")
            
        return {
            "success": True,
            "can_close": unposted_count == 0,
            "is_already_closed": False,
            "unposted_count": unposted_count,
            "errors": errors
        }
    except Exception as e:
        logger.error(f"Closing check failed: {e}")
        return {"success": False, "message": str(e)}

class PLTransferRequest(BaseModel):
    summary: str = "结转本期损益"
    year: int
    period: int
    profit_account_id: Optional[int] = None

@router.post("/closing/transfer-pl")
def generate_pl_transfer_voucher(
    request: PLTransferRequest,
    db: Session = Depends(get_fbl_db)
):
    """
    Generate P&L transfer voucher for the specified period.
    Identifies P&L accounts (starts with 5 or 6).
    Calculates net balance and creates offsetting entry to Current Year Profit (4103).
    """
    try:
        # 1. Find profit account ID if not provided
        profit_acc_id = request.profit_account_id
        if not profit_acc_id:
            # Try finding standard 'Current Year Profit' account (Code 4103)
            # Or maybe by name? Stick to code for now.
            res = db.execute(text("SELECT id FROM aa_account WHERE code = '4103'")).fetchone()
            if res:
                profit_acc_id = res[0]
            else:
                return {"success": False, "message": "无法自动找到'本年利润'科目(4103)，请手动指定科目ID。"}

        # 2. Calculate balances for P&L accounts
        # P&L accounts assumed to start with '5' (Revenue) or '6' (Expense)
        # Balance = Sum(Debit - Credit)
        query_balance = text("""
            SELECT 
                E.idaccount as account_id, 
                SUM(COALESCE(E.amountdr, 0) - COALESCE(E.amountcr, 0)) as balance
            FROM gl_entry E
            JOIN gl_doc D ON E."idDocDTO" = D.id
            JOIN aa_account A ON E.idaccount = A.id
            WHERE D.accountingyear = :year 
            AND D.accountingperiod = :period
            AND D.ispost = 1
            AND (A.code LIKE '5%' OR A.code LIKE '6%')
            GROUP BY E.idaccount
            HAVING SUM(COALESCE(E.amountdr, 0) - COALESCE(E.amountcr, 0)) <> 0
        """)
        
        balances = db.execute(query_balance, {"year": request.year, "period": request.period}).fetchall()
        
        if not balances:
            return {"success": True, "message": "本期无损益发生额，无需生成结转凭证。"}

        # 3. Construct Voucher Entries
        entries = []
        total_profit_loss = 0.0
        
        for row in balances:
            account_id = row.account_id
            balance = float(row.balance)
            
            # If balance > 0 (Debit balance, e.g. Expense): 
            # To transfer: Credit Account by balance, Debit Profit Account
            # Entry 1: Credit Expense Account
            if balance > 0:
                entries.append(VoucherEntryCreate(
                    summary=request.summary,
                    account_id=account_id,
                    debit=0,
                    credit=balance, # Offset debit balance
                    direction='credit'
                ))
                total_profit_loss += balance # This amount needs to be Debited to Profit Account
            
            # If balance < 0 (Credit balance, e.g. Revenue):
            # To transfer: Debit Account by abs(balance), Credit Profit Account
            # Entry 1: Debit Revenue Account
            else:
                abs_balance = abs(balance)
                entries.append(VoucherEntryCreate(
                    summary=request.summary,
                    account_id=account_id,
                    debit=abs_balance, # Offset credit balance
                    credit=0,
                    direction='debit'
                ))
                total_profit_loss -= abs_balance # This amount needs to be Credited to Profit Account (negative here means credit for consistency?)
                # Wait, total_profit_loss logic:
                # If Expense 100 -> we Credit Exp 100. We must Debit Profit 100.
                # If Revenue 200 -> we Debit Rev 200. We must Credit Profit 200.
                # Net Profit = Revenue - Expense = 200 - 100 = 100 (Credit to Profit Account).
                
        # 4. Add Profit Account Entry
        # Calculate net transfer amount for Profit Account
        # Sum of debits must equal sum of credits.
        # My logic above:
        # entries contains credits to expenses and debits to revenues.
        # Total Credits in entries = Sum(Expenses)
        # Total Debits in entries = Sum(Revenues)
        # Imbalance = Debits - Credits = Revenue - Expense.
        # If Revenue > Expense, we need a Credit to balance.
        # Credit goes to Profit Account.
        
        sum_debit = sum(e.debit for e in entries)
        sum_credit = sum(e.credit for e in entries)
        diff = sum_debit - sum_credit
        
        if abs(diff) > 0.001:
            if diff > 0:
                # Debits > Credits. Need Credit to balance.
                entries.append(VoucherEntryCreate(
                    summary=request.summary,
                    account_id=profit_acc_id,
                    debit=0,
                    credit=diff,
                    direction='credit'
                ))
            else:
                # Credits > Debits. Need Debit to balance.
                entries.append(VoucherEntryCreate(
                    summary=request.summary,
                    account_id=profit_acc_id,
                    debit=abs(diff),
                    credit=0,
                    direction='debit'
                ))

        # 5. Create Voucher
        import calendar
        last_day = calendar.monthrange(request.year, request.period)[1]
        voucher_date = f"{request.year}-{request.period:02d}-{last_day}"
        
        voucher_data = VoucherCreate(
            voucher_type_id=1,  # 默认凭证类别（通常 id=1 为"记"）
            voucher_date=voucher_date,
            entry_rows=entries,
            maker="系统自动"
        )
        
        # 调用 create_voucher 内部函数创建凭证
        result = create_voucher(voucher_data, db)
        
        if not result.get("success"):
            return {"success": False, "message": f"生成结转凭证失败: {result.get('message', '未知错误')}"}
        
        return {
            "success": True, 
            "message": f"损益结转凭证生成成功（{voucher_date}），共 {len(entries)} 条分录",
            "voucher_id": result.get("data", {}).get("id")
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Transfer PL failed: {e}")
        return {"success": False, "message": str(e)}

class SalesCostTransferRequest(BaseModel):
    year: int
    period: int
    summary: str = "结转销售成本"
    cogs_account_code: str = "6401"       # 主营业务成本
    inventory_account_code: str = "1405"  # 库存商品
    # 可选：手动指定金价（如不指定则从结算单自动获取）
    gold_price_override: Optional[float] = None

@router.post("/closing/transfer-sales-cost")
def transfer_sales_cost(
    request: SalesCostTransferRequest,
    db: Session = Depends(get_fbl_db)
):
    """
    销售成本结转
    
    会计分录:
      借: 主营业务成本(6401)
      贷: 库存商品(1405)
    
    计算方法:
      1. 查询ERP系统中本期已确认的结算单
      2. 金料成本 = 结算单中的 material_amount（金价×克重）
      3. 加工成本 = 对应入库单的 supplier labor cost
      4. 总成本 = 金料成本 + 加工成本
    """
    try:
        # 1. 查找 FBL 科目
        cogs_acc = db.execute(
            text("SELECT id, name FROM aa_account WHERE code = :code AND (\"isEndNode\" = 1 OR \"isEndNode\" IS NULL)"),
            {"code": request.cogs_account_code}
        ).fetchone()
        if not cogs_acc:
            return {"success": False, "message": f"未找到科目 {request.cogs_account_code}（主营业务成本），请先在科目表中创建。"}

        inv_acc = db.execute(
            text("SELECT id, name FROM aa_account WHERE code = :code AND (\"isEndNode\" = 1 OR \"isEndNode\" IS NULL)"),
            {"code": request.inventory_account_code}
        ).fetchone()
        if not inv_acc:
            return {"success": False, "message": f"未找到科目 {request.inventory_account_code}（库存商品），请先在科目表中创建。"}

        cogs_acc_id = cogs_acc[0]
        inv_acc_id = inv_acc[0]

        # 2. 连接ERP数据库，查询本期已确认的结算单
        from ..database import SessionLocal
        erp_db = SessionLocal()
        try:
            # 计算期间日期范围
            import calendar
            last_day = calendar.monthrange(request.year, request.period)[1]
            period_start = f"{request.year}-{request.period:02d}-01"
            period_end = f"{request.year}-{request.period:02d}-{last_day}"

            # 查询已确认的结算单 (status='confirmed') + 关联销售单的日期在本期内
            settlement_query = text("""
                SELECT 
                    s.id, s.settlement_no, s.total_weight, 
                    s.material_amount, s.labor_amount, s.total_amount,
                    s.gold_price, s.payment_method,
                    so.order_no, so.order_date
                FROM settlement_orders s
                JOIN sales_orders so ON s.sales_order_id = so.id
                WHERE s.status = 'confirmed'
                AND so.order_date >= :start_date 
                AND so.order_date <= :end_date
            """)
            settlements = erp_db.execute(settlement_query, {
                "start_date": period_start,
                "end_date": period_end + " 23:59:59"
            }).fetchall()

            if not settlements:
                return {"success": True, "message": f"本期({request.year}年{request.period}期)无已确认的结算单，无需结转销售成本。"}

            # 3. 计算金料成本
            # material_amount = 金价 × 克重（结价或混合支付时的原料金额）
            total_material_cost = 0.0
            total_weight_sold = 0.0
            settlement_count = 0

            for row in settlements:
                material = float(row.material_amount or 0)
                weight = float(row.total_weight or 0)
                total_material_cost += material
                total_weight_sold += weight
                settlement_count += 1

            # 4. 查询本期入库单的供应商加工成本
            # 用于计算加工成本（克工费 + 件工费 = total_cost）
            inbound_cost_query = text("""
                SELECT COALESCE(SUM(d.total_cost), 0) as total_labor_cost
                FROM inbound_details d
                JOIN inbound_orders o ON d.order_id = o.id
                WHERE o.status = 'completed'
                AND o.create_time >= :start_date 
                AND o.create_time <= :end_date
            """)
            inbound_result = erp_db.execute(inbound_cost_query, {
                "start_date": period_start,
                "end_date": period_end + " 23:59:59"
            }).fetchone()

            supplier_labor_cost = float(inbound_result.total_labor_cost) if inbound_result else 0.0

        finally:
            erp_db.close()

        # 5. 计算总成本
        total_cogs = total_material_cost + supplier_labor_cost

        if total_cogs <= 0:
            return {"success": True, "message": "本期销售成本为零，无需生成结转凭证。"}

        # 6. 构建凭证分录
        import calendar
        last_day = calendar.monthrange(request.year, request.period)[1]
        voucher_date = f"{request.year}-{request.period:02d}-{last_day}"

        # 金额四舍五入到两位小数
        total_cogs = round(total_cogs, 2)
        total_material_cost = round(total_material_cost, 2)
        supplier_labor_cost = round(supplier_labor_cost, 2)

        summary_detail = f"{request.summary}（金料{total_material_cost:.2f}+加工{supplier_labor_cost:.2f}，{settlement_count}笔/{total_weight_sold:.3f}克）"

        entries = [
            # 借: 主营业务成本
            VoucherEntryCreate(
                summary=summary_detail,
                account_id=cogs_acc_id,
                debit=total_cogs,
                credit=0,
                direction='debit'
            ),
            # 贷: 库存商品
            VoucherEntryCreate(
                summary=summary_detail,
                account_id=inv_acc_id,
                debit=0,
                credit=total_cogs,
                direction='credit'
            ),
        ]

        # 7. 创建凭证
        voucher_data = VoucherCreate(
            voucher_type_id=1,
            voucher_date=voucher_date,
            entry_rows=entries,
            maker="系统自动"
        )

        result = create_voucher(voucher_data, db)

        if not result.get("success"):
            return {"success": False, "message": f"生成结转凭证失败: {result.get('message', '未知错误')}"}

        return {
            "success": True,
            "message": (
                f"销售成本结转凭证生成成功（{voucher_date}）\n"
                f"结算单 {settlement_count} 笔，总克重 {total_weight_sold:.3f}克\n"
                f"金料成本 ¥{total_material_cost:,.2f} + 加工成本 ¥{supplier_labor_cost:,.2f} = 总成本 ¥{total_cogs:,.2f}"
            ),
            "voucher_id": result.get("data", {}).get("id"),
            "details": {
                "settlement_count": settlement_count,
                "total_weight": round(total_weight_sold, 3),
                "material_cost": total_material_cost,
                "labor_cost": supplier_labor_cost,
                "total_cogs": total_cogs
            }
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Sales cost transfer failed: {e}", exc_info=True)
        return {"success": False, "message": f"销售成本结转失败: {str(e)}"}


class ExchangeTransferRequest(BaseModel):
    year: int
    period: int
    summary: str = "结转汇兑损益"
    exchange_account_code: str = "6603"  # 汇兑损益科目
    # 期末汇率 {币种ID: 汇率}，如不指定则使用各笔分录的原始汇率（不调整）
    period_end_rates: Optional[Dict[str, float]] = None

@router.post("/closing/transfer-exchange")
def transfer_exchange(
    request: ExchangeTransferRequest,
    db: Session = Depends(get_fbl_db)
):
    """
    汇兑损益结转
    
    对外币科目进行期末汇率重估，差额计入汇兑损益。
    
    会计分录:
      若汇兑收益: 借 外币科目, 贷 汇兑损益(6603)
      若汇兑损失: 借 汇兑损益(6603), 贷 外币科目
    
    计算方法:
      1. 查找有外币业务的科目（isexchange=1 或 iddefaultcurrencyDTO!=1）
      2. 计算各外币科目的原币余额和本币余额
      3. 用期末汇率重新估值：新本币金额 = 原币余额 × 期末汇率
      4. 差额 = 新本币金额 - 原本币余额
      5. 差额即为汇兑损益
    """
    try:
        # 1. 查找汇兑损益科目
        exchange_acc = db.execute(
            text("SELECT id, name FROM aa_account WHERE code = :code AND (\"isEndNode\" = 1 OR \"isEndNode\" IS NULL)"),
            {"code": request.exchange_account_code}
        ).fetchone()
        if not exchange_acc:
            return {"success": False, "message": f"未找到科目 {request.exchange_account_code}（汇兑损益），请先在科目表中创建。"}

        exchange_acc_id = exchange_acc[0]

        # 2. 查找有外币业务的科目
        # 本位币 idcurrency=4，非本位币即 idcurrency != 4
        # 币种信息存储在 aa_currency 表中
        foreign_accounts_query = text("""
            SELECT 
                e.idaccount AS account_id,
                a.code AS account_code,
                a.name AS account_name,
                e.idcurrency AS currency_id,
                c.name AS currency_name,
                a.dcdirection AS dc_direction,
                SUM(COALESCE(e.origamountdr, 0) - COALESCE(e.origamountcr, 0)) AS orig_balance,
                SUM(COALESCE(e.amountdr, 0) - COALESCE(e.amountcr, 0)) AS local_balance
            FROM gl_entry e
            JOIN gl_doc d ON e."idDocDTO" = d.id
            JOIN aa_account a ON e.idaccount = a.id
            LEFT JOIN aa_currency c ON e.idcurrency = c.id
            WHERE d.accountingyear = :year 
            AND d.accountingperiod <= :period
            AND d.ispost = 1
            AND e.idcurrency IS NOT NULL 
            AND e.idcurrency != 4
            GROUP BY e.idaccount, a.code, a.name, e.idcurrency, c.name, a.dcdirection
            HAVING SUM(COALESCE(e.origamountdr, 0) - COALESCE(e.origamountcr, 0)) <> 0
        """)

        foreign_balances = db.execute(foreign_accounts_query, {
            "year": request.year,
            "period": request.period
        }).fetchall()

        if not foreign_balances:
            return {"success": True, "message": "本期无外币科目余额，无需结转汇兑损益。"}

        # 3. 如果没有提供期末汇率，尝试获取本期最新使用的汇率
        period_end_rates = {}
        if request.period_end_rates:
            period_end_rates = {int(k): v for k, v in request.period_end_rates.items()}
        else:
            # 从本期最新凭证分录获取各币种最新汇率
            latest_rates_query = text("""
                SELECT DISTINCT ON (e.idcurrency)
                    e.idcurrency AS currency_id,
                    e.exchangerate AS rate
                FROM gl_entry e
                JOIN gl_doc d ON e."idDocDTO" = d.id
                WHERE d.accountingyear = :year 
                AND d.accountingperiod = :period
                AND d.ispost = 1
                AND e.idcurrency IS NOT NULL 
                AND e.idcurrency != 4
                AND e.exchangerate IS NOT NULL
                AND e.exchangerate > 0
                ORDER BY e.idcurrency, d.voucherdate DESC, d.id DESC
            """)
            latest_rates = db.execute(latest_rates_query, {
                "year": request.year,
                "period": request.period
            }).fetchall()
            
            for row in latest_rates:
                period_end_rates[row.currency_id] = float(row.rate)

        if not period_end_rates:
            return {"success": True, "message": "未找到期末外币汇率，无法计算汇兑损益。请在请求中提供 period_end_rates 参数。"}

        # 4. 计算各科目的汇兑损益
        entries = []
        total_gain_loss = 0.0
        details = []

        for row in foreign_balances:
            currency_id = row.currency_id
            if currency_id not in period_end_rates:
                logger.warning(f"币种 {currency_id} 无期末汇率，跳过科目 {row.account_code}")
                continue

            current_rate = period_end_rates[currency_id]
            orig_balance = float(row.orig_balance)       # 原币余额
            local_balance = float(row.local_balance)     # 当前本币余额
            revalued_amount = orig_balance * current_rate # 重估后本币金额
            diff = round(revalued_amount - local_balance, 2)  # 汇兑差额

            if abs(diff) < 0.01:
                continue  # 差额忽略不计

            account_id = row.account_id
            account_code = row.account_code
            account_name = row.account_name
            currency_name = row.currency_name or f"币种{currency_id}"
            entry_summary = f"{request.summary}（{account_code} {account_name}，{currency_name}汇率{current_rate}）"

            if diff > 0:
                # 汇兑收益: 外币科目增值
                # 借: 外币科目（补差）
                entries.append(VoucherEntryCreate(
                    summary=entry_summary,
                    account_id=account_id,
                    debit=diff,
                    credit=0,
                    direction='debit'
                ))
                # 贷: 汇兑损益
                entries.append(VoucherEntryCreate(
                    summary=entry_summary,
                    account_id=exchange_acc_id,
                    debit=0,
                    credit=diff,
                    direction='credit'
                ))
            else:
                # 汇兑损失: 外币科目贬值
                abs_diff = abs(diff)
                # 借: 汇兑损益
                entries.append(VoucherEntryCreate(
                    summary=entry_summary,
                    account_id=exchange_acc_id,
                    debit=abs_diff,
                    credit=0,
                    direction='debit'
                ))
                # 贷: 外币科目（冲减）
                entries.append(VoucherEntryCreate(
                    summary=entry_summary,
                    account_id=account_id,
                    debit=0,
                    credit=abs_diff,
                    direction='credit'
                ))

            total_gain_loss += diff
            details.append({
                "account": f"{account_code} {account_name}",
                "currency_id": currency_id,
                "currency_name": currency_name,
                "orig_balance": round(orig_balance, 2),
                "old_local": round(local_balance, 2),
                "new_local": round(revalued_amount, 2),
                "diff": diff
            })

        if not entries:
            return {"success": True, "message": "汇率重估后无差异，无需生成汇兑损益凭证。"}

        # 5. 创建凭证
        import calendar
        last_day = calendar.monthrange(request.year, request.period)[1]
        voucher_date = f"{request.year}-{request.period:02d}-{last_day}"

        voucher_data = VoucherCreate(
            voucher_type_id=1,
            voucher_date=voucher_date,
            entry_rows=entries,
            maker="系统自动"
        )

        result = create_voucher(voucher_data, db)

        if not result.get("success"):
            return {"success": False, "message": f"生成汇兑损益凭证失败: {result.get('message', '未知错误')}"}

        gain_loss_label = "收益" if total_gain_loss > 0 else "损失"
        return {
            "success": True,
            "message": (
                f"汇兑损益凭证生成成功（{voucher_date}）\n"
                f"涉及 {len(details)} 个外币科目，汇兑{gain_loss_label} ¥{abs(total_gain_loss):,.2f}"
            ),
            "voucher_id": result.get("data", {}).get("id"),
            "details": {
                "total_gain_loss": round(total_gain_loss, 2),
                "accounts": details
            }
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Exchange transfer failed: {e}", exc_info=True)
        return {"success": False, "message": f"汇兑损益结转失败: {str(e)}"}

@router.post("/closing/transfer-custom")
def transfer_custom(
    request: PLTransferRequest,
    db: Session = Depends(get_fbl_db)
):
    """
    自定义结转 (Placeholder)
    """
    try:
        # Placeholder logic
        return {"success": True, "message": "请前往凭证管理页面手动录入自定义结转凭证", "voucher_id": None}
    except Exception as e:
         return {"success": False, "message": str(e)}


# debug/schema 和 debug/fix-schema 端点已移除（SQL 注入风险 + 生产环境不应暴露表结构）

@router.post("/closing/close-period")
def close_period(
    year: int = Query(..., description="Accounting Year"),
    period: int = Query(..., description="Accounting Period"),
    db: Session = Depends(get_fbl_db)
):
    """
    Close the accounting period.
    1. Checks unposted vouchers.
    2. Updates period status in fbl_period_status table.
    """
    try:
        # Create table if not exists (fbl_period_status)
        # Using raw SQL
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS fbl_period_status (
                year INTEGER,
                period INTEGER,
                is_closed BOOLEAN DEFAULT FALSE,
                closed_at TIMESTAMP,
                closed_by VARCHAR(50),
                PRIMARY KEY (year, period)
            )
        """))
        
        # Check conditions
        check_result = check_closing_conditions(year, period, db)
        if not check_result["can_close"]:
             return {"success": False, "message": "存在未记账凭证，无法结账", "details": check_result}
             
        # Insert/Update status
        from datetime import datetime
        now = datetime.now()
        
        stmt = text("""
            INSERT INTO fbl_period_status (year, period, is_closed, closed_at, closed_by)
            VALUES (:year, :period, TRUE, :now, 'system')
            ON CONFLICT (year, period) 
            DO UPDATE SET is_closed = TRUE, closed_at = :now
        """)
        
        db.execute(stmt, {"year": year, "period": period, "now": now})
        db.commit()
        
        return {"success": True, "message": f"{year}年{period}期 已成功结账"}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Close period failed: {e}")
        return {"success": False, "message": str(e)}

@router.get("/closing/status")
def get_period_statuses(
    year: Optional[int] = Query(None, description="筛选年份，不传则返回所有"),
    db: Session = Depends(get_fbl_db)
):
    """获取所有会计期间的结账状态"""
    try:
        # 确保表存在
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS fbl_period_status (
                year INTEGER,
                period INTEGER,
                is_closed BOOLEAN DEFAULT FALSE,
                closed_at TIMESTAMP,
                closed_by VARCHAR(50),
                PRIMARY KEY (year, period)
            )
        """))
        db.commit()

        if year:
            rows = db.execute(text(
                "SELECT year, period, is_closed, closed_at, closed_by FROM fbl_period_status WHERE year = :year ORDER BY period DESC"
            ), {"year": year}).fetchall()
        else:
            rows = db.execute(text(
                "SELECT year, period, is_closed, closed_at, closed_by FROM fbl_period_status ORDER BY year DESC, period DESC"
            )).fetchall()

        data = []
        for r in rows:
            data.append({
                "year": r.year,
                "period": r.period,
                "is_closed": bool(r.is_closed),
                "closed_at": r.closed_at.isoformat() if r.closed_at else None,
                "closed_by": r.closed_by
            })
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"获取结账状态失败: {e}")
        return {"success": False, "message": str(e)}

@router.post("/closing/reopen-period")
def reopen_period(
    year: int = Query(..., description="Accounting Year"),
    period: int = Query(..., description="Accounting Period"),
    db: Session = Depends(get_fbl_db)
):
    """反结账 - 将已结账期间重新打开"""
    try:
        # 检查是否已结账
        row = db.execute(text(
            "SELECT is_closed FROM fbl_period_status WHERE year = :year AND period = :period"
        ), {"year": year, "period": period}).fetchone()

        if not row or not row.is_closed:
            return {"success": False, "message": f"{year}年{period}期 尚未结账，无需反结账"}

        # 检查后续期间是否已结账（必须从最后一个结账期间开始反结账）
        later_closed = db.execute(text("""
            SELECT year, period FROM fbl_period_status 
            WHERE is_closed = TRUE 
            AND (year > :year OR (year = :year AND period > :period))
            ORDER BY year, period LIMIT 1
        """), {"year": year, "period": period}).fetchone()

        if later_closed:
            return {
                "success": False,
                "message": f"请先反结账 {later_closed.year}年{later_closed.period}期，必须从最后结账的期间开始反结账"
            }

        # 执行反结账
        db.execute(text(
            "UPDATE fbl_period_status SET is_closed = FALSE, closed_at = NULL WHERE year = :year AND period = :period"
        ), {"year": year, "period": period})
        db.commit()

        return {"success": True, "message": f"{year}年{period}期 已成功反结账，可以继续修改凭证"}
    except Exception as e:
        db.rollback()
        logger.error(f"反结账失败: {e}")
        return {"success": False, "message": str(e)}

# ==================== 财务报表 APIs ====================

@router.get("/reports/balance-sheet")
def get_balance_sheet(
    year: int = Query(..., description="会计年度"),
    period: int = Query(..., description="会计期间"),
    db: Session = Depends(get_fbl_db)
):
    """
    资产负债表
    计算截至指定期间末的各科目余额。
    资产 = 负债 + 所有者权益
    """
    try:
        # gl_entry.code 是分录序号，不是科目编码
        # 需要通过 gl_entry.idaccount -> aa_account.id 获取真实科目编码
        # 然后按一级科目（前4位）汇总
        query = text("""
            WITH entry_data AS (
                SELECT 
                    LEFT(a.code, 4) AS acc_code,
                    SUM(COALESCE(e.amountdr, 0)) AS total_dr,
                    SUM(COALESCE(e.amountcr, 0)) AS total_cr
                FROM gl_entry e
                JOIN gl_doc d ON e."idDocDTO" = d.id
                JOIN aa_account a ON e.idaccount = a.id
                WHERE d.ispost = 1
                AND (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod <= :period))
                GROUP BY LEFT(a.code, 4)
            )
            SELECT 
                ed.acc_code,
                p.name AS acc_name,
                p."idaccounttypeDTO" AS type_id,
                p."dcdirection" AS dc_dir,
                ed.total_dr,
                ed.total_cr
            FROM entry_data ed
            LEFT JOIN (
                SELECT DISTINCT ON (code) code, name, "idaccounttypeDTO", "dcdirection"
                FROM aa_account WHERE depth = 1 ORDER BY code, id
            ) p ON ed.acc_code = p.code
            ORDER BY ed.acc_code
        """)
        rows = db.execute(query, {"year": year, "period": period}).fetchall()

        assets = []       # 资产 typeId=6
        liabilities = []  # 负债 typeId=7
        equity = []       # 权益 typeId=9
        common = []       # 共同 typeId=8

        total_assets = 0
        total_liabilities = 0
        total_equity = 0

        # 累计未结转的损益科目净额
        # 损益类科目(type_id=11)在期末结转前有余额，但不属于资产/负债/权益
        # 需要将其净额作为"本年利润（未结转）"计入权益，使报表平衡
        # 收入类(dir=653): 贷方余额 = cr - dr > 0 表示收入
        # 费用类(dir=652): 借方余额 = dr - cr > 0 表示费用
        # 未结转净利润 = 收入 - 费用 = Σ(cr - dr) for all P&L accounts
        undistributed_profit = 0

        for r in rows:
            dr = float(r.total_dr or 0)
            cr = float(r.total_cr or 0)
            type_id = r.type_id
            dc_dir = r.dc_dir

            # 计算余额：借方余额科目 = dr - cr, 贷方余额科目 = cr - dr
            if dc_dir == 652:  # 借方
                balance = dr - cr
            else:  # 653 贷方
                balance = cr - dr

            item = {
                "code": r.acc_code,
                "name": r.acc_name or r.acc_code,
                "debit": round(dr, 2),
                "credit": round(cr, 2),
                "balance": round(balance, 2)
            }

            if type_id == 6:  # 资产
                assets.append(item)
                # 资产类：借方余额为正资产，贷方余额（如坏账准备）为资产减项
                if dc_dir == 652:
                    total_assets += balance
                else:
                    total_assets -= balance  # 减值准备等抵减资产
            elif type_id == 7:  # 负债
                liabilities.append(item)
                total_liabilities += balance
            elif type_id == 9:  # 权益
                equity.append(item)
                total_equity += balance
            elif type_id == 8:  # 共同
                # 共同类根据余额方向分配到资产或负债
                if balance >= 0:
                    assets.append(item)
                    total_assets += balance
                else:
                    item["balance"] = abs(balance)
                    liabilities.append(item)
                    total_liabilities += abs(balance)
            elif type_id == 11:  # 损益类
                # 收入(653): cr-dr为正数=收入; 费用(652): dr-cr为正数=费用
                # 对权益的净影响 = 收入 - 费用 = Σ(cr - dr)
                undistributed_profit += (cr - dr)

        # 如果有未结转的损益净额，作为"本年利润（未结转）"计入权益
        undistributed_profit = round(undistributed_profit, 2)
        if abs(undistributed_profit) >= 0.01:
            equity.append({
                "code": "----",
                "name": "本年利润（未结转）",
                "debit": 0,
                "credit": 0,
                "balance": undistributed_profit
            })
            total_equity += undistributed_profit

        return {
            "success": True,
            "data": {
                "year": year,
                "period": period,
                "assets": assets,
                "liabilities": liabilities,
                "equity": equity,
                "total_assets": round(total_assets, 2),
                "total_liabilities": round(total_liabilities, 2),
                "total_equity": round(total_equity, 2),
                "total_liabilities_equity": round(total_liabilities + total_equity, 2),
                "is_balanced": abs(total_assets - (total_liabilities + total_equity)) < 0.01
            }
        }
    except Exception as e:
        logger.error(f"生成资产负债表失败: {e}")
        return {"success": False, "message": str(e)}


@router.get("/reports/income-statement")
def get_income_statement(
    year: int = Query(..., description="会计年度"),
    period: int = Query(..., description="会计期间"),
    db: Session = Depends(get_fbl_db)
):
    """
    利润表（损益表）
    计算指定期间的收入、成本、费用和利润。
    损益类科目 typeId=11，方向653为收入类，652为费用/成本类。
    """
    try:
        # 获取当期损益类科目发生额（仅当期，不累计之前期间）
        # 通过 gl_entry.idaccount -> aa_account.id 获取真实科目编码
        # 排除期间损益结转凭证（SourceType='Trans'），否则损益科目借贷相抵为0
        query_current = text("""
            WITH entry_data AS (
                SELECT 
                    LEFT(a.code, 4) AS acc_code,
                    SUM(COALESCE(e.amountdr, 0)) AS total_dr,
                    SUM(COALESCE(e.amountcr, 0)) AS total_cr
                FROM gl_entry e
                JOIN gl_doc d ON e."idDocDTO" = d.id
                JOIN aa_account a ON e.idaccount = a.id
                WHERE d.ispost = 1
                AND d.accountingyear = :year AND d.accountingperiod = :period
                AND COALESCE(d."SourceType", '') != 'Trans'
                GROUP BY LEFT(a.code, 4)
            )
            SELECT 
                ed.acc_code,
                p.name AS acc_name,
                p."dcdirection" AS dc_dir,
                ed.total_dr,
                ed.total_cr
            FROM entry_data ed
            LEFT JOIN (
                SELECT DISTINCT ON (code) code, name, "dcdirection", "idaccounttypeDTO"
                FROM aa_account WHERE depth = 1 ORDER BY code, id
            ) p ON ed.acc_code = p.code
            WHERE p."idaccounttypeDTO" = 11
            ORDER BY ed.acc_code
        """)

        # 获取本年累计发生额（同样排除期间损益结转凭证）
        query_ytd = text("""
            WITH entry_data AS (
                SELECT 
                    LEFT(a.code, 4) AS acc_code,
                    SUM(COALESCE(e.amountdr, 0)) AS total_dr,
                    SUM(COALESCE(e.amountcr, 0)) AS total_cr
                FROM gl_entry e
                JOIN gl_doc d ON e."idDocDTO" = d.id
                JOIN aa_account a ON e.idaccount = a.id
                WHERE d.ispost = 1
                AND d.accountingyear = :year AND d.accountingperiod <= :period
                AND COALESCE(d."SourceType", '') != 'Trans'
                GROUP BY LEFT(a.code, 4)
            )
            SELECT 
                ed.acc_code,
                p.name AS acc_name,
                p."dcdirection" AS dc_dir,
                ed.total_dr,
                ed.total_cr
            FROM entry_data ed
            LEFT JOIN (
                SELECT DISTINCT ON (code) code, name, "dcdirection", "idaccounttypeDTO"
                FROM aa_account WHERE depth = 1 ORDER BY code, id
            ) p ON ed.acc_code = p.code
            WHERE p."idaccounttypeDTO" = 11
            ORDER BY ed.acc_code
        """)

        rows_current = db.execute(query_current, {"year": year, "period": period}).fetchall()
        rows_ytd = db.execute(query_ytd, {"year": year, "period": period}).fetchall()

        # 构建本年累计的映射
        ytd_map = {}
        for r in rows_ytd:
            dr = float(r.total_dr or 0)
            cr = float(r.total_cr or 0)
            if r.dc_dir == 653:  # 收入类: 贷方 - 借方
                amount = cr - dr
            else:  # 费用类: 借方 - 贷方
                amount = dr - cr
            ytd_map[r.acc_code] = round(amount, 2)

        revenue_items = []    # 收入类 (dc_dir=653)
        expense_items = []    # 费用/成本类 (dc_dir=652)

        total_revenue_current = 0
        total_expense_current = 0

        for r in rows_current:
            dr = float(r.total_dr or 0)
            cr = float(r.total_cr or 0)

            if r.dc_dir == 653:  # 收入类
                current_amount = cr - dr
                total_revenue_current += current_amount
                revenue_items.append({
                    "code": r.acc_code,
                    "name": r.acc_name or r.acc_code,
                    "current": round(current_amount, 2),
                    "ytd": ytd_map.get(r.acc_code, 0)
                })
            else:  # 652 费用/成本类
                current_amount = dr - cr
                total_expense_current += current_amount
                expense_items.append({
                    "code": r.acc_code,
                    "name": r.acc_name or r.acc_code,
                    "current": round(current_amount, 2),
                    "ytd": ytd_map.get(r.acc_code, 0)
                })

        total_revenue_ytd = sum(ytd_map.get(i["code"], 0) for i in revenue_items)
        total_expense_ytd = sum(ytd_map.get(i["code"], 0) for i in expense_items)

        profit_current = round(total_revenue_current - total_expense_current, 2)
        profit_ytd = round(total_revenue_ytd - total_expense_ytd, 2)

        return {
            "success": True,
            "data": {
                "year": year,
                "period": period,
                "revenue_items": revenue_items,
                "expense_items": expense_items,
                "total_revenue_current": round(total_revenue_current, 2),
                "total_revenue_ytd": round(total_revenue_ytd, 2),
                "total_expense_current": round(total_expense_current, 2),
                "total_expense_ytd": round(total_expense_ytd, 2),
                "profit_current": profit_current,
                "profit_ytd": profit_ytd
            }
        }
    except Exception as e:
        logger.error(f"生成损益表失败: {e}")
        return {"success": False, "message": str(e)}


# ==================== 应收/应付科目余额表 ====================

def _auto_detect_subledger_accounts(
    db: Session,
    account_type_ids: List[int]
) -> List[str]:
    """
    自动检测有往来单位辅助核算的科目编码前缀。
    
    通过查找 gl_auxiliaryinfo 中有 idauxAccCustomer 的分录，
    反查其科目，再按 aa_account 的 idaccounttypeDTO 筛选。
    返回一级科目编码列表（去重）。
    """
    try:
        type_list = ",".join(str(t) for t in account_type_ids)
        detect_query = text(f"""
            SELECT DISTINCT LEFT(a.code, 4) AS prefix_code
            FROM gl_auxiliaryinfo aux
            JOIN gl_entry e ON aux."idEntryDTO" = e.id
            JOIN aa_account a ON e.idaccount = a.id
            LEFT JOIN (
                SELECT DISTINCT ON (code) code, "idaccounttypeDTO"
                FROM aa_account WHERE depth = 1 ORDER BY code, id
            ) parent ON LEFT(a.code, 4) = parent.code
            WHERE aux."idauxAccCustomer" IS NOT NULL 
            AND aux."idauxAccCustomer" != 0
            AND parent."idaccounttypeDTO" IN ({type_list})
            ORDER BY prefix_code
        """)
        rows = db.execute(detect_query).fetchall()
        return [r.prefix_code for r in rows if r.prefix_code]
    except Exception as e:
        logger.warning(f"自动检测科目失败: {e}")
        return []


def _get_subledger_balance(
    db: Session,
    year: int,
    period: int,
    account_code_prefixes: List[str],
    report_name: str
) -> dict:
    """
    通用科目余额表查询（按往来单位明细展开）
    
    计算逻辑:
    - 期初余额: 截止到当前期间之前的所有已过账凭证的借方/贷方合计
    - 本期发生额: 当前期间已过账凭证的借方/贷方合计
    - 本年累计: 当年截止到当前期间的借方/贷方合计
    - 期末余额: 期初余额 + 本期借方 - 本期贷方 (借方余额科目)
                 期初余额 + 本期贷方 - 本期借方 (贷方余额科目)
    """
    try:
        if not account_code_prefixes:
            return {
                "success": True,
                "data": {
                    "year": year, "period": period, "report_name": report_name,
                    "accounts": [], "detected_prefixes": [],
                    "grand_total": {
                        "opening_dr": 0, "opening_cr": 0,
                        "current_dr": 0, "current_cr": 0,
                        "ytd_dr": 0, "ytd_cr": 0,
                        "opening_balance": 0, "opening_direction": "借",
                        "closing_balance": 0, "closing_direction": "借",
                    },
                },
                "message": f"未找到有往来单位辅助核算的相关科目，请检查科目设置"
            }

        # 构建 account code 的 LIKE 条件（只允许数字，防止 SQL 注入）
        safe_prefixes = [p for p in account_code_prefixes if p.isdigit()]
        if not safe_prefixes:
            return {"success": False, "message": "无有效的科目编码前缀"}
        like_conditions = " OR ".join([f"a.code LIKE '{prefix}%'" for prefix in safe_prefixes])

        query = text(f"""
            SELECT 
                a.id AS account_id,
                a.code AS account_code,
                a.name AS account_name,
                a."dcdirection" AS dc_direction,
                COALESCE(aux."idauxAccCustomer", 0) AS partner_id,
                p.name AS partner_name,
                p.code AS partner_code,
                -- 期初余额（当前期间之前）
                SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS opening_dr,
                SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS opening_cr,
                -- 本期发生额
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS current_dr,
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS current_cr,
                -- 本年累计
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS ytd_dr,
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS ytd_cr
            FROM gl_entry e
            JOIN gl_doc d ON e."idDocDTO" = d.id
            JOIN aa_account a ON e.idaccount = a.id
            LEFT JOIN gl_auxiliaryinfo aux ON aux."idEntryDTO" = e.id
            LEFT JOIN aa_partner p ON aux."idauxAccCustomer" = p.id
            WHERE d.ispost = 1
            AND (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod <= :period))
            AND ({like_conditions})
            GROUP BY a.id, a.code, a.name, a."dcdirection", 
                     COALESCE(aux."idauxAccCustomer", 0), p.name, p.code
            ORDER BY a.code, p.name NULLS FIRST
        """)

        rows = db.execute(query, {"year": year, "period": period}).fetchall()

        # 按科目分组整理数据
        accounts_map = {}  # {account_code: {info, items[], subtotal}}
        grand_total = {
            "opening_dr": 0, "opening_cr": 0,
            "current_dr": 0, "current_cr": 0,
            "ytd_dr": 0, "ytd_cr": 0,
            "closing_dr": 0, "closing_cr": 0,
        }

        for r in rows:
            acc_code = r.account_code
            dc_dir = r.dc_direction  # 652=借方, 653=贷方

            opening_dr = float(r.opening_dr or 0)
            opening_cr = float(r.opening_cr or 0)
            current_dr = float(r.current_dr or 0)
            current_cr = float(r.current_cr or 0)
            ytd_dr = float(r.ytd_dr or 0)
            ytd_cr = float(r.ytd_cr or 0)

            # 期初余额
            if dc_dir == 652:  # 借方余额科目
                opening_balance = opening_dr - opening_cr
            else:  # 贷方余额科目
                opening_balance = opening_cr - opening_dr

            # 期末余额 = 期初 + 本期借方 - 本期贷方 (借方余额) / 期初 + 本期贷方 - 本期借方 (贷方余额)
            if dc_dir == 652:
                closing_balance = opening_balance + current_dr - current_cr
            else:
                closing_balance = opening_balance + current_cr - current_dr

            # 余额方向
            opening_direction = "借" if opening_balance >= 0 else "贷"
            closing_direction = "借" if closing_balance >= 0 else "贷"

            item = {
                "partner_id": r.partner_id,
                "partner_name": r.partner_name or ("（无往来单位）" if r.partner_id == 0 else f"ID:{r.partner_id}"),
                "partner_code": r.partner_code or "",
                "opening_balance": round(abs(opening_balance), 2),
                "opening_direction": opening_direction,
                "current_dr": round(current_dr, 2),
                "current_cr": round(current_cr, 2),
                "ytd_dr": round(ytd_dr, 2),
                "ytd_cr": round(ytd_cr, 2),
                "closing_balance": round(abs(closing_balance), 2),
                "closing_direction": closing_direction,
            }

            if acc_code not in accounts_map:
                accounts_map[acc_code] = {
                    "account_code": acc_code,
                    "account_name": r.account_name or acc_code,
                    "dc_direction": dc_dir,
                    "items": [],
                    "subtotal": {
                        "opening_dr": 0, "opening_cr": 0,
                        "current_dr": 0, "current_cr": 0,
                        "ytd_dr": 0, "ytd_cr": 0,
                        "closing_balance": 0,
                    }
                }

            accounts_map[acc_code]["items"].append(item)

            # 累计小计
            sub = accounts_map[acc_code]["subtotal"]
            sub["opening_dr"] += opening_dr
            sub["opening_cr"] += opening_cr
            sub["current_dr"] += current_dr
            sub["current_cr"] += current_cr
            sub["ytd_dr"] += ytd_dr
            sub["ytd_cr"] += ytd_cr

        # 计算各科目小计和合计
        accounts_list = []
        for acc_code in sorted(accounts_map.keys()):
            acc = accounts_map[acc_code]
            sub = acc["subtotal"]
            dc_dir = acc["dc_direction"]

            # 科目小计余额
            if dc_dir == 652:
                sub_opening = sub["opening_dr"] - sub["opening_cr"]
                sub_closing = sub_opening + sub["current_dr"] - sub["current_cr"]
            else:
                sub_opening = sub["opening_cr"] - sub["opening_dr"]
                sub_closing = sub_opening + sub["current_cr"] - sub["current_dr"]

            sub["opening_balance"] = round(abs(sub_opening), 2)
            sub["opening_direction"] = "借" if sub_opening >= 0 else "贷"
            sub["closing_balance"] = round(abs(sub_closing), 2)
            sub["closing_direction"] = "借" if sub_closing >= 0 else "贷"
            sub["current_dr"] = round(sub["current_dr"], 2)
            sub["current_cr"] = round(sub["current_cr"], 2)
            sub["ytd_dr"] = round(sub["ytd_dr"], 2)
            sub["ytd_cr"] = round(sub["ytd_cr"], 2)

            accounts_list.append(acc)

            # 累计合计
            grand_total["opening_dr"] += sub["opening_dr"]
            grand_total["opening_cr"] += sub["opening_cr"]
            grand_total["current_dr"] += sub["current_dr"]
            grand_total["current_cr"] += sub["current_cr"]
            grand_total["ytd_dr"] += sub["ytd_dr"]
            grand_total["ytd_cr"] += sub["ytd_cr"]

        # 合计余额
        gt_opening = grand_total["opening_dr"] - grand_total["opening_cr"]
        gt_closing = gt_opening + grand_total["current_dr"] - grand_total["current_cr"]
        grand_total["opening_balance"] = round(abs(gt_opening), 2)
        grand_total["opening_direction"] = "借" if gt_opening >= 0 else "贷"
        grand_total["closing_balance"] = round(abs(gt_closing), 2)
        grand_total["closing_direction"] = "借" if gt_closing >= 0 else "贷"
        grand_total["current_dr"] = round(grand_total["current_dr"], 2)
        grand_total["current_cr"] = round(grand_total["current_cr"], 2)
        grand_total["ytd_dr"] = round(grand_total["ytd_dr"], 2)
        grand_total["ytd_cr"] = round(grand_total["ytd_cr"], 2)

        return {
            "success": True,
            "data": {
                "year": year,
                "period": period,
                "report_name": report_name,
                "accounts": accounts_list,
                "grand_total": grand_total,
                "detected_prefixes": safe_prefixes,
            }
        }
    except Exception as e:
        logger.error(f"生成{report_name}失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/reports/receivable-balance")
def get_receivable_balance(
    year: int = Query(..., description="会计年度"),
    period: int = Query(..., description="会计期间"),
    account_codes: Optional[str] = Query(None, description="自定义科目编码前缀（逗号分隔），留空则自动检测资产类有往来单位辅助核算的科目"),
    db: Session = Depends(get_fbl_db)
):
    """
    应收科目余额表
    
    显示应收类科目（应收账款、预付账款、其他应收款等）的余额明细，
    按往来单位展开。
    
    默认行为：自动检测资产类(type=6)和共同类(type=8)中有往来单位辅助核算的科目。
    也可手动指定科目编码前缀。
    """
    if account_codes:
        prefixes = [s.strip() for s in account_codes.split(",")]
    else:
        # 自动检测：资产类(6) + 共同类(8) 中有往来单位辅助核算的科目
        prefixes = _auto_detect_subledger_accounts(db, account_type_ids=[6, 8])
        logger.info(f"应收科目余额表 - 自动检测到科目前缀: {prefixes}")
    return _get_subledger_balance(db, year, period, prefixes, "应收科目余额表")


@router.get("/reports/payable-balance")
def get_payable_balance(
    year: int = Query(..., description="会计年度"),
    period: int = Query(..., description="会计期间"),
    account_codes: Optional[str] = Query(None, description="自定义科目编码前缀（逗号分隔），留空则自动检测负债类有往来单位辅助核算的科目"),
    db: Session = Depends(get_fbl_db)
):
    """
    应付科目余额表
    
    显示应付类科目（应付账款、预收账款、其他应付款等）的余额明细，
    按往来单位展开。
    
    默认行为：自动检测负债类(type=7)和共同类(type=8)中有往来单位辅助核算的科目。
    也可手动指定科目编码前缀。
    """
    if account_codes:
        prefixes = [s.strip() for s in account_codes.split(",")]
    else:
        # 自动检测：负债类(7) + 共同类(8) 中有往来单位辅助核算的科目
        prefixes = _auto_detect_subledger_accounts(db, account_type_ids=[7, 8])
        logger.info(f"应付科目余额表 - 自动检测到科目前缀: {prefixes}")
    return _get_subledger_balance(db, year, period, prefixes, "应付科目余额表")


# ==================== 科目余额表（全部科目 + 应收应付明细） ====================

@router.get("/reports/account-balance")
def get_account_balance(
    year: int = Query(..., description="会计年度"),
    period: int = Query(..., description="会计期间"),
    show_zero: bool = Query(False, description="是否显示无发生额科目"),
    level: int = Query(0, description="科目级别 0=末级 1=一级汇总"),
    db: Session = Depends(get_fbl_db)
):
    """
    科目余额表 - 显示所有科目的期初余额、本期发生额、本年累计、期末余额。
    对有往来单位辅助核算的科目，附带 partner_detail 可展开。
    """
    try:
        # 1. 查询所有末级科目的汇总数据
        query = text("""
            SELECT 
                a.id AS account_id,
                a.code AS account_code,
                a.name AS account_name,
                a."dcdirection" AS dc_direction,
                -- 期初余额（当前期间之前所有已过账凭证）
                SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS opening_dr,
                SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS opening_cr,
                -- 本期发生额
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS current_dr,
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS current_cr,
                -- 本年累计
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                    THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS ytd_dr,
                SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                    THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS ytd_cr
            FROM gl_entry e
            JOIN gl_doc d ON e."idDocDTO" = d.id
            JOIN aa_account a ON e.idaccount = a.id
            WHERE d.ispost = 1
            AND (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod <= :period))
            GROUP BY a.id, a.code, a.name, a."dcdirection"
            ORDER BY a.code
        """)
        rows = db.execute(query, {"year": year, "period": period}).fetchall()

        # 2. 查询一级科目的名称和类型信息
        parent_query = text("""
            SELECT DISTINCT ON (code) code, name, "idaccounttypeDTO", "dcdirection"
            FROM aa_account WHERE depth = 1 ORDER BY code, id
        """)
        parent_rows = db.execute(parent_query).fetchall()
        parent_map = {r.code: {"name": r.name, "type_id": r.idaccounttypeDTO, "dc_dir": r.dcdirection} for r in parent_rows}

        # 3. 检测有往来单位辅助核算的科目
        aux_query = text("""
            SELECT DISTINCT e.idaccount
            FROM gl_auxiliaryinfo aux
            JOIN gl_entry e ON aux."idEntryDTO" = e.id
            WHERE aux."idauxAccCustomer" IS NOT NULL AND aux."idauxAccCustomer" != 0
        """)
        aux_rows = db.execute(aux_query).fetchall()
        accounts_with_partners = set(r.idaccount for r in aux_rows)

        # 4. 对有往来辅助核算的科目，查询往来单位明细
        partner_detail_map = {}  # {account_id: [items]}
        if accounts_with_partners:
            acc_id_list = ",".join(str(aid) for aid in accounts_with_partners)
            detail_query = text(f"""
                SELECT 
                    e.idaccount AS account_id,
                    a."dcdirection" AS dc_direction,
                    COALESCE(aux."idauxAccCustomer", 0) AS partner_id,
                    p.name AS partner_name,
                    p.code AS partner_code,
                    SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                        THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS opening_dr,
                    SUM(CASE WHEN (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod < :period))
                        THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS opening_cr,
                    SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                        THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS current_dr,
                    SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod = :period
                        THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS current_cr,
                    SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                        THEN COALESCE(e.amountdr, 0) ELSE 0 END) AS ytd_dr,
                    SUM(CASE WHEN d.accountingyear = :year AND d.accountingperiod <= :period
                        THEN COALESCE(e.amountcr, 0) ELSE 0 END) AS ytd_cr
                FROM gl_entry e
                JOIN gl_doc d ON e."idDocDTO" = d.id
                JOIN aa_account a ON e.idaccount = a.id
                LEFT JOIN gl_auxiliaryinfo aux ON aux."idEntryDTO" = e.id
                LEFT JOIN aa_partner p ON aux."idauxAccCustomer" = p.id
                WHERE d.ispost = 1
                AND e.idaccount IN ({acc_id_list})
                AND (d.accountingyear < :year OR (d.accountingyear = :year AND d.accountingperiod <= :period))
                GROUP BY e.idaccount, a."dcdirection", COALESCE(aux."idauxAccCustomer", 0), p.name, p.code
                ORDER BY e.idaccount, p.name NULLS FIRST
            """)
            detail_rows = db.execute(detail_query, {"year": year, "period": period}).fetchall()

            for r in detail_rows:
                acc_id = r.account_id
                dc_dir = r.dc_direction
                o_dr = float(r.opening_dr or 0)
                o_cr = float(r.opening_cr or 0)
                c_dr = float(r.current_dr or 0)
                c_cr = float(r.current_cr or 0)
                y_dr = float(r.ytd_dr or 0)
                y_cr = float(r.ytd_cr or 0)

                if dc_dir == 652:
                    opening_bal = o_dr - o_cr
                    closing_bal = opening_bal + c_dr - c_cr
                else:
                    opening_bal = o_cr - o_dr
                    closing_bal = opening_bal + c_cr - c_dr

                item = {
                    "partner_id": r.partner_id,
                    "partner_name": r.partner_name or ("（无往来单位）" if r.partner_id == 0 else f"ID:{r.partner_id}"),
                    "partner_code": r.partner_code or "",
                    "opening_balance": round(abs(opening_bal), 2),
                    "opening_direction": "借" if opening_bal >= 0 else "贷",
                    "current_dr": round(c_dr, 2),
                    "current_cr": round(c_cr, 2),
                    "ytd_dr": round(y_dr, 2),
                    "ytd_cr": round(y_cr, 2),
                    "closing_balance": round(abs(closing_bal), 2),
                    "closing_direction": "借" if closing_bal >= 0 else "贷",
                }
                if acc_id not in partner_detail_map:
                    partner_detail_map[acc_id] = []
                partner_detail_map[acc_id].append(item)

        # 5. 组装结果
        accounts_list = []
        grand_total = {
            "opening_dr": 0, "opening_cr": 0,
            "current_dr": 0, "current_cr": 0,
            "ytd_dr": 0, "ytd_cr": 0,
        }

        for r in rows:
            dc_dir = r.dc_direction or 652
            o_dr = float(r.opening_dr or 0)
            o_cr = float(r.opening_cr or 0)
            c_dr = float(r.current_dr or 0)
            c_cr = float(r.current_cr or 0)
            y_dr = float(r.ytd_dr or 0)
            y_cr = float(r.ytd_cr or 0)

            if dc_dir == 652:
                opening_bal = o_dr - o_cr
                closing_bal = opening_bal + c_dr - c_cr
            else:
                opening_bal = o_cr - o_dr
                closing_bal = opening_bal + c_cr - c_dr

            # 过滤无发生额科目
            if not show_zero and c_dr == 0 and c_cr == 0 and abs(opening_bal) < 0.01 and abs(closing_bal) < 0.01:
                continue

            prefix4 = r.account_code[:4] if r.account_code else ""
            parent_info = parent_map.get(prefix4, {})
            type_id = parent_info.get("type_id", 0)

            # 判断科目类型名称
            type_names = {6: "资产", 7: "负债", 8: "共同", 9: "权益", 11: "损益"}
            type_name = type_names.get(type_id, "")

            acc_item = {
                "account_id": r.account_id,
                "account_code": r.account_code,
                "account_name": r.account_name or r.account_code,
                "account_type": type_name,
                "account_type_id": type_id,
                "dc_direction": dc_dir,
                "opening_balance": round(abs(opening_bal), 2),
                "opening_direction": "借" if opening_bal >= 0 else "贷",
                "current_dr": round(c_dr, 2),
                "current_cr": round(c_cr, 2),
                "ytd_dr": round(y_dr, 2),
                "ytd_cr": round(y_cr, 2),
                "closing_balance": round(abs(closing_bal), 2),
                "closing_direction": "借" if closing_bal >= 0 else "贷",
                "has_partner_detail": r.account_id in accounts_with_partners,
                "partner_detail": partner_detail_map.get(r.account_id, []),
            }
            accounts_list.append(acc_item)

            grand_total["opening_dr"] += o_dr
            grand_total["opening_cr"] += o_cr
            grand_total["current_dr"] += c_dr
            grand_total["current_cr"] += c_cr
            grand_total["ytd_dr"] += y_dr
            grand_total["ytd_cr"] += y_cr

        # 合计行余额
        gt_opening = grand_total["opening_dr"] - grand_total["opening_cr"]
        gt_closing = gt_opening + grand_total["current_dr"] - grand_total["current_cr"]
        grand_total["opening_balance"] = round(abs(gt_opening), 2)
        grand_total["opening_direction"] = "借" if gt_opening >= 0 else "贷"
        grand_total["closing_balance"] = round(abs(gt_closing), 2)
        grand_total["closing_direction"] = "借" if gt_closing >= 0 else "贷"
        grand_total["current_dr"] = round(grand_total["current_dr"], 2)
        grand_total["current_cr"] = round(grand_total["current_cr"], 2)
        grand_total["ytd_dr"] = round(grand_total["ytd_dr"], 2)
        grand_total["ytd_cr"] = round(grand_total["ytd_cr"], 2)

        return {
            "success": True,
            "data": {
                "year": year,
                "period": period,
                "report_name": "科目余额表",
                "accounts": accounts_list,
                "grand_total": grand_total,
                "total_accounts": len(accounts_list),
                "accounts_with_detail": sum(1 for a in accounts_list if a["has_partner_detail"]),
            }
        }
    except Exception as e:
        logger.error(f"生成科目余额表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/partners")
def get_partners(db: Session = Depends(get_fbl_db)):
    """获取往来单位列表（aa_partner）"""
    try:
        rows = db.execute(text("""
            SELECT id, code, name
            FROM aa_partner
            WHERE disabled = 0 OR disabled IS NULL
            ORDER BY code
        """)).fetchall()
        data = [{"id": r.id, "code": r.code, "name": r.name} for r in rows]
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"获取往来单位失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/currencies")
def get_currencies(db: Session = Depends(get_fbl_db)):
    """获取所有币种信息，含本期最新使用的汇率"""
    try:
        # 获取所有启用的币种
        currencies = db.execute(text("""
            SELECT id, code, name, "isNative", "exchangeRate", "currencySign"
            FROM aa_currency 
            WHERE disabled = 0 OR disabled IS NULL
            ORDER BY "isNative" DESC, id
        """)).fetchall()

        result = []
        for c in currencies:
            item = {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "is_native": bool(c.isNative),
                "default_rate": float(c.exchangeRate) if c.exchangeRate else None,
                "sign": c.currencySign or "",
            }
            # 对非本币，获取最近一笔凭证使用的汇率
            if not c.isNative:
                latest = db.execute(text("""
                    SELECT e.exchangerate
                    FROM gl_entry e
                    JOIN gl_doc d ON e."idDocDTO" = d.id
                    WHERE e.idcurrency = :cid
                    AND e.exchangerate IS NOT NULL AND e.exchangerate > 0
                    AND d.ispost = 1
                    ORDER BY d.voucherdate DESC, d.id DESC
                    LIMIT 1
                """), {"cid": c.id}).fetchone()
                item["latest_rate"] = float(latest.exchangerate) if latest else None
            else:
                item["latest_rate"] = 1.0

            result.append(item)

        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"获取币种列表失败: {e}")
        return {"success": False, "message": str(e)}

@router.get("/closing/status")
def get_period_status(
    year: int = Query(...),
    period: int = Query(...),
    db: Session = Depends(get_fbl_db)
):
    try:
        # Check if table exists
        check_table = text("SELECT to_regclass('fbl_period_status')")
        table_exists = db.execute(check_table).scalar()
        
        if not table_exists:
            return {"success": True, "is_closed": False, "message": "Period status table not found (new system)"}
            
        stmt = text("SELECT is_closed, closed_at FROM fbl_period_status WHERE year = :year AND period = :period")
        row = db.execute(stmt, {"year": year, "period": period}).fetchone()
        
        is_closed = row.is_closed if row else False
        closed_at = row.closed_at if row else None
        
        return {
            "success": True, 
            "year": year, 
            "period": period, 
            "is_closed": is_closed,
            "closed_at": closed_at
        }
    except Exception as e:
        return {"success": False, "message": str(e)}
