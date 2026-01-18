"""
供应商管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from ..timezone_utils import china_now
import logging

from ..database import get_db
from ..models import Supplier, InboundDetail, GoldMaterialTransaction
from ..schemas import SupplierCreate, SupplierResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suppliers", tags=["供应商管理"])


@router.get("")
async def get_suppliers(
    keyword: str = None,
    status: str = "active",
    db: Session = Depends(get_db)
):
    """获取供应商列表"""
    try:
        query = db.query(Supplier)
        
        if status:
            query = query.filter(Supplier.status == status)
        if keyword:
            query = query.filter(
                (Supplier.name.contains(keyword)) |
                (Supplier.contact_person.contains(keyword)) |
                (Supplier.phone.contains(keyword))
            )
        
        suppliers = query.order_by(desc(Supplier.create_time)).all()
        
        return {
            "success": True,
            "suppliers": [
                {
                    "id": s.id,
                    "supplier_no": s.supplier_no,
                    "name": s.name,
                    "phone": s.phone,
                    "address": s.address,
                    "contact_person": s.contact_person,
                    "supplier_type": s.supplier_type,
                    "total_supply_amount": s.total_supply_amount,
                    "total_supply_weight": s.total_supply_weight,
                    "total_supply_count": s.total_supply_count,
                    "last_supply_time": s.last_supply_time.isoformat() if s.last_supply_time else None,
                    "status": s.status,
                    "create_time": s.create_time.isoformat() if s.create_time else None,
                    "remark": s.remark
                }
                for s in suppliers
            ],
            "total": len(suppliers)
        }
    except Exception as e:
        logger.error(f"获取供应商列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "suppliers": []}


@router.post("")
async def create_supplier(
    supplier_data: SupplierCreate,
    db: Session = Depends(get_db)
):
    """创建供应商"""
    try:
        # 检查是否已存在同名供应商
        existing = db.query(Supplier).filter(
            Supplier.name == supplier_data.name,
            Supplier.status == "active"
        ).first()
        if existing:
            return {"success": False, "message": f"供应商【{supplier_data.name}】已存在"}
        
        # 生成供应商编号
        now = china_now()
        count = db.query(Supplier).filter(
            Supplier.supplier_no.like(f"SUP{now.strftime('%Y%m%d')}%")
        ).count()
        supplier_no = f"SUP{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 创建供应商
        supplier = Supplier(
            supplier_no=supplier_no,
            name=supplier_data.name,
            phone=supplier_data.phone,
            address=supplier_data.address,
            contact_person=supplier_data.contact_person,
            supplier_type=supplier_data.supplier_type or "个人",
            remark=supplier_data.remark,
            status="active"
        )
        db.add(supplier)
        db.commit()
        db.refresh(supplier)
        
        logger.info(f"创建供应商成功: {supplier.name} ({supplier.supplier_no})")
        
        return {
            "success": True,
            "message": f"供应商【{supplier.name}】创建成功",
            "supplier": {
                "id": supplier.id,
                "supplier_no": supplier.supplier_no,
                "name": supplier.name,
                "phone": supplier.phone,
                "address": supplier.address,
                "contact_person": supplier.contact_person
            }
        }
    except Exception as e:
        logger.error(f"创建供应商失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": f"创建供应商失败: {str(e)}"}


@router.put("/{supplier_id}")
async def update_supplier(
    supplier_id: int,
    supplier_data: SupplierCreate,
    db: Session = Depends(get_db)
):
    """更新供应商信息"""
    try:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            return {"success": False, "message": "供应商不存在"}
        
        # 检查是否有同名供应商
        existing = db.query(Supplier).filter(
            Supplier.name == supplier_data.name,
            Supplier.id != supplier_id,
            Supplier.status == "active"
        ).first()
        if existing:
            return {"success": False, "message": f"供应商【{supplier_data.name}】已存在"}
        
        # 更新字段
        supplier.name = supplier_data.name
        supplier.phone = supplier_data.phone
        supplier.address = supplier_data.address
        supplier.contact_person = supplier_data.contact_person
        supplier.supplier_type = supplier_data.supplier_type or supplier.supplier_type
        supplier.remark = supplier_data.remark
        
        db.commit()
        
        logger.info(f"更新供应商成功: {supplier.name} ({supplier.supplier_no})")
        
        return {
            "success": True,
            "message": f"供应商【{supplier.name}】更新成功",
            "supplier": {
                "id": supplier.id,
                "supplier_no": supplier.supplier_no,
                "name": supplier.name,
                "phone": supplier.phone,
                "address": supplier.address,
                "contact_person": supplier.contact_person
            }
        }
    except Exception as e:
        logger.error(f"更新供应商失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": f"更新供应商失败: {str(e)}"}


@router.delete("/{supplier_id}")
async def delete_supplier(
    supplier_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """删除供应商（软删除）"""
    # 权限检查 - 只有管理层可以删除
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_delete'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【删除数据】的权限")
    
    try:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            return {"success": False, "message": "供应商不存在"}
        
        # 软删除
        supplier.status = "deleted"
        db.commit()
        
        logger.info(f"删除供应商成功: {supplier.name} ({supplier.supplier_no})")
        
        return {
            "success": True,
            "message": f"供应商【{supplier.name}】已删除"
        }
    except Exception as e:
        logger.error(f"删除供应商失败: {e}", exc_info=True)
        db.rollback()
        return {"success": False, "message": f"删除供应商失败: {str(e)}"}


@router.get("/debt-summary")
async def get_supplier_debt_summary(
    user_role: str = Query(default="material", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取供应商欠料统计
    
    计算逻辑：
    - 入库重量：从 InboundDetail 按 supplier_id 汇总
    - 已付料重量：从 GoldMaterialTransaction (expense 类型，已确认) 按 supplier_id 汇总
    - 欠料 = 入库重量 - 已付料重量
    """
    try:
        # 获取所有活跃供应商
        suppliers = db.query(Supplier).filter(Supplier.status == "active").all()
        
        result = []
        total_inbound = 0.0
        total_paid = 0.0
        total_debt = 0.0
        
        for supplier in suppliers:
            # 入库重量（按供应商汇总）
            inbound_weight = db.query(func.sum(InboundDetail.weight)).filter(
                InboundDetail.supplier_id == supplier.id
            ).scalar() or 0.0
            
            # 已付料重量（expense 类型，已确认状态）
            paid_weight = db.query(func.sum(GoldMaterialTransaction.gold_weight)).filter(
                GoldMaterialTransaction.supplier_id == supplier.id,
                GoldMaterialTransaction.transaction_type == 'expense',
                GoldMaterialTransaction.status == 'confirmed'
            ).scalar() or 0.0
            
            # 欠料 = 入库 - 已付
            debt_weight = inbound_weight - paid_weight
            
            # 只显示有入库记录的供应商
            if inbound_weight > 0 or paid_weight > 0:
                result.append({
                    "supplier_id": supplier.id,
                    "supplier_name": supplier.name,
                    "supplier_no": supplier.supplier_no,
                    "inbound_weight": round(inbound_weight, 2),
                    "paid_weight": round(paid_weight, 2),
                    "debt_weight": round(debt_weight, 2)
                })
                
                total_inbound += inbound_weight
                total_paid += paid_weight
                total_debt += debt_weight
        
        # 按欠料重量降序排列
        result.sort(key=lambda x: x["debt_weight"], reverse=True)
        
        return {
            "success": True,
            "summary": {
                "total_inbound_weight": round(total_inbound, 2),
                "total_paid_weight": round(total_paid, 2),
                "total_debt_weight": round(total_debt, 2),
                "supplier_count": len(result)
            },
            "suppliers": result
        }
    except Exception as e:
        logger.error(f"获取供应商欠料统计失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "suppliers": []}

