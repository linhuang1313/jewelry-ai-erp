"""
角色验证依赖注入模块
提供 FastAPI Depends() 用的角色提取和权限校验函数
"""
from fastapi import Depends, Header, HTTPException, Query
from ..middleware.permissions import (
    has_permission, check_permission, normalize_role, ROLE_PERMISSIONS
)


def get_current_role(
    user_role: str = Query(default="", description="用户角色"),
    x_user_role: str = Header(default="", alias="X-User-Role"),
) -> str:
    """
    从 Header 或 Query 参数中提取并校验用户角色。
    优先级：Header > Query > 默认 sales（最低权限）。
    """
    role = x_user_role or user_role or "sales"
    normalized = normalize_role(role)
    if normalized not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=403, detail=f"未知角色: {role}")
    return normalized


def require_permission(permission: str):
    """工厂函数：返回一个检查特定权限的依赖。"""
    def _checker(role: str = Depends(get_current_role)):
        check_permission(role, permission)
        return role
    return _checker
