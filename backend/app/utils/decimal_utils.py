"""精度安全的数值工具函数

珠宝ERP系统中所有金额、克重、工费的计算都必须使用这些函数，
绝对不要直接使用 float() 转换 Decimal 值。

用法：
    from app.utils.decimal_utils import to_decimal, round_weight, round_money, safe_float_for_json

    # 替代 float(product.weight)
    weight = to_decimal(product.weight)

    # 替代 round(float(x) * float(y), 3)
    result = round_weight(to_decimal(x) * to_decimal(y))

    # JSON 序列化时
    json_val = safe_float_for_json(some_decimal)
"""

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Union, Optional


def to_decimal(value, default: str = "0") -> Decimal:
    """安全地将任意值转为 Decimal

    替代所有 float(xxx) 调用。
    
    关键点：float 先转 str 再转 Decimal，避免二进制表示污染。
    例如：float(0.1) = 0.1000000000000000055511151231257827021181583404541015625
         to_decimal(0.1) = Decimal('0.1')  — 精确

    Args:
        value: 任意输入值（Decimal, float, int, str, None）
        default: 当 value 为 None 或转换失败时的默认值

    Returns:
        Decimal 值
    """
    if value is None:
        return Decimal(default)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int,)):
        return Decimal(value)
    if isinstance(value, float):
        # float → str → Decimal，避免 float 二进制表示污染
        return Decimal(str(value))
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def round_weight(value: Union[Decimal, float, str, None], precision: int = 3) -> Decimal:
    """克重四舍五入
    
    默认保留 3 位小数（0.001g），符合珠宝行业标准。
    使用 ROUND_HALF_UP（四舍五入），而非 Python 默认的银行家舍入。

    Args:
        value: 克重值
        precision: 小数位数，默认 3

    Returns:
        精确的 Decimal 克重值
    """
    d = to_decimal(value)
    quantize_str = "0." + "0" * precision
    return d.quantize(Decimal(quantize_str), rounding=ROUND_HALF_UP)


def round_money(value: Union[Decimal, float, str, None], precision: int = 2) -> Decimal:
    """金额四舍五入
    
    默认保留 2 位小数（分），使用 ROUND_HALF_UP。

    Args:
        value: 金额值
        precision: 小数位数，默认 2

    Returns:
        精确的 Decimal 金额值
    """
    d = to_decimal(value)
    quantize_str = "0." + "0" * precision
    return d.quantize(Decimal(quantize_str), rounding=ROUND_HALF_UP)


def round_rate(value: Union[Decimal, float, str, None], precision: int = 4) -> Decimal:
    """比率/折扣率四舍五入
    
    默认保留 4 位小数。

    Args:
        value: 比率值
        precision: 小数位数，默认 4

    Returns:
        精确的 Decimal 比率值
    """
    d = to_decimal(value)
    quantize_str = "0." + "0" * precision
    return d.quantize(Decimal(quantize_str), rounding=ROUND_HALF_UP)


def safe_float_for_json(value) -> Union[float, None]:
    """Decimal → float（仅用于 JSON 序列化 / API 响应）
    
    先转 str 再转 float，比直接 float(decimal) 更安全。
    仅在需要返回 JSON 且前端必须接收数字类型时使用。
    
    如果可以接受字符串，优先用 str(decimal_value)。

    Args:
        value: Decimal 或其他数值

    Returns:
        float 值，用于 JSON 序列化
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(str(value))
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (ValueError, TypeError):
        return None


def safe_json_value(value):
    """通用的 JSON 安全值转换
    
    替代 query_engine.py 中的 _safe_value 函数。
    Decimal → str（保留精度），datetime → 格式化字符串。
    """
    from datetime import datetime, date
    
    if value is None:
        return None
    if isinstance(value, Decimal):
        # 返回字符串保留完整精度
        return str(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return value
