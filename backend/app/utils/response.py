"""
统一API响应格式工具

使用示例:
    from ..utils.response import success_response, error_response, paginated_response
    
    # 成功响应
    return success_response(data={"id": 1}, message="创建成功")
    
    # 错误响应
    return error_response(message="参数错误", code=ErrorCode.BAD_REQUEST)
    
    # 分页响应
    return paginated_response(items=customers, total=100, page=1, page_size=20)
"""
import math
from decimal import Decimal
from typing import Any, Optional, Dict, List, TypeVar, Generic
from pydantic import BaseModel


# ============ 浮点数安全工具 ============

def safe_float(value, default=0.0):
    """Convert value to float safely, returning default for None/NaN/Infinity."""
    if value is None:
        return default
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def sanitize_floats(obj):
    """Recursively replace NaN/Infinity with None and Decimal with float."""
    if isinstance(obj, Decimal):
        f = float(obj)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: sanitize_floats(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_floats(i) for i in obj]
    return obj


# ============ 错误码定义 ============

class ErrorCode:
    """标准错误码"""
    SUCCESS = 200
    CREATED = 201
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    CONFLICT = 409
    VALIDATION_ERROR = 422
    INTERNAL_ERROR = 500
    SERVICE_UNAVAILABLE = 503


# ============ 响应模型 ============

class ApiResponse(BaseModel):
    """统一API响应模型"""
    success: bool
    code: int
    message: str
    data: Optional[Any] = None


class PaginatedData(BaseModel):
    """分页数据模型"""
    items: List[Any]
    total: int
    page: int
    page_size: int
    total_pages: int


# ============ 响应工具函数 ============

def success_response(
    data: Any = None,
    message: str = "操作成功",
    code: int = ErrorCode.SUCCESS
) -> Dict:
    """
    成功响应
    
    Args:
        data: 返回的业务数据
        message: 提示信息
        code: 状态码，默认200
        
    Returns:
        统一格式的响应字典
    """
    return {
        "success": True,
        "code": code,
        "message": message,
        "data": data
    }


def error_response(
    message: str = "操作失败",
    code: int = ErrorCode.BAD_REQUEST,
    data: Any = None
) -> Dict:
    """
    错误响应
    
    Args:
        message: 错误信息
        code: 错误码，默认400
        data: 附加数据（可选，如验证错误详情）
        
    Returns:
        统一格式的响应字典
    """
    return {
        "success": False,
        "code": code,
        "message": message,
        "data": data
    }


def paginated_response(
    items: List,
    total: int,
    page: int = 1,
    page_size: int = 20,
    message: str = "查询成功"
) -> Dict:
    """
    分页响应
    
    Args:
        items: 数据列表
        total: 总记录数
        page: 当前页码
        page_size: 每页大小
        message: 提示信息
        
    Returns:
        统一格式的分页响应字典
    """
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    
    return {
        "success": True,
        "code": ErrorCode.SUCCESS,
        "message": message,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages
        }
    }


def created_response(
    data: Any = None,
    message: str = "创建成功"
) -> Dict:
    """创建成功响应"""
    return success_response(data=data, message=message, code=ErrorCode.CREATED)


def not_found_response(
    message: str = "资源不存在"
) -> Dict:
    """资源不存在响应"""
    return error_response(message=message, code=ErrorCode.NOT_FOUND)


def validation_error_response(
    message: str = "参数验证失败",
    errors: List = None
) -> Dict:
    """参数验证错误响应"""
    return error_response(
        message=message,
        code=ErrorCode.VALIDATION_ERROR,
        data={"errors": errors} if errors else None
    )


def unauthorized_response(
    message: str = "未授权访问"
) -> Dict:
    """未授权响应"""
    return error_response(message=message, code=ErrorCode.UNAUTHORIZED)


def forbidden_response(
    message: str = "无权限访问"
) -> Dict:
    """禁止访问响应"""
    return error_response(message=message, code=ErrorCode.FORBIDDEN)


def conflict_response(
    message: str = "资源冲突"
) -> Dict:
    """资源冲突响应"""
    return error_response(message=message, code=ErrorCode.CONFLICT)


def server_error_response(
    message: str = "服务器内部错误"
) -> Dict:
    """服务器错误响应"""
    return error_response(message=message, code=ErrorCode.INTERNAL_ERROR)

