"""
数据库模型模块
包含所有 SQLAlchemy ORM 模型定义
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


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
    product_name = Column(String(200), nullable=False)
    product_category = Column(String(100))
    weight = Column(Float, nullable=False)
    labor_cost = Column(Float, nullable=False)
    supplier = Column(String(100))  # 保留字符串字段（向后兼容）
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)  # 关联供应商表
    total_cost = Column(Float, nullable=False)  # 总成本 = 工费（暂时简化）
    
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
    total_labor_cost = Column(Float, nullable=False)  # 总工费 = 工费 * 克重
    inventory_id = Column(Integer, ForeignKey("inventory.id"), nullable=True)  # 关联库存（可选）


# ============= 结算单模型 =============

class SettlementOrder(Base):
    """结算单 - 确认销售单的原料支付方式并复核"""
    __tablename__ = "settlement_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, index=True, nullable=False)  # 结算单号
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)  # 关联销售单
    
    # 原料支付方式
    payment_method = Column(String(20), nullable=False)  # 'cash_price' 结价支付 / 'physical_gold' 实物抵扣
    gold_price = Column(Float, nullable=True)  # 当日金价（元/克），结价支付时必填
    physical_gold_weight = Column(Float, nullable=True)  # 客户提供的黄金重量（克），实物抵扣时必填
    
    # 金额计算
    total_weight = Column(Float, nullable=False)  # 商品总克重
    material_amount = Column(Float, nullable=True)  # 原料金额 = 金价 × 克重（结价支付时）
    labor_amount = Column(Float, nullable=False)  # 工费金额
    total_amount = Column(Float, nullable=False)  # 应收总额 = 原料金额 + 工费金额
    
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
]
