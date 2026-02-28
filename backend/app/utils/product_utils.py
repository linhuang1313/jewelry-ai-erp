"""
商品编码解析工具 - 将商品编码自动转换为商品名称
"""
import logging
from sqlalchemy.orm import Session
from ..models import ProductCode

logger = logging.getLogger(__name__)


def resolve_product_code(product_name: str, db: Session) -> tuple:
    """解析商品名称：如果输入的是商品编码，返回 (真实商品名称, 商品编码)；否则原样返回。

    用于在所有业务入口统一处理用户输入的商品编码（如 3DDZ）到真实商品名称（如 足金3D硬金吊坠）的转换，
    确保下游库存匹配逻辑能正确工作。

    Args:
        product_name: 用户输入的商品名称或商品编码
        db: 数据库会话

    Returns:
        (resolved_name, product_code):
            - resolved_name: 库存中使用的真实商品名称
            - product_code: 如果输入的是编码则返回编码字符串，否则为 None
    """
    if not product_name:
        return product_name, None

    pc = db.query(ProductCode).filter(ProductCode.code == product_name.strip()).first()
    if pc:
        logger.info(f"商品编码解析: {product_name} -> {pc.name} (编码: {pc.code})")
        return pc.name, pc.code

    return product_name, None
