"""
角色权限验证模块
定义每个角色的功能权限，并提供权限检查函数
"""

from fastapi import HTTPException
from typing import Optional

# 角色权限矩阵
ROLE_PERMISSIONS = {
    # 柜台
    'counter': {
        'can_inbound': False,              # 不能入库
        'can_create_sales': True,          # 可以开销售单
        'can_create_settlement': False,    # 不能创建结算单
        'can_transfer': False,             # 不能发起转移
        'can_receive_transfer': True,      # 可以接收转移
        'can_manage_customers': True,      # 可以管理客户（创建/编辑/删除）
        'can_view_customers': True,        # 可以查看客户（查询/往来账）
        'can_manage_suppliers': False,     # 不能管理供应商
        'can_manage_salespersons': False,  # 不能管理业务员
        'can_view_analytics': False,       # 不能看数据分析
        'can_export': False,               # 不能导出数据
        'can_delete': False,               # 不能删除数据
        'can_return_to_supplier': False,   # 不能退货给供应商
        'can_return_to_warehouse': True,   # 可以退货给商品部
        'can_view_finance': False,         # 不能查看财务
    },
    
    # 商品专员
    'product': {
        'can_inbound': True,               # 可以入库
        'can_create_sales': False,         # 不能开销售单
        'can_create_settlement': False,    # 不能创建结算单
        'can_transfer': True,              # 可以发起转移
        'can_receive_transfer': False,     # 不能接收转移
        'can_manage_customers': False,     # 不能管理客户
        'can_view_customers': False,       # 不能查看客户
        'can_manage_suppliers': True,      # 可以管理供应商（但不能删除）
        'can_manage_salespersons': False,  # 不能管理业务员
        'can_view_analytics': False,       # 不能看数据分析
        'can_export': False,               # 不能导出数据
        'can_delete': False,               # 不能删除数据
        'can_return_to_supplier': True,    # 可以退货给供应商
        'can_return_to_warehouse': False,  # 不能退货给商品部
        'can_view_finance': False,         # 不能查看财务
    },
    
    # 结算专员
    'settlement': {
        'can_inbound': False,
        'can_create_sales': False,
        'can_create_settlement': True,     # 可以创建结算单
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,
        'can_view_customers': False,       # 不能查看客户
        'can_manage_suppliers': False,
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': False,
        'can_view_finance': False,
    },
    
    # 业务员
    'sales': {
        'can_inbound': False,
        'can_create_sales': False,         # 不能开销售单
        'can_create_settlement': False,
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,     # 不能管理客户（不能创建/编辑/删除）
        'can_view_customers': True,        # 可以查看客户（查询/往来账）
        'can_manage_suppliers': False,
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': False,
        'can_view_finance': False,
    },
    
    # 财务
    'finance': {
        'can_inbound': False,
        'can_create_sales': False,
        'can_create_settlement': False,
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,
        'can_view_customers': False,       # 不能查看客户
        'can_manage_suppliers': False,
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': False,
        'can_view_finance': True,          # 可以查看财务
    },
    
    # 管理层 - 拥有所有权限
    'manager': {
        'can_inbound': True,
        'can_create_sales': True,
        'can_create_settlement': True,
        'can_transfer': True,
        'can_receive_transfer': True,
        'can_manage_customers': True,
        'can_view_customers': True,        # 可以查看客户
        'can_manage_suppliers': True,
        'can_manage_salespersons': True,
        'can_view_analytics': True,
        'can_export': True,
        'can_delete': True,
        'can_return_to_supplier': True,
        'can_return_to_warehouse': True,
        'can_view_finance': True,
    }
}

# 权限对应的中文操作名
PERMISSION_NAMES = {
    'can_inbound': '商品入库',
    'can_create_sales': '创建销售单',
    'can_create_settlement': '创建结算单',
    'can_transfer': '发起库存转移',
    'can_receive_transfer': '接收库存',
    'can_manage_customers': '客户管理',
    'can_view_customers': '查看客户',
    'can_manage_suppliers': '供应商管理',
    'can_manage_salespersons': '业务员管理',
    'can_view_analytics': '数据分析',
    'can_export': '数据导出',
    'can_delete': '删除数据',
    'can_return_to_supplier': '退货给供应商',
    'can_return_to_warehouse': '退货给商品部',
    'can_view_finance': '财务管理',
}

# AI操作到权限的映射
ACTION_TO_PERMISSION = {
    '入库': 'can_inbound',
    '创建销售单': 'can_create_sales',
    '创建结算单': 'can_create_settlement',
    '创建转移单': 'can_transfer',
    '接收库存': 'can_receive_transfer',
    '创建客户': 'can_manage_customers',
    '创建供应商': 'can_manage_suppliers',
}


def has_permission(role: str, permission: str) -> bool:
    """
    检查角色是否有某个权限
    
    Args:
        role: 角色ID (counter, product, settlement, sales, finance, manager)
        permission: 权限名称 (can_inbound, can_create_sales, 等)
    
    Returns:
        bool: 是否有权限
    """
    if not role or role not in ROLE_PERMISSIONS:
        return False
    return ROLE_PERMISSIONS[role].get(permission, False)


def check_permission(role: str, permission: str) -> None:
    """
    检查权限，如果没有权限则抛出HTTP异常
    
    Args:
        role: 角色ID
        permission: 权限名称
    
    Raises:
        HTTPException: 如果没有权限
    """
    if not has_permission(role, permission):
        permission_name = PERMISSION_NAMES.get(permission, permission)
        raise HTTPException(
            status_code=403, 
            detail=f"权限不足：您没有【{permission_name}】的权限"
        )


def get_permission_denied_message(permission: str, role: str = None) -> str:
    """
    获取权限不足的友好错误消息
    
    Args:
        permission: 权限名称
        role: 可选，当前角色
    
    Returns:
        str: 错误消息
    """
    permission_name = PERMISSION_NAMES.get(permission, permission)
    
    # 根据权限类型，提示应该找谁
    suggestions = {
        'can_inbound': '请联系商品专员或管理层',
        'can_create_sales': '请联系柜台人员或管理层',
        'can_create_settlement': '请联系结算专员或管理层',
        'can_transfer': '请联系商品专员或管理层',
        'can_receive_transfer': '请联系柜台人员或管理层',
        'can_manage_customers': '请联系柜台人员或管理层',
        'can_view_customers': '请联系柜台人员、业务员或管理层',
        'can_manage_suppliers': '请联系商品专员或管理层',
        'can_manage_salespersons': '请联系管理层',
        'can_view_analytics': '请联系管理层',
        'can_export': '请联系管理层',
        'can_delete': '请联系管理层',
        'can_return_to_supplier': '请联系商品专员或管理层',
        'can_return_to_warehouse': '请联系柜台人员或管理层',
        'can_view_finance': '请联系财务人员或管理层',
    }
    
    suggestion = suggestions.get(permission, '')
    return f"抱歉，您没有【{permission_name}】的权限。{suggestion}"


def check_action_permission(role: str, action: str) -> tuple[bool, str]:
    """
    检查AI操作的权限
    
    Args:
        role: 角色ID
        action: AI解析出的操作（如"入库"、"创建销售单"等）
    
    Returns:
        tuple: (是否有权限, 错误消息或空字符串)
    """
    permission = ACTION_TO_PERMISSION.get(action)
    
    # 如果操作不在映射中，默认允许（查询类操作）
    if not permission:
        return True, ""
    
    if has_permission(role, permission):
        return True, ""
    
    return False, get_permission_denied_message(permission, role)

