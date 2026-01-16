"""
商品编码管理路由
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from ..database import get_db
from ..models import ProductCode, ProductAttribute, InboundDetail
from ..schemas import (
    ProductCodeCreate, ProductCodeUpdate, 
    ProductCodeResponse, ProductCodeSearchResponse
)
from ..init_product_codes import get_next_f_code, get_next_fl_code, init_product_codes

router = APIRouter(prefix="/api/product-codes", tags=["商品编码"])


@router.get("/init", response_model=dict)
def initialize_product_codes(db: Session = Depends(get_db)):
    """初始化预定义商品编码"""
    count = init_product_codes(db)
    return {"message": f"已初始化 {count} 个预定义商品编码", "count": count}


@router.get("/next-f-code", response_model=dict)
def get_next_f_code_api(db: Session = Depends(get_db)):
    """获取下一个可用的F编码"""
    code = get_next_f_code(db)
    return {"code": code}


@router.get("/next-fl-code", response_model=dict)
def get_next_fl_code_api(db: Session = Depends(get_db)):
    """获取建议的下一个FL编码"""
    code = get_next_fl_code(db)
    return {"code": code}


@router.get("/batch-f-codes", response_model=dict)
def get_batch_f_codes(
    count: int = 1, 
    save: bool = Query(False, description="是否保存到数据库（确保全局唯一）"),
    product_name: Optional[str] = Query(None, description="商品名称（save=true时必填）"),
    db: Session = Depends(get_db)
):
    """批量获取多个F编码
    
    - save=false（默认）：仅预览，不保存
    - save=true：保存到数据库，确保全局唯一递增
    """
    if count <= 0:
        return {"codes": [], "count": 0}
    if count > 500:
        count = 500  # 限制最多500个
    
    # 查找当前最大的F编码
    last_f_code = db.query(ProductCode).filter(
        ProductCode.code_type == "f_single",
        ProductCode.code.like("F%")
    ).order_by(ProductCode.code.desc()).first()
    
    if last_f_code:
        try:
            start_num = int(last_f_code.code[1:]) + 1
        except ValueError:
            start_num = 1
    else:
        start_num = 1
    
    # 生成编码列表
    codes = [f"F{start_num + i:08d}" for i in range(count)]
    
    # 如果需要保存到数据库
    if save:
        if not product_name:
            product_name = "珐琅产品"  # 默认名称
        
        for code in codes:
            new_code = ProductCode(
                code=code,
                name=product_name,
                code_type="f_single",
                is_unique=1,
                is_used=0,
                created_by="系统"
            )
            db.add(new_code)
        
        db.commit()
    
    return {
        "codes": codes,
        "count": len(codes),
        "start": codes[0] if codes else None,
        "end": codes[-1] if codes else None,
        "saved": save
    }


@router.get("/search", response_model=ProductCodeSearchResponse)
def search_product_codes(
    keyword: Optional[str] = None,
    code_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """搜索商品编码（支持编码和名称模糊搜索）"""
    query = db.query(ProductCode)
    
    if code_type:
        query = query.filter(ProductCode.code_type == code_type)
    
    if keyword:
        query = query.filter(
            or_(
                ProductCode.code.ilike(f"%{keyword}%"),
                ProductCode.name.ilike(f"%{keyword}%")
            )
        )
    
    codes = query.order_by(ProductCode.code).all()
    return ProductCodeSearchResponse(
        codes=[ProductCodeResponse.model_validate(c) for c in codes],
        total=len(codes)
    )


@router.get("", response_model=List[ProductCodeResponse])
def get_product_codes(
    code_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """获取所有商品编码（支持按类型筛选）"""
    query = db.query(ProductCode)
    
    if code_type:
        query = query.filter(ProductCode.code_type == code_type)
    
    codes = query.order_by(ProductCode.code).offset(skip).limit(limit).all()
    
    # 对于 F 编码，关联查询供应商信息
    result = []
    for code in codes:
        code_dict = {
            "id": code.id,
            "code": code.code,
            "name": code.name,
            "code_type": code.code_type,
            "is_unique": code.is_unique,
            "is_used": code.is_used,
            "created_by": code.created_by,
            "created_at": code.created_at,
            "updated_at": code.updated_at,
            "remark": code.remark,
            "supplier_name": None
        }
        
        # 查询入库记录中的供应商信息
        if code.code_type == "f_single":
            inbound_detail = db.query(InboundDetail).filter(
                InboundDetail.product_code == code.code
            ).first()
            if inbound_detail and inbound_detail.supplier:
                code_dict["supplier_name"] = inbound_detail.supplier
        
        result.append(ProductCodeResponse(**code_dict))
    
    return result


# ========== 商品属性配置 API（必须在 /{code} 之前定义）==========

# 初始数据
DEFAULT_ATTRIBUTES = {
    "fineness": ['足金', '板料', 'S925银', '足银', '18K金', '足铂', '18K金珐琅', '旧料'],
    "craft": [
        '5D镶嵌', '5D硬金珍珠珐琅', '5D钻石', '5G珍珠珐琅', '古法镶嵌', '古法镶钻',
        '999.9精品', '5G珐琅', '古法镶钻珐琅', '古法珐琅999', '古珍珠', '5D硬金珐琅',
        '古法珐琅珍珠', '钻石', '3D硬金', '3D硬金珐琅', '5G', '999.99精品',
        '999精品', '古法999', '古法999.9', '古法999.99', '硬古法'
    ],
    "style": ['配件', '饰品', '戒指', '项链', '手链', '手镯', '耳饰', '挂坠', '金条', '金币', '金钞', '金豆']
}


@router.get("/attributes/init")
def init_product_attributes(db: Session = Depends(get_db)):
    """初始化商品属性配置（首次部署时调用）"""
    count = 0
    for category, values in DEFAULT_ATTRIBUTES.items():
        for idx, value in enumerate(values):
            # 检查是否已存在
            existing = db.query(ProductAttribute).filter(
                ProductAttribute.category == category,
                ProductAttribute.value == value
            ).first()
            if not existing:
                attr = ProductAttribute(
                    category=category,
                    value=value,
                    sort_order=idx,
                    is_active=True
                )
                db.add(attr)
                count += 1
    db.commit()
    return {"message": f"已初始化 {count} 个商品属性", "count": count}


@router.get("/attributes", response_model=dict)
def get_product_attributes(
    category: Optional[str] = Query(None, description="属性类别: fineness/craft/style"),
    db: Session = Depends(get_db)
):
    """获取商品属性列表"""
    query = db.query(ProductAttribute).filter(ProductAttribute.is_active == True)
    
    if category:
        query = query.filter(ProductAttribute.category == category)
    
    attributes = query.order_by(ProductAttribute.category, ProductAttribute.sort_order).all()
    
    # 按类别分组返回
    result = {"fineness": [], "craft": [], "style": []}
    for attr in attributes:
        if attr.category in result:
            result[attr.category].append({
                "id": attr.id,
                "value": attr.value,
                "sort_order": attr.sort_order
            })
    
    return result


@router.post("/attributes", response_model=dict)
def create_product_attribute(
    category: str = Query(..., description="属性类别: fineness/craft/style"),
    value: str = Query(..., description="属性值"),
    db: Session = Depends(get_db)
):
    """新增商品属性"""
    if category not in ["fineness", "craft", "style"]:
        raise HTTPException(status_code=400, detail="无效的属性类别")
    
    # 检查是否已存在
    existing = db.query(ProductAttribute).filter(
        ProductAttribute.category == category,
        ProductAttribute.value == value
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"属性 '{value}' 已存在")
    
    # 获取当前最大排序
    max_order = db.query(ProductAttribute).filter(
        ProductAttribute.category == category
    ).count()
    
    attr = ProductAttribute(
        category=category,
        value=value,
        sort_order=max_order,
        is_active=True
    )
    db.add(attr)
    db.commit()
    db.refresh(attr)
    
    return {
        "id": attr.id,
        "category": attr.category,
        "value": attr.value,
        "sort_order": attr.sort_order
    }


@router.put("/attributes/{id}", response_model=dict)
def update_product_attribute(
    id: int,
    value: Optional[str] = Query(None, description="新的属性值"),
    sort_order: Optional[int] = Query(None, description="排序顺序"),
    is_active: Optional[bool] = Query(None, description="是否启用"),
    db: Session = Depends(get_db)
):
    """更新商品属性"""
    attr = db.query(ProductAttribute).filter(ProductAttribute.id == id).first()
    if not attr:
        raise HTTPException(status_code=404, detail="属性不存在")
    
    if value is not None:
        # 检查是否与其他属性冲突
        existing = db.query(ProductAttribute).filter(
            ProductAttribute.category == attr.category,
            ProductAttribute.value == value,
            ProductAttribute.id != id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"属性 '{value}' 已存在")
        attr.value = value
    
    if sort_order is not None:
        attr.sort_order = sort_order
    
    if is_active is not None:
        attr.is_active = is_active
    
    db.commit()
    db.refresh(attr)
    
    return {
        "id": attr.id,
        "category": attr.category,
        "value": attr.value,
        "sort_order": attr.sort_order,
        "is_active": attr.is_active
    }


@router.delete("/attributes/{id}")
def delete_product_attribute(id: int, db: Session = Depends(get_db)):
    """删除商品属性"""
    attr = db.query(ProductAttribute).filter(ProductAttribute.id == id).first()
    if not attr:
        raise HTTPException(status_code=404, detail="属性不存在")
    
    db.delete(attr)
    db.commit()
    
    return {"message": f"属性 '{attr.value}' 已删除"}


# ========== 动态路由（必须放在最后）==========

@router.get("/{code}", response_model=ProductCodeResponse)
def get_product_code(code: str, db: Session = Depends(get_db)):
    """根据编码查询商品"""
    product_code = db.query(ProductCode).filter(ProductCode.code == code).first()
    if not product_code:
        raise HTTPException(status_code=404, detail=f"商品编码 {code} 不存在")
    return ProductCodeResponse.model_validate(product_code)


@router.post("", response_model=ProductCodeResponse)
def create_product_code(
    data: ProductCodeCreate,
    created_by: str = "系统",
    db: Session = Depends(get_db)
):
    """创建新商品编码（仅F/FL编码）"""
    # 验证编码类型
    if data.code_type not in ["f_single", "fl_batch"]:
        raise HTTPException(
            status_code=400, 
            detail="只能创建 f_single（F编码）或 fl_batch（FL编码）类型的编码"
        )
    
    # 验证编码格式
    if data.code_type == "f_single":
        if not data.code.startswith("F") or len(data.code) != 9:
            raise HTTPException(
                status_code=400, 
                detail="F编码格式必须为 F + 8位数字（如 F00000001）"
            )
        try:
            int(data.code[1:])
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail="F编码格式必须为 F + 8位数字"
            )
    elif data.code_type == "fl_batch":
        if not data.code.startswith("FL") or len(data.code) != 6:
            raise HTTPException(
                status_code=400, 
                detail="FL编码格式必须为 FL + 4位数字（如 FL0001）"
            )
        try:
            int(data.code[2:])
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail="FL编码格式必须为 FL + 4位数字"
            )
    
    # 检查编码是否已存在
    existing = db.query(ProductCode).filter(ProductCode.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"商品编码 {data.code} 已存在")
    
    # 创建编码
    product_code = ProductCode(
        code=data.code,
        name=data.name,
        code_type=data.code_type,
        is_unique=1 if data.code_type == "f_single" else 0,
        is_used=0,
        created_by=created_by,
        remark=data.remark
    )
    db.add(product_code)
    db.commit()
    db.refresh(product_code)
    
    return ProductCodeResponse.model_validate(product_code)


@router.put("/{id}", response_model=ProductCodeResponse)
def update_product_code(
    id: int,
    data: ProductCodeUpdate,
    db: Session = Depends(get_db)
):
    """更新商品编码（仅F/FL编码）"""
    product_code = db.query(ProductCode).filter(ProductCode.id == id).first()
    if not product_code:
        raise HTTPException(status_code=404, detail="商品编码不存在")
    
    # 预定义编码不能修改
    if product_code.code_type == "predefined":
        raise HTTPException(status_code=400, detail="预定义编码不能修改")
    
    # 更新字段
    if data.name is not None:
        product_code.name = data.name
    if data.remark is not None:
        product_code.remark = data.remark
    
    db.commit()
    db.refresh(product_code)
    
    return ProductCodeResponse.model_validate(product_code)


@router.delete("/{id}")
def delete_product_code(id: int, db: Session = Depends(get_db)):
    """删除商品编码（仅F/FL编码）"""
    product_code = db.query(ProductCode).filter(ProductCode.id == id).first()
    if not product_code:
        raise HTTPException(status_code=404, detail="商品编码不存在")
    
    # 预定义编码不能删除
    if product_code.code_type == "predefined":
        raise HTTPException(status_code=400, detail="预定义编码不能删除")
    
    # 已使用的编码不建议删除（可选：根据业务需求决定是否允许）
    if product_code.is_used:
        raise HTTPException(
            status_code=400, 
            detail="该编码已被使用，不能删除"
        )
    
    db.delete(product_code)
    db.commit()
    
    return {"message": f"商品编码 {product_code.code} 已删除"}


@router.post("/{code}/mark-used")
def mark_code_as_used(code: str, db: Session = Depends(get_db)):
    """标记编码为已使用（入库时调用）"""
    product_code = db.query(ProductCode).filter(ProductCode.code == code).first()
    if not product_code:
        raise HTTPException(status_code=404, detail=f"商品编码 {code} 不存在")
    
    # 只有F编码需要标记为已使用
    if product_code.code_type == "f_single":
        product_code.is_used = 1
        db.commit()
    
    return {"message": f"商品编码 {code} 已标记为已使用"}

