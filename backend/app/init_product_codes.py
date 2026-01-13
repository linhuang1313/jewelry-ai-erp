"""
初始化商品编码数据
包含35个预定义编码
"""

from sqlalchemy.orm import Session
from .models import ProductCode

# 预定义编码数据
PREDEFINED_CODES = [
    # 足金999精品（9个）
    {"code": "JPJZ", "name": "足金999精品戒指", "code_type": "predefined"},
    {"code": "JPSZ", "name": "足金999精品手镯", "code_type": "predefined"},
    {"code": "JPDZ", "name": "足金999精品吊坠", "code_type": "predefined"},
    {"code": "JPES", "name": "足金999精品耳饰", "code_type": "predefined"},
    {"code": "JPXL", "name": "足金999精品项链", "code_type": "predefined"},
    {"code": "JPSP", "name": "足金999精品饰品", "code_type": "predefined"},
    {"code": "JPJT", "name": "足金999精品金条", "code_type": "predefined"},
    {"code": "JPSL", "name": "足金999精品手链", "code_type": "predefined"},
    {"code": "JPJC", "name": "足金999精品金钞", "code_type": "predefined"},
    
    # 足金古法999（8个）
    {"code": "GFJZ", "name": "足金古法999戒指", "code_type": "predefined"},
    {"code": "GFSZ", "name": "足金古法999手镯", "code_type": "predefined"},
    {"code": "GFDZ", "name": "足金古法999吊坠", "code_type": "predefined"},
    {"code": "GFES", "name": "足金古法999耳饰", "code_type": "predefined"},
    {"code": "GFXL", "name": "足金古法999项链", "code_type": "predefined"},
    {"code": "GFSP", "name": "足金古法999饰品", "code_type": "predefined"},
    {"code": "GFJT", "name": "足金古法999金条", "code_type": "predefined"},
    {"code": "GFSL", "name": "足金古法999手链", "code_type": "predefined"},
    
    # 足金3D硬金（7个）
    {"code": "3DJZ", "name": "足金3D硬金戒指", "code_type": "predefined"},
    {"code": "3DSZ", "name": "足金3D硬金手镯", "code_type": "predefined"},
    {"code": "3DDZ", "name": "足金3D硬金吊坠", "code_type": "predefined"},
    {"code": "3DES", "name": "足金3D硬金耳饰", "code_type": "predefined"},
    {"code": "3DXL", "name": "足金3D硬金项链", "code_type": "predefined"},
    {"code": "3DSP", "name": "足金3D硬金饰品", "code_type": "predefined"},
    {"code": "3DSL", "name": "足金3D硬金手链", "code_type": "predefined"},
    
    # 足金5D硬金（7个）
    {"code": "5DJZ", "name": "足金5D硬金戒指", "code_type": "predefined"},
    {"code": "5DSZ", "name": "足金5D硬金手镯", "code_type": "predefined"},
    {"code": "5DDZ", "name": "足金5D硬金吊坠", "code_type": "predefined"},
    {"code": "5DES", "name": "足金5D硬金耳饰", "code_type": "predefined"},
    {"code": "5DXL", "name": "足金5D硬金项链", "code_type": "predefined"},
    {"code": "5DSP", "name": "足金5D硬金饰品", "code_type": "predefined"},
    {"code": "5DSL", "name": "足金5D硬金手链", "code_type": "predefined"},
    
    # 足金999精品项目补充（4个，凑足35个）
    {"code": "JPJB", "name": "足金999精品金币", "code_type": "predefined"},
    {"code": "JPJS", "name": "足金999精品金锁", "code_type": "predefined"},
    {"code": "JPJP", "name": "足金999精品金牌", "code_type": "predefined"},
    {"code": "JPJZ2", "name": "足金999精品金珠", "code_type": "predefined"},
]


def init_product_codes(db: Session):
    """初始化预定义商品编码"""
    count = 0
    for code_data in PREDEFINED_CODES:
        # 检查是否已存在
        existing = db.query(ProductCode).filter(ProductCode.code == code_data["code"]).first()
        if not existing:
            product_code = ProductCode(
                code=code_data["code"],
                name=code_data["name"],
                code_type=code_data["code_type"],
                is_unique=0,
                is_used=0,
                created_by="系统初始化"
            )
            db.add(product_code)
            count += 1
    
    if count > 0:
        db.commit()
        print(f"已初始化 {count} 个预定义商品编码")
    
    return count


def get_next_f_code(db: Session) -> str:
    """获取下一个可用的F编码（自动生成）"""
    # 查找当前最大的F编码
    last_f_code = db.query(ProductCode).filter(
        ProductCode.code_type == "f_single",
        ProductCode.code.like("F%")
    ).order_by(ProductCode.code.desc()).first()
    
    if last_f_code:
        # 提取数字部分并加1
        try:
            current_num = int(last_f_code.code[1:])  # 去掉F前缀
            next_num = current_num + 1
        except ValueError:
            next_num = 1
    else:
        # 从1开始
        next_num = 1
    
    # 格式化为8位数字
    return f"F{next_num:08d}"


def get_next_fl_code(db: Session) -> str:
    """获取建议的下一个FL编码"""
    # 查找当前最大的FL编码
    last_fl_code = db.query(ProductCode).filter(
        ProductCode.code_type == "fl_batch",
        ProductCode.code.like("FL%")
    ).order_by(ProductCode.code.desc()).first()
    
    if last_fl_code:
        # 提取数字部分并加1
        try:
            current_num = int(last_fl_code.code[2:])  # 去掉FL前缀
            next_num = current_num + 1
        except ValueError:
            next_num = 1
    else:
        # 从1开始
        next_num = 1
    
    # 格式化为4位数字
    return f"FL{next_num:04d}"

