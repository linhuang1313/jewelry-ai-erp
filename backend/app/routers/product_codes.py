"""
商品编码管理路由
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from ..database import get_db
from ..models import ProductCode
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
def get_batch_f_codes(count: int = 1, db: Session = Depends(get_db)):
    """批量获取多个F编码（不创建，仅预览）"""
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
    
    return {
        "codes": codes,
        "count": len(codes),
        "start": codes[0] if codes else None,
        "end": codes[-1] if codes else None
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
    return [ProductCodeResponse.model_validate(c) for c in codes]


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

