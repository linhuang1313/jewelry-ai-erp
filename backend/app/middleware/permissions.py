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
        'can_view_supplier_gold_account': False,  # 不能查看供应商金料账户
        # 暂借单权限
        'can_create_loan': True,           # 可以创建暂借单
        'can_manage_loan': True,           # 可以管理暂借单（确认借出、归还、撤销）
        # 协同卡片权限
        'can_execute_action_card': True,   # 可以执行协同卡片
        'can_create_action_card': False,   # 不能创建协同卡片
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
        'can_manage_product_codes': True,  # 可以管理商品编码（F/FL编码）
        'can_view_supplier_gold_account': False,  # 不能查看供应商金料账户
        # 采购单权限
        'can_view_purchase_orders': True,   # 可以查看采购单
        'can_view_purchase_returns': True,  # 可以查看采购退货单
        'can_audit_inbound': False,         # 不能审核入库单
        # 协同卡片权限
        'can_execute_action_card': True,
        'can_create_action_card': False,
    },
    
    # 结算专员
    'settlement': {
        'can_inbound': False,
        'can_create_sales': False,
        'can_create_settlement': True,     # 可以创建结算单
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,
        'can_view_customers': True,        # 可以查看客户（查询欠款信息）
        'can_manage_suppliers': False,
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': True,   # 可以退货给商品部（销退时需要）
        'can_view_finance': False,
        # 金料管理权限
        'can_create_gold_receipt': True,   # 可以创建收料单（收到客户原料后）
        'can_view_gold_material': True,    # 可以查看金料记录
        'can_confirm_gold_receive': True,  # 可以确认收到客人金料
        'can_create_gold_payment': False,  # 不能创建付料单（料部职责）
        'can_gold_refund_to_customer': True,  # 可以退料给客户
        'can_gold_payment_to_supplier': False, # 不能付料给供应商
        # 客户取料/转料权限
        'can_create_withdrawal': True,     # 可以创建取料单
        'can_complete_withdrawal': True,   # 可以确认取料（扣减余额）
        'can_create_transfer': True,       # 可以创建转料单
        'can_confirm_transfer': False,     # 不能确认转料（料部职责）
        'can_refund_settlement': True,     # 可以执行销退操作
        'can_view_supplier_gold_account': False,  # 不能查看供应商金料账户
        # 暂借单权限
        'can_create_loan': True,           # 可以创建暂借单
        'can_manage_loan': True,           # 可以管理暂借单（确认借出、归还、撤销）
        # 销退模块权限
        'can_sales_return': True,          # 可以操作销退（创建销退单、销退结算）
        # 收款权限
        'can_record_payment': True,        # 可以登记客户收款
        # 协同卡片权限
        'can_execute_action_card': True,
        'can_create_action_card': True,
    },
    
    # 业务员 - 只能查询客户相关信息
    'sales': {
        # 操作权限全部关闭
        'can_inbound': False,
        'can_create_sales': False,         # 不能开销售单
        'can_create_settlement': False,
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,     # 不能管理客户（不能创建/编辑/删除）
        'can_manage_suppliers': False,
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': False,
        'can_view_finance': False,
        # 查询权限开启
        'can_view_customers': True,              # 可以查看客户列表
        'can_query_customer_sales': True,        # 可以查询客户销售记录
        'can_query_customer_returns': True,      # 可以查询客户退货记录
        'can_query_customer_balance': True,      # 可以查询客户欠款/存料余额
        'can_query_customer_transactions': True, # 可以查询客户往来账目
        'can_view_supplier_gold_account': False,  # 不能查看供应商金料账户
        # 协同卡片权限
        'can_execute_action_card': False,
        'can_create_action_card': True,    # 业务员可以发起协同卡片
    },
    
    # 财务 - 权限与管理层一致
    'finance': {
        'can_inbound': True,               # 可以查看入库单
        'can_create_sales': True,          # 可以查看销售单
        'can_create_settlement': True,     # 可以查看结算单
        'can_transfer': True,              # 可以查看转移单
        'can_receive_transfer': True,
        'can_manage_customers': True,      # 可以管理客户
        'can_view_customers': True,        # 可以查看客户
        'can_manage_suppliers': True,      # 可以管理供应商
        'can_view_suppliers': True,        # 可以查看供应商
        'can_manage_salespersons': True,   # 可以管理业务员
        'can_view_analytics': True,        # 可以看数据分析
        'can_export': True,                # 可以导出数据
        'can_delete': True,                # 可以删除数据
        'can_return_to_supplier': True,    # 可以查看退货给供应商
        'can_return_to_warehouse': True,   # 可以查看退货给商品部
        'can_view_finance': True,          # 可以查看财务
        'can_record_payment': True,        # 可以登记收款（客户）
        'can_record_supplier_payment': True,  # 可以登记供应商付款（工费）
        # 金料管理权限（全部）
        'can_create_gold_receipt': True,
        'can_view_gold_material': True,
        'can_confirm_gold_receive': True,
        'can_create_gold_payment': True,
        'can_manage_gold_material': True,
        'can_gold_payment_to_supplier': True,
        'can_gold_refund_to_customer': True,
        # 客户取料/转料权限（全部）
        'can_create_withdrawal': True,
        'can_complete_withdrawal': True,
        'can_create_transfer': True,
        'can_confirm_transfer': True,
        # 商品编码管理
        'can_manage_product_codes': True,
        # 结算销退权限
        'can_refund_settlement': True,
        # 供应商金料账户权限
        'can_view_supplier_gold_account': True,
        # 暂借单权限
        'can_create_loan': True,
        'can_manage_loan': True,
        # 采购单权限
        'can_view_purchase_orders': True,
        'can_view_purchase_returns': True,
        'can_audit_inbound': True,          # 可以审核入库单
        # 销退模块权限
        'can_sales_return': True,           # 可以操作销退
        # 协同卡片权限
        'can_execute_action_card': True,
        'can_create_action_card': True,
    },
    
    # 料部 - 管理金料的收发
    'material': {
        'can_inbound': False,
        'can_create_sales': False,
        'can_create_settlement': False,
        'can_transfer': False,
        'can_receive_transfer': False,
        'can_manage_customers': False,
        'can_view_customers': True,        # 可以查看客户（查询关联信息）
        'can_manage_suppliers': True,     # 可以管理供应商（添加、编辑，但不能删除）
        'can_view_suppliers': True,        # 可以查看供应商（查询关联信息）
        'can_manage_salespersons': False,
        'can_view_analytics': False,
        'can_export': False,
        'can_delete': False,
        'can_return_to_supplier': False,
        'can_return_to_warehouse': False,
        'can_view_finance': False,
        # 金料管理权限（核心职责）
        'can_create_gold_receipt': False,  # 不能创建收料单（结算专员职责）
        'can_view_gold_material': True,    # 可以查看金料记录
        'can_confirm_gold_receive': False, # 不能确认收料（结算职责）
        'can_create_gold_payment': True,   # 可以创建付料单（支付供应商）
        'can_manage_gold_material': True,  # 可以管理金料流转（核心权限）
        'can_gold_payment_to_supplier': True,  # 可以付料给供应商
        'can_gold_refund_to_customer': False,  # 不能退料给客户（结算职责）
        # 客户取料/转料权限
        'can_create_withdrawal': False,    # 不能创建取料单（结算职责）
        'can_complete_withdrawal': False,  # 不能确认取料（结算职责）
        'can_create_transfer': False,      # 不能创建转料单（结算职责）
        'can_confirm_transfer': True,      # 可以确认转料
        # 供应商金料账户权限
        'can_view_supplier_gold_account': True,   # 可以查看供应商金料账户（核心职责）
        # 协同卡片权限
        'can_execute_action_card': True,
        'can_create_action_card': False,
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
        'can_view_suppliers': True,        # 可以查看供应商
        'can_manage_salespersons': True,
        'can_view_analytics': True,
        'can_export': True,
        'can_delete': True,
        'can_return_to_supplier': True,
        'can_return_to_warehouse': True,
        'can_view_finance': True,
        'can_record_payment': True,        # 可以登记收款（客户）
        'can_record_supplier_payment': True,  # 可以登记供应商付款（工费）
        # 金料管理权限（全部）
        'can_create_gold_receipt': True,
        'can_view_gold_material': True,
        'can_confirm_gold_receive': True,
        'can_create_gold_payment': True,
        'can_manage_gold_material': True,
        'can_gold_payment_to_supplier': True,  # 可以付料给供应商
        'can_gold_refund_to_customer': True,   # 可以退料给客户
        # 客户取料/转料权限（全部）
        'can_create_withdrawal': True,
        'can_complete_withdrawal': True,
        'can_create_transfer': True,
        'can_confirm_transfer': True,
        # 商品编码管理
        'can_manage_product_codes': True,
        # 结算销退权限
        'can_refund_settlement': True,     # 可以执行销退操作
        # 供应商金料账户权限
        'can_view_supplier_gold_account': True,   # 可以查看供应商金料账户
        # 暂借单权限
        'can_create_loan': True,           # 可以创建暂借单
        'can_manage_loan': True,           # 可以管理暂借单
        # 采购单权限
        'can_view_purchase_orders': True,   # 可以查看采购单
        'can_view_purchase_returns': True,  # 可以查看采购退货单
        'can_audit_inbound': True,          # 可以审核入库单
        # 销退模块权限
        'can_sales_return': True,           # 可以操作销退
        # 协同卡片权限
        'can_execute_action_card': True,
        'can_create_action_card': True,
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
    'can_view_suppliers': '查看供应商',
    'can_manage_salespersons': '业务员管理',
    'can_view_analytics': '数据分析',
    'can_export': '数据导出',
    'can_delete': '删除数据',
    'can_return_to_supplier': '退货给供应商',
    'can_return_to_warehouse': '退货给商品部',
    'can_view_finance': '财务管理',
    # 金料管理权限
    'can_create_gold_receipt': '创建收料单',
    'can_view_gold_material': '查看金料记录',
    'can_confirm_gold_receive': '确认收到原料',
    'can_create_gold_payment': '创建付料单',
    'can_manage_gold_material': '管理金料流转',
    # 客户取料/转料权限
    'can_create_withdrawal': '创建取料单',
    'can_complete_withdrawal': '完成取料',
    'can_create_transfer': '创建转料单',
    'can_confirm_transfer': '确认转料',
    # 商品编码管理
    'can_manage_product_codes': '管理商品编码',
    # 付料/退料权限区分
    'can_gold_payment_to_supplier': '付料给供应商',
    'can_gold_refund_to_customer': '退料给客户',
    # 结算销退权限
    'can_refund_settlement': '销退操作',
    # 供应商金料账户权限
    'can_view_supplier_gold_account': '查看供应商金料账户',
    # 暂借单权限
    'can_create_loan': '创建暂借单',
    'can_manage_loan': '管理暂借单',
    # 财务付款权限
    'can_record_payment': '登记客户收款',
    'can_record_supplier_payment': '登记供应商付款',
    'can_audit_inbound': '审核入库单',
    # 销退模块
    'can_sales_return': '销退管理',
    # 协同卡片
    'can_execute_action_card': '执行协同卡片',
    'can_create_action_card': '创建协同卡片',
}

# AI操作到权限的映射
ACTION_TO_PERMISSION = {
    '入库': 'can_inbound',
    '创建销售单': 'can_create_sales',
    '创建结算单': 'can_create_settlement',
    '创建转移单': 'can_transfer',
    '批量转移': 'can_transfer',  # 批量转移使用相同的转移权限
    '接收库存': 'can_receive_transfer',
    '创建客户': 'can_manage_customers',
    '创建供应商': 'can_manage_suppliers',
    # 金料操作
    '创建收料单': 'can_create_gold_receipt',
    '收料': 'can_create_gold_receipt',  # 收料 = 创建收料单
    '确认收料': 'can_confirm_gold_receive',
    '创建付料单': 'can_create_gold_payment',
    '付料': 'can_gold_payment_to_supplier',  # 付料给供应商
    '提料': 'can_create_withdrawal',  # 客户提料
    # 财务操作
    '登记收款': 'can_record_payment',
    '供应商付款': 'can_record_supplier_payment',  # 供应商工费付款
}


def normalize_role(role: str) -> str:
    """
    归一化角色名：去掉末尾数字后缀（如 product1 -> product）
    """
    import re
    if not role:
        return role
    normalized = re.sub(r'\d+$', '', role)
    return normalized if normalized in ROLE_PERMISSIONS else role


def has_permission(role: str, permission: str) -> bool:
    """
    检查角色是否有某个权限
    
    Args:
        role: 角色ID (counter, product, settlement, sales, finance, manager)
        permission: 权限名称 (can_inbound, can_create_sales, 等)
    
    Returns:
        bool: 是否有权限
    """
    if not role:
        return False
    actual_role = role if role in ROLE_PERMISSIONS else normalize_role(role)
    if actual_role not in ROLE_PERMISSIONS:
        return False
    return ROLE_PERMISSIONS[actual_role].get(permission, False)


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
        'can_view_suppliers': '请联系商品专员、料部或管理层',
        'can_manage_salespersons': '请联系管理层',
        'can_view_analytics': '请联系管理层',
        'can_export': '请联系管理层',
        'can_delete': '请联系管理层',
        'can_return_to_supplier': '请联系商品专员或管理层',
        'can_return_to_warehouse': '请联系柜台人员或管理层',
        'can_view_finance': '请联系财务人员或管理层',
        # 金料管理
        'can_create_gold_receipt': '请联系结算专员或管理层',
        'can_view_gold_material': '请联系结算专员、料部或管理层',
        'can_confirm_gold_receive': '请联系料部或管理层',
        'can_create_gold_payment': '请联系料部或管理层',
        'can_manage_gold_material': '请联系料部或管理层',
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

