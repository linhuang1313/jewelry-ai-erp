"""
数据库模型模块
包含所有 SQLAlchemy ORM 模型定义
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


# ============= 业务员模型 =============

class Salesperson(Base):
    """业务员表"""
    __tablename__ = "salespersons"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)  # 业务员姓名
    phone = Column(String(20))  # 电话
    status = Column(String(20), default="active")  # active/inactive
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    remark = Column(Text)  # 备注


# ============= 入库相关模型 =============

class InboundOrder(Base):
    """入库单主表"""
    __tablename__ = "inbound_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, index=True, nullable=False)
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    operator = Column(String(50), default="系统管理员")
    status = Column(String(20), default="已入库")


class InboundDetail(Base):
    """入库单明细表"""
    __tablename__ = "inbound_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("inbound_orders.id"))
    product_code = Column(String(20), nullable=True, index=True)  # 商品编码（JPJZ, F00000001等）
    product_name = Column(String(200), nullable=False)
    product_category = Column(String(100))
    weight = Column(Float, nullable=False)
    labor_cost = Column(Float, nullable=False)  # 克工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数（可选）
    piece_labor_cost = Column(Float, nullable=True)  # 件工费（元/件，可选）
    supplier = Column(String(100))  # 保留字符串字段（向后兼容）
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)  # 关联供应商表
    total_cost = Column(Float, nullable=False)  # 总成本 = 克工费 + 件工费
    
    order = relationship("InboundOrder", backref="details")


class Inventory(Base):
    """库存表"""
    __tablename__ = "inventory"
    
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), unique=True, nullable=False, index=True)
    total_weight = Column(Float, default=0.0)
    last_update = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ============= 供应商模型 =============

class Supplier(Base):
    """供应商表"""
    __tablename__ = "suppliers"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_no = Column(String(50), unique=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    phone = Column(String(20))
    wechat = Column(String(50))
    address = Column(String(200))
    contact_person = Column(String(50))  # 联系人
    supplier_type = Column(String(20), default="个人")  # 个人/公司
    total_supply_amount = Column(Float, default=0.0)  # 总供货金额（总工费）
    total_supply_weight = Column(Float, default=0.0)  # 总供货重量
    total_supply_count = Column(Integer, default=0)  # 供货次数
    last_supply_time = Column(DateTime)  # 最后供货时间
    status = Column(String(20), default="active")
    create_time = Column(DateTime, server_default=func.now())
    remark = Column(Text)
    
    # 关系
    inbound_details = relationship("InboundDetail", backref="supplier_obj")


# ============= 客户模型 =============

class Customer(Base):
    """客户表"""
    __tablename__ = "customers"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_no = Column(String(50), unique=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    phone = Column(String(20))
    wechat = Column(String(50))
    address = Column(String(200))
    customer_type = Column(String(20), default="个人")
    total_purchase_amount = Column(Float, default=0.0)
    total_purchase_count = Column(Integer, default=0)
    last_purchase_time = Column(DateTime)
    status = Column(String(20), default="active")
    create_time = Column(DateTime, server_default=func.now())
    remark = Column(Text)
    
    # 关系
    sales_orders = relationship("SalesOrder", backref="customer")


# ============= 销售相关模型 =============

class SalesOrder(Base):
    """销售单主表"""
    __tablename__ = "sales_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, index=True, nullable=False)
    order_date = Column(DateTime, nullable=False, server_default=func.now())  # 日期
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)  # 客户ID（可选，兼容直接输入姓名）
    customer_name = Column(String(100), nullable=False)  # 客户姓名（冗余字段，便于查询）
    salesperson = Column(String(50), nullable=False)  # 业务员姓名
    store_code = Column(String(50))  # 门店代码
    total_labor_cost = Column(Float, default=0.0)  # 总工费
    total_weight = Column(Float, default=0.0)  # 总克重
    remark = Column(Text)  # 备注信息
    status = Column(String(20), default="待结算")  # 待结算/已结算/已取消
    create_time = Column(DateTime, server_default=func.now())
    operator = Column(String(50), default="系统管理员")
    
    # 关系
    details = relationship("SalesDetail", backref="order", cascade="all, delete-orphan")


class SalesDetail(Base):
    """销售明细表"""
    __tablename__ = "sales_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)
    product_name = Column(String(200), nullable=False)  # 商品名称
    weight = Column(Float, nullable=False)  # 克重
    labor_cost = Column(Float, nullable=False)  # 工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数（可选）
    piece_labor_cost = Column(Float, nullable=True)  # 件工费（元/件，可选）
    total_labor_cost = Column(Float, nullable=False)  # 总工费 = (克重 * 克工费) + (件数 * 件工费)
    inventory_id = Column(Integer, ForeignKey("inventory.id"), nullable=True)  # 关联库存（可选）


# ============= 结算单模型 =============

class SettlementOrder(Base):
    """结算单 - 确认销售单的原料支付方式并复核"""
    __tablename__ = "settlement_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, index=True, nullable=False)  # 结算单号
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)  # 关联销售单
    
    # 原料支付方式
    payment_method = Column(String(20), nullable=False)  # 'cash_price' 结价 / 'physical_gold' 结料 / 'mixed' 混合支付
    gold_price = Column(Float, nullable=True)  # 当日金价（元/克），结价或混合支付时必填
    physical_gold_weight = Column(Float, nullable=True)  # 客户需支付的黄金重量（克），结料或混合支付时使用
    
    # 混合支付专用字段
    gold_payment_weight = Column(Float, nullable=True)  # 混合支付：结料部分的克重
    cash_payment_weight = Column(Float, nullable=True)  # 混合支付：结价部分的克重
    
    # 金额计算
    total_weight = Column(Float, nullable=False)  # 商品总克重
    material_amount = Column(Float, nullable=True)  # 原料金额 = 金价 × 克重（结价支付时）
    labor_amount = Column(Float, nullable=False)  # 工费金额
    total_amount = Column(Float, nullable=False)  # 应收总额 = 原料金额 + 工费金额
    
    # 客户历史余额快照（创建结算单时记录）
    previous_cash_debt = Column(Float, default=0.0)      # 上次现金欠款（元）
    previous_gold_debt = Column(Float, default=0.0)      # 上次金料欠款（克）
    gold_deposit_balance = Column(Float, default=0.0)    # 存料余额（克）
    cash_deposit_balance = Column(Float, default=0.0)    # 存款余额（元）
    
    # 灵活支付状态
    payment_difference = Column(Float, default=0.0)  # 支付差额（正=多付，负=少付）
    payment_status = Column(String(20), default="full")  # full全额 / overpaid多付 / underpaid少付
    
    # 状态和操作信息
    status = Column(String(20), default="pending")  # pending待结算 / confirmed已确认 / printed已打印
    created_by = Column(String(50))  # 创建人（柜台）
    confirmed_by = Column(String(50), nullable=True)  # 确认人（结算专员）
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    printed_at = Column(DateTime, nullable=True)  # 打印时间
    remark = Column(Text, nullable=True)  # 备注
    
    created_at = Column(DateTime, server_default=func.now())
    
    # 关系
    sales_order = relationship("SalesOrder", backref="settlement")


# ============= 财务相关模型 =============
# 从 finance.py 导入
from .finance import AccountReceivable, PaymentRecord, ReminderRecord, ReconciliationStatement


# ============= 对话日志模型 =============

class ChatLog(Base):
    """对话日志表 - 记录用户与AI的对话，用于数据分析和知识库构建"""
    __tablename__ = "chat_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), index=True)  # 对话会话ID
    user_role = Column(String(20), index=True)  # 用户角色: sales/finance/product/manager
    message_type = Column(String(10))  # 消息类型: user/assistant
    content = Column(Text)  # 消息内容
    intent = Column(String(50), nullable=True, index=True)  # AI识别的意图
    entities = Column(Text, nullable=True)  # 提取的实体（JSON格式）
    response_time_ms = Column(Integer, nullable=True)  # 响应时间（毫秒）
    is_successful = Column(Integer, default=1)  # 是否成功处理
    error_message = Column(Text, nullable=True)  # 错误信息
    created_at = Column(DateTime, server_default=func.now(), index=True)  # 创建时间


class ChatSessionMeta(Base):
    """对话会话元数据表 - 存储会话的自定义名称等信息"""
    __tablename__ = "chat_session_meta"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), unique=True, index=True, nullable=False)  # 会话ID
    custom_name = Column(String(200), nullable=True)  # 用户自定义的会话名称
    is_pinned = Column(Integer, default=0)  # 是否置顶
    is_archived = Column(Integer, default=0)  # 是否归档
    created_at = Column(DateTime, server_default=func.now())  # 创建时间
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())  # 更新时间


# ============= 仓库/位置管理模型 =============

class Location(Base):
    """仓库/位置表 - 管理不同的库存位置"""
    __tablename__ = "locations"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)  # 位置代码: warehouse, showroom_1
    name = Column(String(100), nullable=False)  # 位置名称: 商品部仓库, 展厅1
    location_type = Column(String(20), nullable=False)  # 类型: warehouse(仓库), showroom(展厅), transit(在途)
    description = Column(Text, nullable=True)  # 描述
    is_active = Column(Integer, default=1)  # 是否启用
    created_at = Column(DateTime, server_default=func.now())
    
    # 关系
    inventory_items = relationship("LocationInventory", backref="location")


class LocationInventory(Base):
    """分仓库存表 - 按位置记录库存"""
    __tablename__ = "location_inventory"
    
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), nullable=False, index=True)  # 商品名称
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)  # 所在位置
    weight = Column(Float, default=0.0)  # 库存重量
    last_update = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 唯一约束：同一位置同一商品只有一条记录
    __table_args__ = (
        # UniqueConstraint handled by index
    )


class InventoryTransfer(Base):
    """货品转移单 - 记录库存在不同位置间的转移"""
    __tablename__ = "inventory_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, index=True, nullable=False)  # 转移单号
    product_name = Column(String(200), nullable=False)  # 商品名称
    weight = Column(Float, nullable=False)  # 转移重量
    from_location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)  # 发出位置
    to_location_id = Column(Integer, ForeignKey("locations.id"), nullable=False)  # 目标位置
    status = Column(String(20), default="pending")  # 状态: pending(待接收), received(已接收), rejected(已拒收)
    
    # 发起信息
    created_by = Column(String(50))  # 发起人
    created_at = Column(DateTime, server_default=func.now())
    remark = Column(Text, nullable=True)  # 备注
    
    # 接收信息
    received_by = Column(String(50), nullable=True)  # 接收人
    received_at = Column(DateTime, nullable=True)  # 接收时间
    actual_weight = Column(Float, nullable=True)  # 实际接收重量
    weight_diff = Column(Float, nullable=True)  # 重量差异 (实际-预期)
    diff_reason = Column(Text, nullable=True)  # 差异原因
    
    # 关系
    from_location = relationship("Location", foreign_keys=[from_location_id])
    to_location = relationship("Location", foreign_keys=[to_location_id])


# ============= 库存预警设置模型 =============

class InventoryAlertSetting(Base):
    """库存预警设置表"""
    __tablename__ = "inventory_alert_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), unique=True, nullable=False, index=True)  # 商品名称
    min_weight = Column(Float, default=50.0)  # 最低库存阈值（克）
    slow_days = Column(Integer, default=30)  # 滞销天数阈值
    is_enabled = Column(Integer, default=1)  # 是否启用预警
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


# ============= 退货单模型 =============

class ReturnOrder(Base):
    """退货单表 - 记录商品部退给供应商或展厅退给商品部的退货"""
    __tablename__ = "return_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    return_no = Column(String(50), unique=True, index=True, nullable=False)  # 退货单号
    
    # 退货类型: to_supplier(退给供应商) / to_warehouse(退给商品部)
    return_type = Column(String(30), nullable=False, index=True)
    
    # 商品信息
    product_name = Column(String(200), nullable=False)  # 商品名称
    return_weight = Column(Float, nullable=False)  # 退货克重
    
    # 来源位置（发起退货的位置）
    from_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    
    # 退给供应商时的供应商ID
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    
    # 关联原入库单（可选，便于追溯）
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id"), nullable=True)
    
    # 退货原因
    return_reason = Column(String(50), nullable=False)  # 原因分类: 质量问题/款式不符/数量差异/工艺瑕疵/其他
    reason_detail = Column(Text, nullable=True)  # 详细说明
    
    # 状态: pending待审批 / approved已批准 / completed已完成 / rejected已驳回
    status = Column(String(20), default="pending", index=True)
    
    # 发起信息
    created_by = Column(String(50))  # 发起人
    created_at = Column(DateTime, server_default=func.now())  # 发起时间
    
    # 审批信息
    approved_by = Column(String(50), nullable=True)  # 审批人
    approved_at = Column(DateTime, nullable=True)  # 审批时间
    reject_reason = Column(Text, nullable=True)  # 驳回原因
    
    # 完成信息
    completed_by = Column(String(50), nullable=True)  # 完成操作人
    completed_at = Column(DateTime, nullable=True)  # 完成时间
    
    # 附件和备注
    images = Column(Text, nullable=True)  # 退货图片（JSON数组存储URL）
    remark = Column(Text, nullable=True)  # 备注
    
    # 关系
    from_location = relationship("Location", foreign_keys=[from_location_id])
    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    inbound_order = relationship("InboundOrder", foreign_keys=[inbound_order_id])


# ============= 金料管理模型 =============

class GoldMaterialTransaction(Base):
    """金料流转记录表 - 收料单（SL）和付料单（FL）"""
    __tablename__ = "gold_material_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    transaction_no = Column(String(50), unique=True, index=True, nullable=False)  # 流转单号（SL收料/FL付料）
    
    # 流转类型
    transaction_type = Column(String(20), nullable=False, index=True)  # 'income' 收入（收料）/ 'expense' 支出（付料）
    
    # 收入场景（从客户收料）
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id"), nullable=True)  # 关联结算单
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)  # 客户ID
    customer_name = Column(String(100), nullable=True)  # 客户名称（冗余，便于查询）
    
    # 支出场景（支付供应商）
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id"), nullable=True)  # 关联入库单
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)  # 供应商ID
    supplier_name = Column(String(100), nullable=True)  # 供应商名称（冗余）
    
    # 金料信息
    gold_weight = Column(Float, nullable=False)  # 金料重量（克）
    
    # 状态和时间
    status = Column(String(20), default="pending", index=True)  # pending待确认 / confirmed已确认 / cancelled已取消
    created_by = Column(String(50))  # 创建人（结算专员创建收料单，料部创建付料单）
    confirmed_by = Column(String(50), nullable=True)  # 确认人（料部）
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    created_at = Column(DateTime, server_default=func.now())  # 创建时间
    
    # 单据生成时间
    receipt_printed_at = Column(DateTime, nullable=True)  # 收料单打印时间（收入时）
    payment_printed_at = Column(DateTime, nullable=True)  # 付料单打印时间（支出时）
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    settlement_order = relationship("SettlementOrder", foreign_keys=[settlement_order_id])
    inbound_order = relationship("InboundOrder", foreign_keys=[inbound_order_id])
    customer = relationship("Customer", foreign_keys=[customer_id])
    supplier = relationship("Supplier", foreign_keys=[supplier_id])


class CustomerGoldDeposit(Base):
    """客户存料表 - 记录客户预存的金料余额"""
    __tablename__ = "customer_gold_deposits"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, unique=True, index=True)  # 客户ID（唯一）
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 存料余额
    current_balance = Column(Float, default=0.0)  # 当前存料余额（克）
    
    # 统计信息
    total_deposited = Column(Float, default=0.0)  # 累计存入
    total_used = Column(Float, default=0.0)  # 累计使用
    last_transaction_at = Column(DateTime, nullable=True)  # 最后交易时间
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # 关系
    customer = relationship("Customer", backref="gold_deposit")


class CustomerGoldDepositTransaction(Base):
    """客户存料交易记录表 - 记录存料的存入和使用"""
    __tablename__ = "customer_gold_deposit_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 交易类型
    transaction_type = Column(String(20), nullable=False, index=True)  # 'deposit' 存入 / 'use' 使用 / 'refund' 退还
    
    # 关联单据
    gold_transaction_id = Column(Integer, ForeignKey("gold_material_transactions.id"), nullable=True)  # 收料单（存入时）
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id"), nullable=True)  # 结算单（使用时）
    
    # 存料信息
    amount = Column(Float, nullable=False)  # 本次交易金额（克）
    balance_before = Column(Float, nullable=False)  # 交易前余额
    balance_after = Column(Float, nullable=False)  # 交易后余额
    
    # 状态和时间
    status = Column(String(20), default="active")  # active有效 / cancelled已取消
    created_at = Column(DateTime, server_default=func.now())
    created_by = Column(String(50))  # 操作人
    remark = Column(Text, nullable=True)  # 备注
    
    # 关系
    customer = relationship("Customer", backref="deposit_transactions")
    gold_transaction = relationship("GoldMaterialTransaction", foreign_keys=[gold_transaction_id])
    settlement_order = relationship("SettlementOrder", foreign_keys=[settlement_order_id])


class CustomerTransaction(Base):
    """客户往来账记录表 - 记录客户的所有交易和欠款变化"""
    __tablename__ = "customer_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 交易类型
    transaction_type = Column(String(20), nullable=False, index=True)  
    # 'sales' 销售 / 'settlement' 结算 / 'gold_receipt' 收料 / 'payment' 付款
    
    # 关联单据
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id"), nullable=True)
    gold_transaction_id = Column(Integer, ForeignKey("gold_material_transactions.id"), nullable=True)
    
    # 金额信息
    amount = Column(Float, default=0.0)  # 金额（元）
    gold_weight = Column(Float, default=0.0)  # 金料重量（克）
    
    # 欠款信息（金料）
    gold_due_before = Column(Float, default=0.0)  # 本次交易前金料欠款
    gold_due_after = Column(Float, default=0.0)  # 本次交易后金料欠款
    
    # 状态和时间
    status = Column(String(20), default="active")  # active有效 / cancelled已取消
    created_at = Column(DateTime, server_default=func.now())
    remark = Column(Text, nullable=True)  # 备注
    
    # 关系
    customer = relationship("Customer", backref="transactions")
    sales_order = relationship("SalesOrder", foreign_keys=[sales_order_id])
    settlement_order = relationship("SettlementOrder", foreign_keys=[settlement_order_id])
    gold_transaction = relationship("GoldMaterialTransaction", foreign_keys=[gold_transaction_id])


# ============= 客户取料单模型 =============

class CustomerWithdrawal(Base):
    """客户取料单 - 客户从存料中取走黄金原料"""
    __tablename__ = "customer_withdrawals"
    
    id = Column(Integer, primary_key=True, index=True)
    withdrawal_no = Column(String(50), unique=True, index=True, nullable=False)  # 取料单号（QL开头）
    
    # 客户信息
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称
    
    # 取料信息
    gold_weight = Column(Float, nullable=False)  # 取料克重
    
    # 取料方式：self 自取 / deliver 送到其他公司
    withdrawal_type = Column(String(20), default="self")
    
    # 目的地信息（送到其他公司时）
    destination_company = Column(String(100), nullable=True)  # 目的地公司（如：古唐、鑫韵）
    destination_address = Column(Text, nullable=True)  # 目的地地址
    
    # 授权取料人信息
    authorized_person = Column(String(100), nullable=True)  # 授权取料人姓名
    authorized_phone = Column(String(20), nullable=True)  # 取料人电话
    
    # 状态：pending待处理 / completed已完成 / cancelled已取消
    status = Column(String(20), default="pending", index=True)
    
    # 创建信息（结算专员创建）
    created_by = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())
    
    # 完成信息（料部确认发出）
    completed_by = Column(String(50), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # 打印时间
    printed_at = Column(DateTime, nullable=True)
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    customer = relationship("Customer", backref="withdrawals")


class CustomerTransfer(Base):
    """客户转料单 - 客户之间转移存料"""
    __tablename__ = "customer_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, index=True, nullable=False)  # 转料单号（ZL开头）
    
    # 转出客户信息
    from_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    from_customer_name = Column(String(100), nullable=False)
    
    # 转入客户信息
    to_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    to_customer_name = Column(String(100), nullable=False)
    
    # 转料信息
    gold_weight = Column(Float, nullable=False)  # 转料克重
    
    # 状态：pending待确认 / completed已完成 / cancelled已取消
    status = Column(String(20), default="pending", index=True)
    
    # 创建信息（结算专员创建）
    created_by = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())
    
    # 确认信息（料部确认）
    confirmed_by = Column(String(50), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    
    # 打印时间
    printed_at = Column(DateTime, nullable=True)
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    from_customer = relationship("Customer", foreign_keys=[from_customer_id], backref="transfers_out")
    to_customer = relationship("Customer", foreign_keys=[to_customer_id], backref="transfers_in")


# ============= 商品编码模型 =============

class ProductCode(Base):
    """商品编码表 - 管理预定义编码、F编码（一码一件）、FL编码（批量）"""
    __tablename__ = "product_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True)  # 编码（JPJZ, F00000001, FL0001）
    name = Column(String(200), nullable=False)  # 商品名称
    
    # 编码类型: predefined(预定义) / f_single(F一码一件) / fl_batch(FL批量)
    code_type = Column(String(20), nullable=False, index=True)
    
    # 是否为唯一编码（F编码为True，表示一码一件）
    is_unique = Column(Integer, default=0)  # 0=非唯一, 1=唯一
    
    # 是否已使用（仅对F编码有效）
    is_used = Column(Integer, default=0)  # 0=未使用, 1=已使用
    
    # 创建信息
    created_by = Column(String(50), nullable=True)  # 创建人（仅F/FL编码）
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # 备注
    remark = Column(Text, nullable=True)


# 导出所有模型
__all__ = [
    # 入库
    'InboundOrder',
    'InboundDetail',
    'Inventory',
    # 供应商
    'Supplier',
    # 客户
    'Customer',
    # 销售
    'SalesOrder',
    'SalesDetail',
    # 结算
    'SettlementOrder',
    # 财务
    'AccountReceivable',
    'PaymentRecord',
    'ReminderRecord',
    'ReconciliationStatement',
    # 对话日志
    'ChatLog',
    # 分仓库存
    'Location',
    'LocationInventory',
    'InventoryTransfer',
    # 退货
    'ReturnOrder',
    # 预警设置
    'InventoryAlertSetting',
    # 金料管理
    'GoldMaterialTransaction',
    'CustomerGoldDeposit',
    'CustomerGoldDepositTransaction',
    'CustomerTransaction',
    # 客户取料和转料
    'CustomerWithdrawal',
    'CustomerTransfer',
    # 商品编码
    'ProductCode',
]
