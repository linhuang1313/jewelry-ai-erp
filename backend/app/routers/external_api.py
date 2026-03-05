"""
外部API - 填制凭证接口

提供给外部系统通过API调用的方式创建财务凭证。
所有请求必须通过 X-API-Key 身份验证。

使用示例：
  POST /api/external/vouchers
  Headers: X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  Body: {
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "entry_rows": [...]
  }
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List
from datetime import datetime
import logging

from ..fbl_database import get_fbl_db
from ..core.api_key_auth import verify_api_key
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/external",
    tags=["外部API - 凭证管理"],
    dependencies=[Depends(verify_api_key)]  # 所有路由都需要API Key认证
)


# ==================== 数据模型 ====================

class ExternalVoucherEntryCreate(BaseModel):
    """凭证分录"""
    summary: str = Field(..., description="摘要", min_length=1, max_length=200)
    account_id: int = Field(..., description="科目ID", gt=0)
    debit: float = Field(default=0.0, description="借方金额", ge=0)
    credit: float = Field(default=0.0, description="贷方金额", ge=0)
    unit: str = Field(default="克", description="计量单位", max_length=20)
    quantity: float = Field(default=0.0, description="数量", ge=0)
    price: float = Field(default=0.0, description="单价", ge=0)
    direction: str = Field(default="debit", description="方向: debit/credit")
    
    # 外币字段（可选）
    currency_id: Optional[int] = Field(None, description="外币币种ID，不填则为本币(4)")
    exchange_rate: Optional[float] = Field(None, description="汇率", ge=0)
    orig_amount: Optional[float] = Field(None, description="原币金额", ge=0)
    
    # 往来单位（可选）
    partner_id: Optional[int] = Field(None, description="往来单位ID", gt=0)


class ExternalVoucherCreate(BaseModel):
    """创建凭证请求"""
    voucher_date: str = Field(..., description="凭证日期 (YYYY-MM-DD)", pattern=r"^\d{4}-\d{2}-\d{2}$")
    voucher_type_id: int = Field(..., description="凭证类别ID", gt=0)
    entry_rows: List[ExternalVoucherEntryCreate] = Field(..., description="凭证分录列表", min_length=1)
    maker: str = Field(default="External API", description="制单人", max_length=50)
    remark: Optional[str] = Field(None, description="备注", max_length=500)


class ExternalVoucherResponse(BaseModel):
    """创建凭证响应"""
    success: bool
    message: str
    data: Optional[dict] = None
    error_details: Optional[dict] = None


# ==================== 验证函数 ====================

def _validate_voucher_date(date_str: str) -> datetime:
    """验证并解析凭证日期"""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"日期格式错误: {date_str}，应为 YYYY-MM-DD")


def _validate_entries_balance(entries: List[ExternalVoucherEntryCreate]) -> tuple[float, float]:
    """验证凭证分录借贷平衡"""
    total_debit = sum(e.debit for e in entries)
    total_credit = sum(e.credit for e in entries)
    
    if abs(total_debit - total_credit) > 0.000001:
        raise ValueError(
            f"借贷不平衡: 借方合计 {total_debit:.2f}，贷方合计 {total_credit:.2f}"
        )
    
    return total_debit, total_credit


def _validate_entry_amounts(entry: ExternalVoucherEntryCreate) -> None:
    """验证单条分录的金额"""
    # 借贷不能同时有值
    if entry.debit > 0 and entry.credit > 0:
        raise ValueError(f"分录 '{entry.summary}' 借贷不能同时有值")
    
    # 至少有一个金额
    if entry.debit == 0 and entry.credit == 0:
        raise ValueError(f"分录 '{entry.summary}' 借贷金额不能都为0")
    
    # 外币验证
    if entry.currency_id and entry.currency_id != 4:
        if not entry.exchange_rate or entry.exchange_rate <= 0:
            raise ValueError(f"分录 '{entry.summary}' 外币必须提供有效的汇率")
        if not entry.orig_amount or entry.orig_amount <= 0:
            raise ValueError(f"分录 '{entry.summary}' 外币必须提供有效的原币金额")


# ==================== API 端点 ====================

@router.post("/vouchers", response_model=ExternalVoucherResponse)
async def create_voucher_external(
    voucher: ExternalVoucherCreate,
    api_key: str = Depends(verify_api_key),
    db: Session = Depends(get_fbl_db)
) -> ExternalVoucherResponse:
    """
    创建财务凭证 (外部API)
    
    通过此接口，外部系统可以创建财务凭证。
    
    **身份验证**
    - 必须在请求头中提供 X-API-Key
    - 示例: `X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
    
    **请求体参数**
    - voucher_date: 凭证日期 (YYYY-MM-DD)
    - voucher_type_id: 凭证类别ID
    - entry_rows: 凭证分录列表（至少1条）
    - maker: 制单人（可选，默认为 "External API"）
    - remark: 备注（可选）
    
    **分录参数**
    - summary: 摘要（必填）
    - account_id: 科目ID（必填）
    - debit: 借方金额（可选，默认0）
    - credit: 贷方金额（可选，默认0）
    - unit: 计量单位（可选，默认"克"）
    - quantity: 数量（可选，默认0）
    - price: 单价（可选，默认0）
    - direction: 方向（可选，debit/credit）
    - currency_id: 外币币种ID（可选，不填为本币）
    - exchange_rate: 汇率（外币时必填）
    - orig_amount: 原币金额（外币时必填）
    - partner_id: 往来单位ID（可选）
    
    **业务规则**
    - 借贷必须平衡（借方合计 = 贷方合计）
    - 每条分录的借贷不能同时有值
    - 每条分录的借贷至少有一个有值
    - 外币分录必须提供汇率和原币金额
    
    **返回值**
    - success: 是否成功
    - message: 提示信息
    - data: 成功时返回凭证ID和凭证号
    - error_details: 失败时返回详细错误信息
    
    **示例请求**
    ```json
    {
      "voucher_date": "2026-01-30",
      "voucher_type_id": 1,
      "maker": "外部系统",
      "entry_rows": [
        {
          "summary": "销售收入",
          "account_id": 10,
          "debit": 1000.00,
          "credit": 0
        },
        {
          "summary": "应收账款",
          "account_id": 20,
          "debit": 0,
          "credit": 1000.00
        }
      ]
    }
    ```
    
    **示例响应 (成功)**
    ```json
    {
      "success": true,
      "message": "凭证创建成功",
      "data": {
        "id": 12345,
        "code": "0001",
        "voucher_date": "2026-01-30"
      }
    }
    ```
    
    **示例响应 (失败)**
    ```json
    {
      "success": false,
      "message": "创建失败",
      "error_details": {
        "code": "VALIDATION_ERROR",
        "message": "借贷不平衡: 借方合计 1000.00，贷方合计 900.00"
      }
    }
    ```
    """
    try:
        # 1. 参数验证
        logger.info(f"[外部API] 收到凭证创建请求，API Key: {api_key[:8]}...")
        
        # 验证日期格式
        try:
            v_date = _validate_voucher_date(voucher.voucher_date)
        except ValueError as e:
            logger.warning(f"[外部API] 日期验证失败: {e}")
            return ExternalVoucherResponse(
                success=False,
                message="参数验证失败",
                error_details={
                    "code": "INVALID_DATE",
                    "message": str(e)
                }
            )
        
        # 验证分录列表
        if not voucher.entry_rows or len(voucher.entry_rows) == 0:
            logger.warning("[外部API] 分录列表为空")
            return ExternalVoucherResponse(
                success=False,
                message="参数验证失败",
                error_details={
                    "code": "EMPTY_ENTRIES",
                    "message": "凭证分录列表不能为空"
                }
            )
        
        # 验证单条分录
        for idx, entry in enumerate(voucher.entry_rows):
            try:
                _validate_entry_amounts(entry)
            except ValueError as e:
                logger.warning(f"[外部API] 分录 {idx} 验证失败: {e}")
                return ExternalVoucherResponse(
                    success=False,
                    message="参数验证失败",
                    error_details={
                        "code": "INVALID_ENTRY",
                        "message": str(e),
                        "entry_index": idx
                    }
                )
        
        # 验证借贷平衡
        try:
            total_debit, total_credit = _validate_entries_balance(voucher.entry_rows)
        except ValueError as e:
            logger.warning(f"[外部API] 借贷平衡验证失败: {e}")
            return ExternalVoucherResponse(
                success=False,
                message="参数验证失败",
                error_details={
                    "code": "UNBALANCED_ENTRIES",
                    "message": str(e)
                }
            )
        
        # 2. 数据库操作
        try:
            year = v_date.year
            period = v_date.month
            
            # 生成凭证号
            max_code_query = text("""
                SELECT MAX(code) FROM gl_doc 
                WHERE accountingyear = :year AND accountingperiod = :period AND iddoctype = :type_id
            """)
            max_code_res = db.execute(max_code_query, {
                "year": year,
                "period": period,
                "type_id": voucher.voucher_type_id
            }).scalar()
            
            new_code_num = 1
            if max_code_res:
                try:
                    new_code_num = int(max_code_res) + 1
                except (ValueError, TypeError):
                    pass
            
            new_code = f"{new_code_num:04d}"
            
            # 生成凭证ID
            max_id_query = text("SELECT MAX(id) FROM gl_doc")
            max_id = db.execute(max_id_query).scalar()
            new_doc_id = (max_id or 0) + 1
            
            # 插入凭证头
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
            
            # 获取分录起始ID
            max_entry_id_query = text("SELECT MAX(id) FROM gl_entry")
            max_entry_id = db.execute(max_entry_id_query).scalar()
            current_entry_id = (max_entry_id or 0)
            
            # 插入分录
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
                
                # 计算数量方向
                quantitydr = entry.quantity if entry.direction == 'debit' else 0.0
                quantitycr = entry.quantity if entry.direction == 'credit' else 0.0
                
                # 外币处理
                is_foreign = entry.currency_id is not None and entry.currency_id != 4
                currency_id = entry.currency_id if is_foreign else 4
                exchange_rate = entry.exchange_rate if is_foreign and entry.exchange_rate else 1.0
                
                if is_foreign and entry.orig_amount is not None:
                    orig_dr = entry.orig_amount if entry.direction == 'debit' else 0.0
                    orig_cr = entry.orig_amount if entry.direction == 'credit' else 0.0
                else:
                    orig_dr = entry.debit
                    orig_cr = entry.credit
                
                db.execute(insert_entry_query, {
                    "id": current_entry_id,
                    "doc_id": new_doc_id,
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
                
                # 往来单位处理
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
                        "doc_id": new_doc_id,
                        "entry_id": current_entry_id,
                        "partner_id": entry.partner_id,
                        "exchange_rate": exchange_rate,
                    })
            
            db.commit()
            
            logger.info(f"[外部API] 凭证创建成功: ID={new_doc_id}, Code={new_code}, API Key={api_key[:8]}...")
            
            return ExternalVoucherResponse(
                success=True,
                message="凭证创建成功",
                data={
                    "id": new_doc_id,
                    "code": new_code,
                    "voucher_date": voucher.voucher_date,
                    "entry_count": len(voucher.entry_rows),
                    "total_amount": total_debit
                }
            )
        
        except Exception as db_error:
            db.rollback()
            logger.error(f"[外部API] 数据库操作失败: {db_error}", exc_info=True)
            return ExternalVoucherResponse(
                success=False,
                message="创建失败",
                error_details={
                    "code": "DATABASE_ERROR",
                    "message": str(db_error)
                }
            )
    
    except Exception as e:
        logger.error(f"[外部API] 未预期的错误: {e}", exc_info=True)
        return ExternalVoucherResponse(
            success=False,
            message="服务器内部错误",
            error_details={
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        )


@router.get("/vouchers/{voucher_id}")
async def get_voucher_external(
    voucher_id: int,
    api_key: str = Depends(verify_api_key),
    db: Session = Depends(get_fbl_db)
):
    """
    查询凭证详情 (外部API)
    
    通过凭证ID查询已创建的凭证信息。
    """
    try:
        logger.info(f"[外部API] 查询凭证: ID={voucher_id}, API Key={api_key[:8]}...")
        
        # 查询凭证头
        doc_query = text("""
            SELECT 
                d.id, d.code, d.voucherdate, d.maker,
                dt.name as voucher_type_name
            FROM gl_doc d
            LEFT JOIN aa_doctype dt ON d.iddoctype = dt.id
            WHERE d.id = :id
        """)
        doc_result = db.execute(doc_query, {"id": voucher_id}).fetchone()
        
        if not doc_result:
            logger.warning(f"[外部API] 凭证不存在: ID={voucher_id}")
            return {
                "success": False,
                "message": "凭证不存在",
                "data": None
            }
        
        # 查询分录
        entries_query = text("""
            SELECT 
                e.summary, a.code as account_code, a.name as account_name,
                e.amountdr as debit, e.amountcr as credit
            FROM gl_entry e
            LEFT JOIN aa_account a ON e.idaccount = a.id
            WHERE e."idDocDTO" = :doc_id
            ORDER BY e.sequencenumber ASC NULLS LAST, e.id ASC
        """)
        entries_result = db.execute(entries_query, {"doc_id": voucher_id}).fetchall()
        entries = [dict(e._mapping) for e in entries_result]
        
        logger.info(f"[外部API] 凭证查询成功: ID={voucher_id}")
        
        return {
            "success": True,
            "message": "查询成功",
            "data": {
                "id": doc_result.id,
                "code": doc_result.code,
                "voucher_date": doc_result.voucherdate.strftime("%Y-%m-%d") if doc_result.voucherdate else None,
                "voucher_type": doc_result.voucher_type_name,
                "maker": doc_result.maker,
                "entries": entries
            }
        }
    
    except Exception as e:
        logger.error(f"[外部API] 查询凭证失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": "查询失败",
            "error_details": {
                "code": "QUERY_ERROR",
                "message": str(e)
            }
        }


@router.get("/health")
async def health_check(api_key: str = Depends(verify_api_key)):
    """
    健康检查 (外部API)
    
    验证API连接和认证状态。
    """
    return {
        "success": True,
        "message": "API 服务正常",
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }
