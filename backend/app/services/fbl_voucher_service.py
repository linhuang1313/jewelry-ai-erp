"""
FBL 凭证自动生成服务
将 ERP 业务单据（收据、付款等）自动写入梵贝琳财务系统的凭证表。
使用独立的 FBL 数据库连接，与 ERP 主库事务隔离。
"""
import logging
from datetime import datetime, date
from typing import Dict, Any, Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MAX_RETRY = 3


def _get_fbl_session() -> Optional[Session]:
    """获取一个独立的 FBL 数据库会话"""
    try:
        from ..fbl_database import FBLSessionLocal
        if FBLSessionLocal is None:
            return None
        return FBLSessionLocal()
    except Exception as e:
        logger.warning(f"[FBL] 无法创建数据库会话: {e}")
        return None


def _find_account_by_code(fbl_db: Session, code: str) -> Optional[Dict]:
    """按科目编码查找末级科目"""
    row = fbl_db.execute(
        text('SELECT id, code, name FROM aa_account WHERE code = :code AND ("isEndNode" = 1 OR "isEndNode" IS NULL)'),
        {"code": code},
    ).fetchone()
    if row:
        return {"id": row.id, "code": row.code, "name": row.name}
    return None


def _find_account_by_prefix(fbl_db: Session, prefix: str) -> Optional[Dict]:
    """按编码前缀查找第一个可用末级科目"""
    row = fbl_db.execute(
        text("""
            SELECT id, code, name FROM aa_account
            WHERE code LIKE :prefix AND ("isEndNode" = 1 OR "isEndNode" IS NULL)
            AND (disabled IS NULL OR disabled = 0)
            ORDER BY code LIMIT 1
        """),
        {"prefix": prefix + "%"},
    ).fetchone()
    if row:
        return {"id": row.id, "code": row.code, "name": row.name}
    return None


def _find_partner_by_name(fbl_db: Session, name: str) -> Optional[Dict]:
    """按名称精确查找往来单位"""
    row = fbl_db.execute(
        text("SELECT id, code, name FROM aa_partner WHERE name = :name AND (disabled = 0 OR disabled IS NULL) LIMIT 1"),
        {"name": name},
    ).fetchone()
    if row:
        return {"id": row.id, "code": row.code, "name": row.name}
    return None


def _find_voucher_type_by_name(fbl_db: Session, name: str) -> Optional[int]:
    """按名称查找凭证类别 ID"""
    row = fbl_db.execute(
        text("SELECT id FROM aa_doctype WHERE name = :name AND (disabled = 0 OR disabled IS NULL) LIMIT 1"),
        {"name": name},
    ).fetchone()
    return row.id if row else None


def _next_id_locked(fbl_db: Session, table: str, id_col: str = "id") -> int:
    """
    在事务中用 FOR UPDATE 锁定取 MAX(id)+1，防止并发竞态。
    PostgreSQL 不支持直接 SELECT MAX() FOR UPDATE，
    改用 advisory lock 保证同一时刻只有一个进程在生成 ID。
    """
    lock_keys = {"gl_doc": 90001, "gl_entry": 90002, "gl_auxiliaryinfo": 90003}
    lock_key = lock_keys.get(table, hash(table) % 100000)

    fbl_db.execute(text(f"SELECT pg_advisory_xact_lock({lock_key})"))
    quoted_id = f'"{id_col}"' if id_col[0].isupper() else id_col
    max_val = fbl_db.execute(text(f"SELECT MAX({quoted_id}) FROM {table}")).scalar()
    return (max_val or 0) + 1


def create_payment_voucher(
    customer_name: str,
    total_amount: float,
    payment_date: date,
    summary: str,
    bank_account_code: str = "100201",
    receivable_account_code: str = "112201",
    voucher_type_name: str = "收款凭证",
    maker: str = "系统-协同卡片",
) -> Dict[str, Any]:
    """
    自动生成收款凭证到 FBL 财务系统。

    分录模式：
      借：银行存款（bank_account_code）  总金额
      贷：应收账款（receivable_account_code）  总金额  往来单位=客户

    科目编码支持精确匹配 → 前缀回退（如 100201 找不到就按 1002 前缀找第一个末级科目）。
    往来单位必须在 aa_partner 中已存在，不会自动创建。
    """
    fbl_db = _get_fbl_session()
    if fbl_db is None:
        return {"success": False, "message": "FBL 数据库未连接，凭证未生成"}

    try:
        # 1. 查找凭证类别
        type_id = _find_voucher_type_by_name(fbl_db, voucher_type_name)
        if not type_id:
            type_id = _find_voucher_type_by_name(fbl_db, "记账凭证")
        if not type_id:
            return {"success": False, "message": f"FBL 中未找到凭证类别「{voucher_type_name}」"}

        # 2. 查找科目（精确 → 前缀回退）
        bank_acc = _find_account_by_code(fbl_db, bank_account_code)
        if not bank_acc:
            bank_acc = _find_account_by_prefix(fbl_db, bank_account_code[:4])
        if not bank_acc:
            return {"success": False, "message": f"FBL 中未找到银行存款科目（{bank_account_code}）"}

        recv_acc = _find_account_by_code(fbl_db, receivable_account_code)
        if not recv_acc:
            recv_acc = _find_account_by_prefix(fbl_db, receivable_account_code[:4])
        if not recv_acc:
            return {"success": False, "message": f"FBL 中未找到应收账款科目（{receivable_account_code}）"}

        # 3. 查找往来单位（不自动创建）
        partner = _find_partner_by_name(fbl_db, customer_name)
        if not partner:
            return {
                "success": False,
                "message": f"FBL 往来单位中未找到「{customer_name}」，请先在凭证管理-设置中创建往来单位",
            }

        # 4. 生成凭证编号
        v_date = datetime.combine(payment_date, datetime.min.time())
        year = v_date.year
        period = v_date.month

        max_code_res = fbl_db.execute(
            text("SELECT MAX(code) FROM gl_doc WHERE accountingyear = :year AND accountingperiod = :period AND iddoctype = :type_id"),
            {"year": year, "period": period, "type_id": type_id},
        ).scalar()
        new_code_num = 1
        if max_code_res:
            try:
                new_code_num = int(max_code_res) + 1
            except (ValueError, TypeError):
                pass
        new_code = f"{new_code_num:04d}"

        # 5. 用 advisory lock 安全生成 ID
        doc_id = _next_id_locked(fbl_db, "gl_doc")

        # 6. 插入凭证主表
        fbl_db.execute(
            text("""
                INSERT INTO gl_doc (
                    id, code, voucherdate, iddoctype,
                    maker, accountingyear, accountingperiod,
                    createdtime, madedate, docbusinesstype, docsourcetype, "PrintCount"
                ) VALUES (
                    :id, :code, :date, :type_id,
                    :maker, :year, :period,
                    NOW(), :madedate, 0, 0, 0
                )
            """),
            {
                "id": doc_id,
                "code": new_code,
                "date": v_date,
                "type_id": type_id,
                "maker": maker,
                "year": year,
                "period": period,
                "madedate": v_date,
            },
        )

        # 7. 插入分录（ID 同样加锁）
        entry_id_1 = _next_id_locked(fbl_db, "gl_entry")

        insert_entry = text("""
            INSERT INTO gl_entry (
                id, "idDocDTO", summary, idaccount,
                amountdr, amountcr, origamountdr, origamountcr,
                quantitydr, quantitycr, price, unit,
                sequencenumber, idcurrency, exchangerate
            ) VALUES (
                :id, :doc_id, :summary, :account_id,
                :debit, :credit, :origdr, :origcr,
                0, 0, 0, '',
                :seq, 4, 1.0
            )
        """)

        fbl_db.execute(insert_entry, {
            "id": entry_id_1,
            "doc_id": doc_id,
            "summary": summary,
            "account_id": bank_acc["id"],
            "debit": total_amount,
            "credit": 0,
            "origdr": total_amount,
            "origcr": 0,
            "seq": 1,
        })

        entry_id_2 = entry_id_1 + 1
        fbl_db.execute(insert_entry, {
            "id": entry_id_2,
            "doc_id": doc_id,
            "summary": summary,
            "account_id": recv_acc["id"],
            "debit": 0,
            "credit": total_amount,
            "origdr": 0,
            "origcr": total_amount,
            "seq": 2,
        })

        # 8. 插入往来单位辅助核算（贷方分录关联客户）
        aux_id = _next_id_locked(fbl_db, "gl_auxiliaryinfo", id_col="ID")
        fbl_db.execute(
            text("""
                INSERT INTO gl_auxiliaryinfo (
                    "ID", code, "DocId", "idEntryDTO", "idauxAccCustomer", exchangerate
                ) VALUES (
                    :aux_id, '0000', :doc_id, :entry_id, :partner_id, 1.0
                )
            """),
            {
                "aux_id": aux_id,
                "doc_id": doc_id,
                "entry_id": entry_id_2,
                "partner_id": partner["id"],
            },
        )

        fbl_db.commit()

        logger.info(
            f"[FBL] 收款凭证已生成: doc_id={doc_id}, code={new_code}, "
            f"借 {bank_acc['name']} ¥{total_amount:,.2f} / 贷 {recv_acc['name']} ¥{total_amount:,.2f} "
            f"(往来={customer_name})"
        )

        return {
            "success": True,
            "voucher_id": doc_id,
            "voucher_code": new_code,
            "voucher_type": voucher_type_name,
            "debit_account": f"{bank_acc['code']} {bank_acc['name']}",
            "credit_account": f"{recv_acc['code']} {recv_acc['name']}",
            "partner_name": partner["name"],
            "amount": total_amount,
        }

    except Exception as e:
        fbl_db.rollback()
        logger.error(f"[FBL] 生成收款凭证失败: {e}", exc_info=True)
        return {"success": False, "message": f"FBL 凭证生成失败: {str(e)}"}
    finally:
        fbl_db.close()
