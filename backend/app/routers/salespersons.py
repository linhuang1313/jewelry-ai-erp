"""
销售员/业务员管理路由
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import logging

from ..database import get_db
from ..models import Salesperson
from ..schemas import SalespersonCreate, SalespersonResponse
from ..dependencies.auth import get_current_role, require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/salespersons", tags=["业务员管理"])


@router.get("")
async def get_salespersons(db: Session = Depends(get_db)):
    """获取所有业务员列表"""
    try:
        salespersons = db.query(Salesperson).filter(
            Salesperson.status == "active"
        ).order_by(Salesperson.id).all()
        
        return {
            "success": True,
            "salespersons": [SalespersonResponse.model_validate(s).model_dump(mode='json') for s in salespersons],
            "total": len(salespersons)
        }
    except Exception as e:
        logger.error(f"获取业务员列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("")
async def create_salesperson(data: SalespersonCreate, db: Session = Depends(get_db)):
    """创建业务员"""
    try:
        # 检查是否已存在
        existing = db.query(Salesperson).filter(Salesperson.name == data.name).first()
        if existing:
            if existing.status == "inactive":
                # 重新激活
                existing.status = "active"
                db.commit()
                return {
                    "success": True,
                    "message": f"业务员【{data.name}】已重新激活",
                    "salesperson": SalespersonResponse.model_validate(existing).model_dump(mode='json')
                }
            return {
                "success": False,
                "message": f"业务员【{data.name}】已存在"
            }
        
        salesperson = Salesperson(
            name=data.name,
            phone=data.phone,
            remark=data.remark
        )
        db.add(salesperson)
        db.commit()
        db.refresh(salesperson)
        
        return {
            "success": True,
            "message": f"业务员【{data.name}】创建成功",
            "salesperson": SalespersonResponse.model_validate(salesperson).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.put("/{salesperson_id}")
async def update_salesperson(salesperson_id: int, data: SalespersonCreate, db: Session = Depends(get_db)):
    """更新业务员信息"""
    try:
        salesperson = db.query(Salesperson).filter(Salesperson.id == salesperson_id).first()
        if not salesperson:
            return {"success": False, "message": "业务员不存在"}
        
        # 检查新名字是否与其他业务员重复
        if data.name != salesperson.name:
            existing = db.query(Salesperson).filter(
                Salesperson.name == data.name,
                Salesperson.id != salesperson_id
            ).first()
            if existing:
                return {"success": False, "message": f"业务员【{data.name}】已存在"}
        
        salesperson.name = data.name
        if data.phone is not None:
            salesperson.phone = data.phone
        if data.remark is not None:
            salesperson.remark = data.remark
        
        db.commit()
        db.refresh(salesperson)
        
        return {
            "success": True,
            "message": f"业务员信息已更新",
            "salesperson": SalespersonResponse.model_validate(salesperson).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.delete("/{salesperson_id}")
async def delete_salesperson(salesperson_id: int, db: Session = Depends(get_db)):
    """删除业务员（软删除）"""
    try:
        salesperson = db.query(Salesperson).filter(Salesperson.id == salesperson_id).first()
        if not salesperson:
            return {"success": False, "message": "业务员不存在"}
        
        salesperson.status = "inactive"
        db.commit()
        
        return {
            "success": True,
            "message": f"业务员【{salesperson.name}】已删除"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.post("/init")
async def init_salespersons(db: Session = Depends(get_db)):
    """初始化业务员数据（清除现有数据并添加新数据）"""
    try:
        # 预定义的业务员列表
        salesperson_names = [
            "郑梅", "何云波", "姚财寿", "纪鸿杰", "郑光辉",
            "魏荔岚", "林纯洁", "赵燕珠", "步昭芬", "魏瑶峰"
        ]
        
        # 将所有现有业务员设为inactive
        db.query(Salesperson).update({"status": "inactive"})
        
        # 添加或激活新的业务员
        added = []
        for name in salesperson_names:
            existing = db.query(Salesperson).filter(Salesperson.name == name).first()
            if existing:
                existing.status = "active"
                added.append(name)
            else:
                salesperson = Salesperson(name=name, status="active")
                db.add(salesperson)
                added.append(name)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"业务员数据已初始化，共{len(added)}人",
            "salespersons": added
        }
    except Exception as e:
        db.rollback()
        logger.error(f"初始化业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}

