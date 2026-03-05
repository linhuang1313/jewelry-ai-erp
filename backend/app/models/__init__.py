"""
数据库模型模块
包含所有 SQLAlchemy ORM 模型定义
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Numeric, UniqueConstraint
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
    status = Column(String(20), default="active", index=True)  # active/inactive
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
    status = Column(String(20), default="draft", index=True)
    is_audited = Column(Boolean, default=False, index=True)
    audited_by = Column(String(50), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


class InboundDetail(Base):
    """入库单明细表"""
    __tablename__ = "inbound_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("inbound_orders.id", ondelete="CASCADE"), index=True)
    product_code = Column(String(20), nullable=True, index=True)  # 标准商品编码（JPJZ, ZJ, F00000001等）
    standard_code = Column(String(20), nullable=True, index=True)  # 标准商品编码冗余（与 product_code 对齐，便于后续扩展）
    barcode = Column(String(50), nullable=True, index=True)  # 条码号（可自定义，支持业务条码）
    product_name = Column(String(200), nullable=False)
    product_category = Column(String(100))
    weight = Column(Numeric(12, 4), nullable=False)
    labor_cost = Column(Numeric(10, 2), nullable=False)  # 克工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数（可选）
    piece_labor_cost = Column(Numeric(10, 2), nullable=True)  # 件工费（元/件，可选）
    supplier = Column(String(100))  # 保留字符串字段（向后兼容）
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联供应商表
    total_cost = Column(Numeric(14, 2), nullable=False)  # 总成本 = 克工费 + 件工费
    fineness = Column(String(50), nullable=True)  # 成色（足金999、足金9999等）
    craft = Column(String(50), nullable=True)  # 工艺（3D硬金、古法、珐琅等）
    style = Column(String(50), nullable=True)  # 款式（吊坠、手镯、戒指等）
    
    # 镶嵌入库相关字段
    main_stone_weight = Column(Numeric(10, 4), nullable=True)  # 主石重
    main_stone_count = Column(Integer, nullable=True)  # 主石粒数
    main_stone_price = Column(Numeric(14, 2), nullable=True)  # 主石单价
    main_stone_amount = Column(Numeric(14, 2), nullable=True)  # 主石额
    sub_stone_weight = Column(Numeric(10, 4), nullable=True)  # 副石重
    sub_stone_count = Column(Integer, nullable=True)  # 副石粒数
    sub_stone_price = Column(Numeric(14, 2), nullable=True)  # 副石单价
    sub_stone_amount = Column(Numeric(14, 2), nullable=True)  # 副石额
    stone_setting_fee = Column(Numeric(14, 2), nullable=True)  # 镶石费
    total_amount = Column(Numeric(14, 2), nullable=True)  # 总金额
    main_stone_mark = Column(String(50), nullable=True)  # 主石字印
    sub_stone_mark = Column(String(50), nullable=True)  # 副石字印
    pearl_weight = Column(Numeric(12, 4), nullable=True)  # 珍珠重
    bearing_weight = Column(Numeric(12, 4), nullable=True)  # 轴承重
    sale_labor_cost = Column(Numeric(10, 2), nullable=True)  # 销售克工费
    sale_piece_labor_cost = Column(Numeric(10, 2), nullable=True)  # 销售件工费
    
    order = relationship("InboundOrder", backref="details")


class Inventory(Base):
    """库存表"""
    __tablename__ = "inventory"
    
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), unique=True, nullable=False, index=True)
    total_weight = Column(Numeric(12, 4), default=0.0)
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
    total_supply_amount = Column(Numeric(14, 2), default=0.0)  # 总供货金额（总工费）
    total_supply_weight = Column(Numeric(12, 4), default=0.0)  # 总供货重量
    total_supply_count = Column(Integer, default=0)  # 供货次数
    last_supply_time = Column(DateTime)  # 最后供货时间
    status = Column(String(20), default="active", index=True)
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
    total_purchase_amount = Column(Numeric(14, 2), default=0.0)  # 总工费金额（元）
    total_purchase_weight = Column(Numeric(12, 4), default=0.0)  # 总销售克重（克）
    total_purchase_count = Column(Integer, default=0)   # 购买次数
    last_purchase_time = Column(DateTime)
    status = Column(String(20), default="active", index=True)
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
    order_date = Column(DateTime, nullable=False, server_default=func.now(), index=True)  # 日期
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)  # 客户ID（可选，兼容直接输入姓名）
    customer_name = Column(String(100), nullable=False, index=True)  # 客户姓名（冗余字段，便于查询）
    salesperson = Column(String(50), nullable=False, index=True)  # 业务员姓名
    store_code = Column(String(50))  # 门店代码
    total_labor_cost = Column(Numeric(14, 2), default=0.0)  # 总工费
    total_weight = Column(Numeric(12, 4), default=0.0)  # 总克重
    remark = Column(Text)  # 备注信息
    status = Column(String(20), default="draft", index=True)  # draft/confirmed/cancelled
    create_time = Column(DateTime, server_default=func.now(), index=True)
    operator = Column(String(50), default="系统管理员")
    
    # 关系
    details = relationship("SalesDetail", backref="order", cascade="all, delete-orphan")


class SalesDetail(Base):
    """销售明细表"""
    __tablename__ = "sales_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_code = Column(String(50), nullable=True)  # 商品编码
    product_name = Column(String(200), nullable=False)  # 商品名称
    weight = Column(Numeric(12, 4), nullable=False)  # 克重
    labor_cost = Column(Numeric(10, 2), nullable=False)  # 工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数（可选）
    piece_labor_cost = Column(Numeric(10, 2), nullable=True)  # 件工费（元/件，可选）
    total_labor_cost = Column(Numeric(14, 2), nullable=False)  # 总工费 = (克重 * 克工费) + (件数 * 件工费)
    inventory_id = Column(Integer, ForeignKey("inventory.id", ondelete="SET NULL"), nullable=True)  # 关联库存（可选）


# ============= 结算单模型 =============

class SettlementOrder(Base):
    """结算单 - 确认销售单的原料支付方式并复核"""
    __tablename__ = "settlement_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, index=True, nullable=False)  # 结算单号
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)  # 关联销售单
    
    # 原料支付方式
    payment_method = Column(String(20), nullable=False)  # 'cash_price' 结价 / 'physical_gold' 结料 / 'mixed' 混合支付
    gold_price = Column(Numeric(14, 2), nullable=True)  # 当日金价（元/克），结价或混合支付时必填
    physical_gold_weight = Column(Numeric(12, 4), nullable=True)  # 客户需支付的黄金重量（克），结料或混合支付时使用
    
    # 混合支付专用字段
    gold_payment_weight = Column(Numeric(12, 4), nullable=True)  # 混合支付：结料部分的克重
    cash_payment_weight = Column(Numeric(12, 4), nullable=True)  # 混合支付：结价部分的克重
    
    # 金额计算
    total_weight = Column(Numeric(12, 4), nullable=False)  # 商品总克重
    material_amount = Column(Numeric(14, 2), nullable=True)  # 原料金额 = 金价 × 克重（结价支付时）
    labor_amount = Column(Numeric(14, 2), nullable=False)  # 工费金额
    total_amount = Column(Numeric(14, 2), nullable=False)  # 应收总额 = 原料金额 + 工费金额
    
    # 客户历史余额快照（创建结算单时记录）
    previous_cash_debt = Column(Numeric(14, 2), default=0.0)      # 上次现金欠款（元）
    previous_gold_debt = Column(Numeric(14, 2), default=0.0)      # 上次金料欠款（克）
    gold_deposit_balance = Column(Numeric(14, 2), default=0.0)    # 存料余额（克）
    cash_deposit_balance = Column(Numeric(14, 2), default=0.0)    # 存款余额（元）
    
    # 灵活支付状态
    payment_difference = Column(Numeric(14, 2), default=0.0)  # 支付差额（正=多付，负=少付）
    payment_status = Column(String(20), default="full")  # full全额 / overpaid多付 / underpaid少付
    
    # 状态和操作信息
    status = Column(String(20), default="draft", index=True)  # draft待结算 / confirmed已确认 / printed已打印
    created_by = Column(String(50))  # 创建人（柜台）
    confirmed_by = Column(String(50), nullable=True)  # 确认人（结算专员）
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    printed_at = Column(DateTime, nullable=True)  # 打印时间
    remark = Column(Text, nullable=True)  # 备注
    
    created_at = Column(DateTime, server_default=func.now(), index=True)
    
    # 关系
    sales_order = relationship("SalesOrder", backref="settlement")


# ============= 财务相关模型 =============
# 从 finance.py 导入
from .finance import (
    AccountReceivable, PaymentRecord, ReminderRecord, ReconciliationStatement, GoldReceipt,
    # 新增财务模块
    AccountPayable, SupplierPayment, BankAccount, CashFlow, ExpenseCategory, Expense,
    DEFAULT_EXPENSE_CATEGORIES,
    # 客料回仓单
    CustomerGoldTransfer,
    # 存料结价
    DepositSettlement
)
from .audit import AuditLog, BalanceChangeLog
from .action_card import ActionCard, Notification


# ============= 对话日志模型 =============

class ChatLog(Base):
    """对话日志表 - 记录用户与AI的对话，用于数据分析和知识库构建"""
    __tablename__ = "chat_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), index=True)  # 对话会话ID
    user_id = Column(String(100), nullable=True, index=True)  # 用户ID（预留：登录系统接入后填充）
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
    user_id = Column(String(100), nullable=True, index=True)  # 用户ID（预留：登录系统接入后填充）
    user_role = Column(String(20), nullable=True, index=True)  # 用户角色（预留：用于按角色查询）
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
    location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)  # 所在位置
    weight = Column(Numeric(12, 4), default=0.0)  # 库存重量
    last_update = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 唯一约束：同一位置同一商品只有一条记录
    __table_args__ = (
        UniqueConstraint('product_name', 'location_id', name='uq_location_product'),
    )


class InventoryTransfer(Base):
    """货品转移单 - 记录库存在不同位置间的转移"""
    __tablename__ = "inventory_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, index=True, nullable=False)  # 转移单号
    product_name = Column(String(200), nullable=False)  # 商品名称
    weight = Column(Numeric(12, 4), nullable=False)  # 转移重量
    from_location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)  # 发出位置
    to_location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)  # 目标位置
    status = Column(String(20), default="pending", index=True)  # 状态: pending(待接收), received(已接收), rejected(已拒收)
    
    # 发起信息
    created_by = Column(String(50))  # 发起人
    created_at = Column(DateTime, server_default=func.now())
    remark = Column(Text, nullable=True)  # 备注
    
    # 接收信息
    received_by = Column(String(50), nullable=True)  # 接收人
    received_at = Column(DateTime, nullable=True)  # 接收时间
    actual_weight = Column(Numeric(12, 4), nullable=True)  # 实际接收重量
    weight_diff = Column(Numeric(12, 4), nullable=True)  # 重量差异 (实际-预期)
    diff_reason = Column(Text, nullable=True)  # 差异原因
    
    # 关系
    from_location = relationship("Location", foreign_keys=[from_location_id])
    to_location = relationship("Location", foreign_keys=[to_location_id])


# ============= 转移单（新版：主表+明细表）=============

class InventoryTransferOrder(Base):
    """转移单主表 - 一个转移单可包含多个商品"""
    __tablename__ = "inventory_transfer_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, index=True, nullable=False)  # 转移单号
    from_location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)
    to_location_id = Column(Integer, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), default="pending", index=True)  # pending/received/rejected/pending_confirm
    
    # 发起信息
    created_by = Column(String(50))
    created_at = Column(DateTime, index=True)
    remark = Column(Text, nullable=True)
    
    # 接收信息
    received_by = Column(String(50), nullable=True)
    received_at = Column(DateTime, nullable=True)
    
    # 关联信息（重新发起时关联原单）
    source_order_id = Column(Integer, ForeignKey("inventory_transfer_orders.id"), nullable=True)  # 来源转移单ID
    
    # 关系
    from_location = relationship("Location", foreign_keys=[from_location_id])
    to_location = relationship("Location", foreign_keys=[to_location_id])
    items = relationship("InventoryTransferItem", back_populates="order", cascade="all, delete-orphan")
    source_order = relationship("InventoryTransferOrder", remote_side=[id], foreign_keys=[source_order_id])  # 来源转移单


class InventoryTransferItem(Base):
    """转移单明细表 - 单个商品的转移信息"""
    __tablename__ = "inventory_transfer_items"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("inventory_transfer_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name = Column(String(200), nullable=False)  # 商品名称
    product_code = Column(String(100), nullable=True)  # 商品编码
    weight = Column(Numeric(12, 4), nullable=False)  # 预期重量
    actual_weight = Column(Numeric(12, 4), nullable=True)  # 实际接收重量
    weight_diff = Column(Numeric(12, 4), nullable=True)  # 重量差异
    diff_reason = Column(Text, nullable=True)  # 差异原因
    
    # 关系
    order = relationship("InventoryTransferOrder", back_populates="items")


# ============= 库存预警设置模型 =============

class InventoryAlertSetting(Base):
    """库存预警设置表"""
    __tablename__ = "inventory_alert_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), unique=True, nullable=False, index=True)  # 商品名称
    min_weight = Column(Numeric(12, 4), default=50.0)  # 最低库存阈值（克）
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
    return_weight = Column(Numeric(12, 4), nullable=False)  # 退货克重
    
    # 来源位置（发起退货的位置）
    from_location_id = Column(Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 退给供应商时的供应商ID
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 关联原入库单（可选，便于追溯）
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 退货原因
    return_reason = Column(String(50), nullable=False)  # 原因分类: 质量问题/款式不符/数量差异/工艺瑕疵/其他
    reason_detail = Column(Text, nullable=True)  # 详细说明
    
    # 状态: draft未确认 / confirmed已确认 / cancelled已取消
    status = Column(String(20), default="draft", index=True)
    
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
    
    # 汇总字段（多商品支持）
    total_weight = Column(Numeric(12, 4), default=0.0)  # 总退货克重（汇总）
    total_labor_cost = Column(Numeric(14, 2), default=0.0)  # 总工费（汇总）
    item_count = Column(Integer, default=1)  # 商品数量
    
    # 财务审核字段（与入库单审核逻辑一致）
    is_audited = Column(Boolean, default=False, index=True)  # 是否已审核
    audited_by = Column(String(50), nullable=True)  # 审核人
    audited_at = Column(DateTime(timezone=True), nullable=True)  # 审核时间
    
    # 关系
    from_location = relationship("Location", foreign_keys=[from_location_id])
    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    inbound_order = relationship("InboundOrder", foreign_keys=[inbound_order_id])
    details = relationship("ReturnOrderDetail", back_populates="order", cascade="all, delete-orphan")


class ReturnOrderDetail(Base):
    """退货单明细表 - 支持一个退货单包含多个商品"""
    __tablename__ = "return_order_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("return_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 商品信息
    product_name = Column(String(200), nullable=False)  # 商品名称
    return_weight = Column(Numeric(12, 4), nullable=False)  # 退货克重
    
    # 工费信息
    labor_cost = Column(Numeric(10, 2), default=0.0)  # 克工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数
    piece_labor_cost = Column(Numeric(10, 2), nullable=True)  # 件工费（元/件）
    total_labor_cost = Column(Numeric(14, 2), default=0.0)  # 总工费 = 克工费*克重 + 件工费*件数
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    order = relationship("ReturnOrder", back_populates="details")


# ============= 金料管理模型 =============

class GoldMaterialTransaction(Base):
    """金料流转记录表 - 收料单（SL）和付料单（FL）"""
    __tablename__ = "gold_material_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    transaction_no = Column(String(50), unique=True, index=True, nullable=False)  # 流转单号（SL收料/FL付料）
    
    # 流转类型
    transaction_type = Column(String(20), nullable=False, index=True)  # 'income' 收入（收料）/ 'expense' 支出（付料）
    
    # 收入场景（从客户收料）
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联结算单
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)  # 客户ID
    customer_name = Column(String(100), nullable=True)  # 客户名称（冗余，便于查询）
    
    # 支出场景（支付供应商）
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联入库单
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)  # 供应商ID
    supplier_name = Column(String(100), nullable=True)  # 供应商名称（冗余）
    
    # 金料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 金料重量（克）
    
    # 状态和时间
    status = Column(String(20), default="pending", index=True)  # pending待确认 / confirmed已确认 / cancelled已取消
    created_by = Column(String(50))  # 创建人（结算专员创建收料单，料部创建付料单）
    confirmed_by = Column(String(50), nullable=True)  # 确认人（料部）
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    created_at = Column(DateTime, server_default=func.now(), index=True)  # 创建时间
    
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
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)  # 客户ID（唯一）
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 存料余额
    current_balance = Column(Numeric(14, 2), default=0.0)  # 当前存料余额（克）
    
    # 统计信息
    total_deposited = Column(Numeric(14, 2), default=0.0)  # 累计存入
    total_used = Column(Numeric(14, 2), default=0.0)  # 累计使用
    last_transaction_at = Column(DateTime, nullable=True)  # 最后交易时间
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # 关系
    customer = relationship("Customer", backref="gold_deposit")


class CustomerGoldDepositTransaction(Base):
    """客户存料交易记录表 - 记录存料的存入和使用"""
    __tablename__ = "customer_gold_deposit_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 交易类型
    transaction_type = Column(String(20), nullable=False, index=True)  # 'deposit' 存入 / 'use' 使用 / 'refund' 退还
    
    # 关联单据
    gold_transaction_id = Column(Integer, ForeignKey("gold_material_transactions.id", ondelete="SET NULL"), nullable=True, index=True)  # 收料单（存入时）
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 结算单（使用时）
    
    # 存料信息
    amount = Column(Numeric(14, 2), nullable=False)  # 本次交易金额（克）
    balance_before = Column(Numeric(14, 2), nullable=False)  # 交易前余额
    balance_after = Column(Numeric(14, 2), nullable=False)  # 交易后余额
    
    # 状态和时间
    status = Column(String(20), default="active", index=True)  # active有效 / cancelled已取消
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
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称（冗余）
    
    # 交易类型
    transaction_type = Column(String(20), nullable=False, index=True)  
    # 'sales' 销售 / 'settlement' 结算 / 'gold_receipt' 收料 / 'payment' 付款
    
    # 关联单据
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    settlement_order_id = Column(Integer, ForeignKey("settlement_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    gold_transaction_id = Column(Integer, ForeignKey("gold_material_transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 金额信息
    amount = Column(Numeric(14, 2), default=0.0)  # 金额（元）
    gold_weight = Column(Numeric(12, 4), default=0.0)  # 金料重量（克）
    
    # 欠款信息（金料）
    gold_due_before = Column(Numeric(14, 2), default=0.0)  # 本次交易前金料欠款
    gold_due_after = Column(Numeric(14, 2), default=0.0)  # 本次交易后金料欠款
    
    # 状态和时间
    status = Column(String(20), default="active", index=True)  # active有效 / cancelled已取消
    created_at = Column(DateTime, server_default=func.now(), index=True)
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
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)  # 客户名称
    
    # 取料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 取料克重
    
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
    from_customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    from_customer_name = Column(String(100), nullable=False)
    
    # 转入客户信息
    to_customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    to_customer_name = Column(String(100), nullable=False)
    
    # 转料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 转料克重
    
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


class ProductAttribute(Base):
    """商品属性配置表 - 管理成色、工艺、款式等下拉选项"""
    __tablename__ = "product_attributes"
    
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(50), nullable=False, index=True)  # fineness(成色)/craft(工艺)/style(款式)
    value = Column(String(100), nullable=False)  # 属性值
    sort_order = Column(Integer, default=0)  # 排序顺序
    is_active = Column(Boolean, default=True)  # 是否启用
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


# ============= 供应商金料账户模型 =============

class SupplierGoldAccount(Base):
    """供应商金料账户表 - 单一账户模式记录与供应商的金料往来
    
    current_balance 含义：
    - 正数 = 我们欠供应商的料（供应商发货了，我们还没付料）
    - 负数 = 供应商欠我们的料（我们付料了，供应商还没发货）
    - 零 = 已结清
    """
    __tablename__ = "supplier_gold_accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    supplier_name = Column(String(100), nullable=False)  # 供应商名称（冗余）
    
    # 金料账户余额（单一账户模式）
    current_balance = Column(Numeric(14, 2), default=0.0)  # 净金料值
    
    # 统计信息
    total_received = Column(Numeric(14, 2), default=0.0)  # 累计收货（供应商发货给我们的）
    total_paid = Column(Numeric(14, 2), default=0.0)  # 累计付料（我们付给供应商的）
    last_transaction_at = Column(DateTime, nullable=True)  # 最后交易时间
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # 关系
    supplier = relationship("Supplier", backref="gold_account")


class SupplierGoldTransaction(Base):
    """供应商金料交易记录表 - 记录与供应商的金料往来明细"""
    __tablename__ = "supplier_gold_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_name = Column(String(100), nullable=False)  # 供应商名称（冗余）
    
    # 交易类型
    transaction_type = Column(String(20), nullable=False, index=True)
    # 'receive' 收货（供应商发货，我们欠料增加）
    # 'pay' 付料（我们付料，我们欠料减少）
    
    # 关联单据
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 收货时关联入库单
    payment_transaction_id = Column(Integer, ForeignKey("gold_material_transactions.id", ondelete="SET NULL"), nullable=True, index=True)  # 付料时关联付料单
    
    # 金料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 本次交易金料克重
    balance_before = Column(Numeric(14, 2), nullable=False)  # 交易前余额
    balance_after = Column(Numeric(14, 2), nullable=False)  # 交易后余额
    
    # 状态和时间
    status = Column(String(20), default="active", index=True)  # active有效 / cancelled已取消
    created_at = Column(DateTime, server_default=func.now())
    created_by = Column(String(50))  # 操作人
    remark = Column(Text, nullable=True)  # 备注
    
    # 关系
    supplier = relationship("Supplier", backref="gold_transactions")
    inbound_order = relationship("InboundOrder", foreign_keys=[inbound_order_id])
    payment_transaction = relationship("GoldMaterialTransaction", foreign_keys=[payment_transaction_id])


# ============= 金料采购模型 =============

class GoldPurchaseOrder(Base):
    """金料采购单 - 从供应商采购金料的全流程管理（收料→结价→付款）"""
    __tablename__ = "gold_purchase_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, index=True, nullable=False)  # 采购单号（CG+时间戳）
    
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    supplier_name = Column(String(100), nullable=False)
    
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 收料金重（克）
    gold_fineness = Column(String(50), default="足金999")  # 成色
    conversion_rate = Column(Numeric(8, 4), default=1.0)  # 折算率
    settled_weight = Column(Numeric(12, 4), nullable=True)  # 结算重量（金重×折算率）
    
    gold_price = Column(Numeric(12, 2), nullable=True)  # 金价（元/克），结价时填
    total_amount = Column(Numeric(14, 2), nullable=True)  # 金额（结算重量×金价），结价时自动算
    paid_amount = Column(Numeric(14, 2), default=0)  # 已付金额（累加）
    
    # pending=待结价, priced=待付款, partial_paid=部分付款, paid=已结清, cancelled=已取消
    status = Column(String(20), default="pending", index=True)
    
    receive_date = Column(DateTime, nullable=True)  # 收料日期
    price_date = Column(DateTime, nullable=True)  # 结价日期
    
    created_by = Column(String(50))
    priced_by = Column(String(50), nullable=True)  # 结价人
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    update_time = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    remark = Column(Text, nullable=True)
    
    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    payments = relationship("GoldPurchasePayment", back_populates="purchase_order", cascade="all, delete-orphan")


class GoldPurchasePayment(Base):
    """金料采购付款记录"""
    __tablename__ = "gold_purchase_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("gold_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    
    payment_no = Column(String(50), unique=True, index=True, nullable=False)  # 付款单号（FK+时间戳）
    payment_amount = Column(Numeric(14, 2), nullable=False)  # 付款金额
    payment_method = Column(String(20), default="transfer")  # cash/transfer
    payment_date = Column(DateTime, nullable=True)  # 付款日期
    
    created_by = Column(String(50))
    create_time = Column(DateTime(timezone=True), server_default=func.now())
    remark = Column(Text, nullable=True)
    
    purchase_order = relationship("GoldPurchaseOrder", back_populates="payments")


# ============= 暂借单模型 =============

class LoanOrder(Base):
    """暂借单 - 记录产品临时借出情况（支持多商品）"""
    __tablename__ = "loan_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    loan_no = Column(String(50), unique=True, index=True, nullable=False)  # 暂借单号（ZJ+日期+序号）
    
    # 借出客户信息
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)  # 客户ID
    customer_name = Column(String(100), nullable=False)  # 客户姓名（冗余字段，便于查询）
    
    # 汇总字段
    total_weight = Column(Numeric(12, 4), default=0.0)  # 总克重（所有明细汇总）
    
    # 业务信息
    salesperson = Column(String(50), nullable=False)  # 业务员姓名
    loan_date = Column(DateTime, nullable=False)  # 暂借日期
    
    # 状态管理
    # pending待确认 / borrowed已借出 / partial_returned部分归还 / returned已归还 / cancelled已撤销
    status = Column(String(20), default="pending", index=True)
    
    # 操作人信息
    created_by = Column(String(50))  # 创建人（结算专员）
    created_at = Column(DateTime, server_default=func.now(), index=True)
    
    confirmed_at = Column(DateTime, nullable=True)  # 确认借出时间
    
    returned_at = Column(DateTime, nullable=True)  # 归还时间
    returned_by = Column(String(50), nullable=True)  # 归还确认人
    
    cancelled_at = Column(DateTime, nullable=True)  # 撤销时间
    cancelled_by = Column(String(50), nullable=True)  # 撤销人
    cancel_reason = Column(Text, nullable=True)  # 撤销原因（留痕）
    
    # 打印时间
    printed_at = Column(DateTime, nullable=True)
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    customer = relationship("Customer", backref="loan_orders")
    details = relationship("LoanDetail", backref="loan_order", cascade="all, delete-orphan")


class LoanDetail(Base):
    """暂借单明细 - 每行一个商品"""
    __tablename__ = "loan_details"
    
    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey("loan_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 产品信息
    product_name = Column(String(200), nullable=False)  # 产品品类
    weight = Column(Numeric(12, 4), nullable=False)  # 克重
    piece_count = Column(Integer, nullable=True)  # 件数（选填）
    
    # 状态管理（每行独立状态）
    # pending待确认 / borrowed已借出 / returned已归还
    status = Column(String(20), default="pending")
    returned_at = Column(DateTime, nullable=True)  # 归还时间
    returned_by = Column(String(50), nullable=True)  # 归还确认人


class LoanReturn(Base):
    """还货单 - 记录暂借商品的归还"""
    __tablename__ = "loan_returns"
    
    id = Column(Integer, primary_key=True, index=True)
    return_no = Column(String(50), unique=True, index=True, nullable=False)  # 还货单号（HH+日期+序号）
    loan_id = Column(Integer, ForeignKey("loan_orders.id"), nullable=False, index=True)  # 关联暂借单
    
    # 客户信息（冗余）
    customer_id = Column(Integer, nullable=False)
    customer_name = Column(String(100), nullable=False)
    
    # 汇总
    total_weight = Column(Numeric(12, 4), default=0.0)  # 本次归还总克重
    
    # 操作信息
    operator = Column(String(50))  # 操作人
    created_at = Column(DateTime, server_default=func.now(), index=True)
    remark = Column(Text, nullable=True)
    
    # 打印时间
    printed_at = Column(DateTime, nullable=True)
    
    # 关系
    details = relationship("LoanReturnDetail", backref="return_order", cascade="all, delete-orphan")
    loan_order = relationship("LoanOrder", backref="returns")


class LoanReturnDetail(Base):
    """还货单明细"""
    __tablename__ = "loan_return_details"
    
    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("loan_returns.id", ondelete="CASCADE"), nullable=False, index=True)
    loan_detail_id = Column(Integer, ForeignKey("loan_details.id"), nullable=False)  # 关联暂借明细
    
    # 产品信息（冗余）
    product_name = Column(String(200), nullable=False)
    weight = Column(Numeric(12, 4), nullable=False)


class LoanOrderLog(Base):
    """暂借单操作日志 - 留痕处理，记录所有状态变更"""
    __tablename__ = "loan_order_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    loan_order_id = Column(Integer, ForeignKey("loan_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 操作信息
    action = Column(String(50), nullable=False)  # create创建 / confirm确认借出 / return归还 / cancel撤销
    operator = Column(String(50), nullable=False)  # 操作人
    action_time = Column(DateTime, server_default=func.now())
    
    # 状态变更
    old_status = Column(String(20), nullable=True)  # 操作前状态
    new_status = Column(String(20), nullable=False)  # 操作后状态
    
    # 备注说明
    remark = Column(Text, nullable=True)
    
    # 关系
    loan_order = relationship("LoanOrder", backref="logs")


# ============= 单据操作日志 =============

class OrderStatusLog(Base):
    """单据状态变更日志 - 记录确认/反确认等操作"""
    __tablename__ = "order_status_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    order_type = Column(String(30), nullable=False, index=True)  # inbound/return/sales/settlement
    order_id = Column(Integer, nullable=False, index=True)
    action = Column(String(30), nullable=False)  # confirm/unconfirm
    old_status = Column(String(20))
    new_status = Column(String(20))
    operated_by = Column(String(50))
    operated_at = Column(DateTime, server_default=func.now())
    remark = Column(Text, nullable=True)


# ============= 销退模块 =============

class SalesReturnOrder(Base):
    """销退单 - 客户退货单据（镜像销售单）"""
    __tablename__ = "sales_return_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    return_no = Column(String(50), unique=True, index=True, nullable=False)  # 销退单号（XT+日期时间）
    order_date = Column(DateTime, nullable=False, server_default=func.now(), index=True)  # 销退日期
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)  # 客户ID
    customer_name = Column(String(100), nullable=False, index=True)  # 客户姓名
    salesperson = Column(String(50), nullable=True, index=True)  # 业务员姓名
    return_to = Column(String(20), nullable=False, default="showroom")  # 退回地点: showroom/warehouse
    return_reason = Column(String(50), nullable=False)  # 退货原因
    reason_detail = Column(Text, nullable=True)  # 详细说明
    total_weight = Column(Numeric(12, 4), default=0.0)  # 总克重
    total_labor_cost = Column(Numeric(14, 2), default=0.0)  # 总工费
    remark = Column(Text, nullable=True)  # 备注
    status = Column(String(20), default="draft", index=True)  # draft/confirmed/待结算/已结算
    create_time = Column(DateTime, server_default=func.now(), index=True)
    created_by = Column(String(50))  # 创建人
    operator = Column(String(50), default="系统管理员")
    
    # 关系
    customer = relationship("Customer", foreign_keys=[customer_id])
    details = relationship("SalesReturnDetail", backref="order", cascade="all, delete-orphan")


class SalesReturnDetail(Base):
    """销退明细表"""
    __tablename__ = "sales_return_details"
    
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_return_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_code = Column(String(50), nullable=True)  # 商品编码
    product_name = Column(String(200), nullable=False)  # 商品名称
    weight = Column(Numeric(12, 4), nullable=False)  # 克重
    labor_cost = Column(Numeric(10, 2), nullable=False)  # 工费（元/克）
    piece_count = Column(Integer, nullable=True)  # 件数（可选）
    piece_labor_cost = Column(Numeric(10, 2), nullable=True)  # 件工费（元/件，可选）
    total_labor_cost = Column(Numeric(14, 2), nullable=False)  # 总工费 = (克重 * 克工费) + (件数 * 件工费)


class SalesReturnSettlement(Base):
    """销退结算单 - 确认销退的退款方式（镜像结算单）"""
    __tablename__ = "sales_return_settlements"
    
    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, index=True, nullable=False)  # 销退结算单号（XTJS+日期+序号）
    sales_return_order_id = Column(Integer, ForeignKey("sales_return_orders.id", ondelete="CASCADE"), nullable=False, index=True)  # 关联销退单
    
    # 退款方式（镜像结算单）
    payment_method = Column(String(20), nullable=False)  # 'cash_price' 退价 / 'physical_gold' 退料 / 'mixed' 混合退款
    gold_price = Column(Numeric(14, 2), nullable=True)  # 当日金价（元/克）
    physical_gold_weight = Column(Numeric(12, 4), nullable=True)  # 退还金料重量（克）
    
    # 混合退款专用字段
    gold_payment_weight = Column(Numeric(12, 4), nullable=True)  # 混合退款：退料部分的克重
    cash_payment_weight = Column(Numeric(12, 4), nullable=True)  # 混合退款：退价部分的克重
    
    # 金额计算
    total_weight = Column(Numeric(12, 4), nullable=False)  # 商品总克重
    material_amount = Column(Numeric(14, 2), nullable=True)  # 原料金额 = 金价 × 克重
    labor_amount = Column(Numeric(14, 2), nullable=False)  # 工费金额
    total_amount = Column(Numeric(14, 2), nullable=False)  # 退款总额 = 原料金额 + 工费金额
    
    # 状态和操作信息
    status = Column(String(20), default="draft", index=True)  # draft待确认 / confirmed已确认 / printed已打印
    created_by = Column(String(50))  # 创建人
    confirmed_by = Column(String(50), nullable=True)  # 确认人
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    printed_at = Column(DateTime, nullable=True)  # 打印时间
    remark = Column(Text, nullable=True)  # 备注
    
    created_at = Column(DateTime, server_default=func.now(), index=True)
    
    # 关系
    sales_return_order = relationship("SalesReturnOrder", backref="settlement")


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
    # 财务增强模块
    'AccountPayable',
    'SupplierPayment',
    'BankAccount',
    'CashFlow',
    'ExpenseCategory',
    'Expense',
    'DEFAULT_EXPENSE_CATEGORIES',
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
    # 商品属性配置
    'ProductAttribute',
    # 供应商金料账户
    'SupplierGoldAccount',
    'SupplierGoldTransaction',
    # 暂借单
    'LoanOrder',
    'LoanDetail',
    'LoanOrderLog',
    # 还货单
    'LoanReturn',
    'LoanReturnDetail',
    # 审计日志
    'AuditLog',
    'BalanceChangeLog',
    # 单据操作日志
    'OrderStatusLog',
    # 销退模块
    'SalesReturnOrder',
    'SalesReturnDetail',
    'SalesReturnSettlement',
    # 客料回仓单
    'CustomerGoldTransfer',
    # 存料结价
    'DepositSettlement',
    # 协同卡片
    'ActionCard',
    'Notification',
]
