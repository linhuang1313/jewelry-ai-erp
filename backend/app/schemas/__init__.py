"""
Schema模块
包含所有 Pydantic 模型定义
"""

from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List, Union


# ============= AI 相关 Schema =============

class AIRequest(BaseModel):
    """AI 请求"""
    message: str
    user_role: Optional[str] = "sales"  # 用户角色: sales/finance/product/manager
    session_id: Optional[str] = None  # 对话会话ID


class ProductItem(BaseModel):
    """单个商品项"""
    product_name: str
    weight: float
    labor_cost: float  # 每克工费
    supplier: Optional[str] = None


class AIResponse(BaseModel):
    """AI 响应"""
    action: str
    products: Optional[List[ProductItem]] = None  # 多个商品列表（用于入库）
    # 保留向后兼容的单个商品字段
    product_name: Optional[str] = None
    weight: Optional[float] = None
    labor_cost: Optional[float] = None
    supplier: Optional[str] = None
    # 客户相关字段
    customer_name: Optional[str] = None
    customer_id: Optional[int] = None
    phone: Optional[str] = None
    wechat: Optional[str] = None
    address: Optional[str] = None
    customer_type: Optional[str] = None
    # 供应商相关字段
    supplier_name: Optional[str] = None
    supplier_id: Optional[int] = None
    contact_person: Optional[str] = None
    supplier_type: Optional[str] = None
    # 销售单相关字段
    salesperson: Optional[str] = None
    store_code: Optional[str] = None
    order_date: Optional[str] = None
    items: Optional[List[dict]] = None  # 销售单商品明细（字典格式，包含product_name, weight, labor_cost）
    remark: Optional[str] = None
    # 查询相关字段
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    order_no: Optional[str] = None  # 入库单号（用于查询入库单）


# ============= 入库相关 Schema =============

class InboundOrderCreate(BaseModel):
    """创建入库单请求"""
    product_name: str
    product_category: Optional[str] = None
    weight: float
    labor_cost: float
    supplier: Optional[str] = None


class InboundOrderResponse(BaseModel):
    """入库单响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    order_no: str
    create_time: datetime
    operator: str
    status: str


class InboundDetailResponse(BaseModel):
    """入库明细响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    product_name: str
    product_category: Optional[str]
    weight: float
    labor_cost: float
    supplier: Optional[str]
    total_cost: float


class InventoryResponse(BaseModel):
    """库存响应"""
    model_config = ConfigDict(from_attributes=True)
    
    product_name: str
    total_weight: float
    last_update: datetime
    avg_labor_cost: Optional[float] = None  # 平均工费（元/克）
    latest_labor_cost: Optional[float] = None  # 最新工费（元/克）


class InboundSuccessResponse(BaseModel):
    """入库成功响应"""
    success: bool
    message: str
    order: InboundOrderResponse
    detail: InboundDetailResponse
    inventory: InventoryResponse


# ============= 供应商相关 Schema =============

class SupplierCreate(BaseModel):
    """创建供应商请求"""
    name: str
    phone: Optional[str] = None
    wechat: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    supplier_type: Optional[str] = "个人"
    remark: Optional[str] = None


class SupplierResponse(BaseModel):
    """供应商响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    supplier_no: str
    name: str
    phone: Optional[str]
    wechat: Optional[str]
    address: Optional[str]
    contact_person: Optional[str]
    supplier_type: str
    total_supply_amount: float
    total_supply_weight: float
    total_supply_count: int
    last_supply_time: Optional[datetime]
    status: str
    create_time: datetime
    remark: Optional[str]


# ============= 客户相关 Schema =============

class CustomerCreate(BaseModel):
    """创建客户请求"""
    name: str
    phone: Optional[str] = None
    wechat: Optional[str] = None
    address: Optional[str] = None
    customer_type: Optional[str] = "个人"
    remark: Optional[str] = None


class CustomerResponse(BaseModel):
    """客户响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_no: str
    name: str
    phone: Optional[str]
    wechat: Optional[str]
    address: Optional[str]
    customer_type: str
    total_purchase_amount: float
    total_purchase_count: int
    last_purchase_time: Optional[datetime]
    status: str
    create_time: datetime


# ============= 销售相关 Schema =============

class SalesDetailItem(BaseModel):
    """销售明细项（用于创建）"""
    product_name: str
    weight: float  # 克重
    labor_cost: float  # 工费（元/克）


class SalesOrderCreate(BaseModel):
    """创建销售单请求"""
    order_date: Optional[datetime] = None  # 日期，不传则使用当前时间
    customer_name: str  # 客户姓名
    customer_id: Optional[int] = None  # 客户ID（可选，如果客户已存在）
    salesperson: str  # 业务员姓名
    store_code: Optional[str] = None  # 门店代码
    remark: Optional[str] = None  # 备注信息
    items: List[SalesDetailItem]  # 商品明细列表


class SalesDetailResponse(BaseModel):
    """销售明细响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_name: str
    weight: float
    labor_cost: float
    total_labor_cost: float


class SalesOrderResponse(BaseModel):
    """销售单响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_no: str
    order_date: datetime
    customer_name: str
    salesperson: str
    store_code: Optional[str]
    total_labor_cost: float
    total_weight: float
    remark: Optional[str]
    status: str
    create_time: datetime
    operator: str
    details: List[SalesDetailResponse] = []


# ============= 分仓库存相关 Schema =============

class LocationCreate(BaseModel):
    """创建仓库/位置"""
    code: str  # 位置代码
    name: str  # 位置名称
    location_type: str  # 类型: warehouse/showroom/transit
    description: Optional[str] = None


class LocationResponse(BaseModel):
    """仓库/位置响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    location_type: str
    description: Optional[str]
    is_active: int
    created_at: datetime


class LocationInventoryResponse(BaseModel):
    """分仓库存响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_name: str
    location_id: int
    location_name: Optional[str] = None  # 位置名称（额外字段）
    location_code: Optional[str] = None  # 位置代码（额外字段）
    weight: float
    last_update: datetime


class LocationInventorySummary(BaseModel):
    """分仓库存汇总"""
    product_name: str
    total_weight: float  # 总库存
    locations: List[LocationInventoryResponse]  # 各位置库存


class InventoryTransferCreate(BaseModel):
    """创建货品转移单"""
    product_name: str
    weight: float
    from_location_id: int
    to_location_id: int
    remark: Optional[str] = None


class InventoryTransferReceive(BaseModel):
    """接收货品转移"""
    actual_weight: float  # 实际接收重量
    diff_reason: Optional[str] = None  # 差异原因（如有）


class InventoryTransferResponse(BaseModel):
    """货品转移单响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    transfer_no: str
    product_name: str
    weight: float
    from_location_id: int
    to_location_id: int
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None
    status: str
    created_by: Optional[str]
    created_at: datetime
    remark: Optional[str]
    received_by: Optional[str]
    received_at: Optional[datetime]
    actual_weight: Optional[float]
    weight_diff: Optional[float]
    diff_reason: Optional[str]


# ============= 财务相关 Schema =============
# 从 finance.py 导入
from .finance import (
    AccountReceivableStatus,
    PaymentMethod,
    ReminderMethod,
    ReminderStatus,
    ReconciliationStatus,
    CustomerReference,
    SalesOrderReference,
    AccountReceivableCreate,
    AccountReceivableResponse,
    PaymentRecordCreate,
    PaymentRecordResponse,
    ReminderRecordCreate,
    ReminderRecordResponse,
    ReconciliationSalesDetail,
    ReconciliationPaymentDetail,
    ReconciliationStatementCreate,
    ReconciliationStatementResponse,
    FinanceStatistics,
    ApiResponse,
    ReceivableListResponse,
    StatisticsResponse,
)


# 导出所有 Schema
__all__ = [
    # AI
    'AIRequest',
    'ProductItem',
    'AIResponse',
    # 入库
    'InboundOrderCreate',
    'InboundOrderResponse',
    'InboundDetailResponse',
    'InventoryResponse',
    'InboundSuccessResponse',
    # 供应商
    'SupplierCreate',
    'SupplierResponse',
    # 客户
    'CustomerCreate',
    'CustomerResponse',
    # 销售
    'SalesDetailItem',
    'SalesOrderCreate',
    'SalesDetailResponse',
    'SalesOrderResponse',
    # 财务
    'AccountReceivableStatus',
    'PaymentMethod',
    'ReminderMethod',
    'ReminderStatus',
    'ReconciliationStatus',
    'CustomerReference',
    'SalesOrderReference',
    'AccountReceivableCreate',
    'AccountReceivableResponse',
    'PaymentRecordCreate',
    'PaymentRecordResponse',
    'ReminderRecordCreate',
    'ReminderRecordResponse',
    'ReconciliationSalesDetail',
    'ReconciliationPaymentDetail',
    'ReconciliationStatementCreate',
    'ReconciliationStatementResponse',
    'FinanceStatistics',
    'ApiResponse',
    'ReceivableListResponse',
    'StatisticsResponse',
    # 分仓库存
    'LocationCreate',
    'LocationResponse',
    'LocationInventoryResponse',
    'LocationInventorySummary',
    'InventoryTransferCreate',
    'InventoryTransferReceive',
    'InventoryTransferResponse',
]
