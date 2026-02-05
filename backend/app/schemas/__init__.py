"""
Schema模块
包含所有 Pydantic 模型定义
"""

from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List, Union


# ============= 业务员 Schema =============

class SalespersonCreate(BaseModel):
    """创建业务员请求"""
    name: str
    phone: Optional[str] = None
    remark: Optional[str] = None


class SalespersonResponse(BaseModel):
    """业务员响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    phone: Optional[str] = None
    status: str
    create_time: datetime
    remark: Optional[str] = None


# ============= AI 相关 Schema =============

class AIRequest(BaseModel):
    """AI 请求"""
    message: str
    user_role: Optional[str] = "sales"  # 用户角色: sales/finance/product/manager
    session_id: Optional[str] = None  # 对话会话ID
    language: Optional[str] = "zh"  # 语言: zh/en


class ProductItem(BaseModel):
    """单个商品项"""
    product_code: Optional[str] = None  # 商品编码（JPJZ, F00000001等）
    product_name: str
    weight: float
    labor_cost: float  # 克工费（元/克）
    piece_count: Optional[int] = None  # 件数（可选）
    piece_labor_cost: Optional[float] = None  # 件工费（元/件，可选）
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
    order_no: Optional[str] = None  # 入库单号（用于查询入库单，RK开头）
    sales_order_no: Optional[str] = None  # 销售单号（用于查询销售单，XS开头）
    # 库存转移相关字段
    transfer_product_name: Optional[str] = None  # 要转移的商品名称
    transfer_weight: Optional[float] = None  # 要转移的重量（克）
    from_location: Optional[str] = None  # 发出位置（默认：商品部仓库）
    to_location: Optional[str] = None  # 目标位置（如：展厅）
    # 客户账务查询相关字段
    debt_customer_name: Optional[str] = None  # 要查询账务的客户名称
    debt_query_type: Optional[str] = None  # 查询类型：all/cash_debt/gold_debt/gold_deposit
    date_start: Optional[str] = None  # 开始日期（YYYY-MM-DD）
    date_end: Optional[str] = None  # 结束日期（YYYY-MM-DD）
    # 收款登记相关字段
    payment_customer_name: Optional[str] = None  # 收款客户名称
    payment_amount: Optional[float] = None  # 收款金额（元）
    payment_method: Optional[str] = None  # 收款方式：转账/现金/微信/支付宝/刷卡
    payment_remark: Optional[str] = None  # 备注
    # 销售数据查询相关字段
    sales_query_type: Optional[str] = None  # 查询类型：today/month/compare/top_products/salesperson/summary
    sales_query_days: Optional[int] = None  # 查询天数
    sales_query_salesperson: Optional[str] = None  # 查询特定业务员

    # 收料相关字段
    receipt_customer_name: Optional[str] = None  # 交料客户名称
    receipt_gold_weight: Optional[float] = None  # 交料克重
    receipt_gold_fineness: Optional[str] = None  # 成色，默认足金999
    receipt_remark: Optional[str] = None  # 备注
    # 入库单查询筛选字段
    inbound_supplier: Optional[str] = None  # 按供应商筛选入库单
    inbound_product: Optional[str] = None  # 按商品名称筛选入库单
    inbound_date_start: Optional[str] = None  # 入库单开始日期
    inbound_date_end: Optional[str] = None  # 入库单结束日期
    # 付料相关字段
    gold_payment_supplier: Optional[str] = None  # 付料供应商名称
    gold_payment_weight: Optional[float] = None  # 付料克重
    gold_payment_remark: Optional[str] = None  # 付料备注
    # 批量转移相关字段
    batch_transfer_order_no: Optional[str] = None  # 批量转移的入库单号
    batch_transfer_to_location: Optional[str] = None  # 批量转移目标位置
    # 提料相关字段
    withdrawal_customer_name: Optional[str] = None  # 提料客户名称
    withdrawal_gold_weight: Optional[float] = None  # 提料克重
    withdrawal_remark: Optional[str] = None  # 提料备注
    # 供应商付款相关字段
    supplier_payment_name: Optional[str] = None  # 付款供应商名称
    supplier_payment_amount: Optional[float] = None  # 付款金额（元）
    supplier_payment_method: Optional[str] = None  # 付款方式：转账/现金/支票/承兑
    supplier_payment_remark: Optional[str] = None  # 付款备注
    # 转移单/调拨单查询相关字段
    transfer_order_no: Optional[str] = None  # 转移单号（TR开头）
    transfer_status: Optional[str] = None  # 转移单状态筛选
    transfer_date_start: Optional[str] = None  # 转移单开始日期
    transfer_date_end: Optional[str] = None  # 转移单结束日期


# ============= 入库相关 Schema =============

class InboundOrderCreate(BaseModel):
    """创建入库单请求"""
    product_code: Optional[str] = None  # 商品编码（JPJZ, F00000001等）
    product_name: str
    product_category: Optional[str] = None
    weight: float
    labor_cost: float  # 克工费（元/克）
    piece_count: Optional[int] = None  # 件数（可选）
    piece_labor_cost: Optional[float] = None  # 件工费（元/件，可选）
    supplier: Optional[str] = None


class BatchInboundItem(BaseModel):
    """批量入库单个商品项"""
    product_code: Optional[str] = None  # 商品编码
    product_name: str
    weight: float
    labor_cost: float  # 克工费（元/克）
    piece_count: Optional[int] = None  # 件数（可选）
    piece_labor_cost: Optional[float] = None  # 件工费（元/件，可选）
    # 镶嵌入库相关字段
    main_stone_weight: Optional[float] = None  # 主石重
    main_stone_count: Optional[int] = None  # 主石粒数
    main_stone_price: Optional[float] = None  # 主石单价
    main_stone_amount: Optional[float] = None  # 主石额
    sub_stone_weight: Optional[float] = None  # 副石重
    sub_stone_count: Optional[int] = None  # 副石粒数
    sub_stone_price: Optional[float] = None  # 副石单价
    sub_stone_amount: Optional[float] = None  # 副石额
    stone_setting_fee: Optional[float] = None  # 镶石费
    total_amount: Optional[float] = None  # 总金额
    main_stone_mark: Optional[str] = None  # 主石字印
    sub_stone_mark: Optional[str] = None  # 副石字印
    pearl_weight: Optional[float] = None  # 珍珠重
    bearing_weight: Optional[float] = None  # 轴承重
    sale_labor_cost: Optional[float] = None  # 销售克工费
    sale_piece_labor_cost: Optional[float] = None  # 销售件工费


class BatchInboundCreate(BaseModel):
    """批量入库请求"""
    supplier: str  # 供应商名称（所有商品共用）
    items: List[BatchInboundItem]  # 商品列表
    operator: Optional[str] = None  # 操作员（可选）


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
    labor_cost: float  # 克工费（元/克）
    piece_count: Optional[int] = None  # 件数
    piece_labor_cost: Optional[float] = None  # 件工费（元/件）
    supplier: Optional[str]
    total_cost: float  # 总工费 = 克工费 + 件工费


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
    piece_count: Optional[int] = None  # 件数（可选）
    piece_labor_cost: Optional[float] = None  # 件工费（元/件，可选）


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
    piece_count: Optional[int] = None  # 件数（可选）
    piece_labor_cost: Optional[float] = None  # 件工费（元/件，可选）
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


# ============= 结算单相关 Schema =============

class SettlementOrderCreate(BaseModel):
    """创建结算单"""
    sales_order_id: int  # 关联的销售单ID
    payment_method: str  # 'cash_price' 结价 / 'physical_gold' 结料 / 'mixed' 混合支付
    gold_price: Optional[float] = None  # 当日金价（结价或混合支付时必填）
    physical_gold_weight: Optional[float] = None  # 结料支付：客户提供的黄金重量
    use_deposit: Optional[float] = None  # 使用存料抵扣的重量（克，结料时可选）
    # 混合支付专用参数
    gold_payment_weight: Optional[float] = None  # 混合支付：结料部分的克重
    cash_payment_weight: Optional[float] = None  # 混合支付：结价部分的克重
    remark: Optional[str] = None
    # 灵活支付参数
    confirmed_underpay: bool = False  # 是否已确认少付（前端弹窗确认后设为True）


class SettlementOrderConfirm(BaseModel):
    """确认结算单"""
    confirmed_by: str  # 确认人


class SettlementOrderUpdate(BaseModel):
    """修改结算单（仅待确认状态可修改）"""
    payment_method: Optional[str] = None  # 'cash_price' 结价 / 'physical_gold' 结料 / 'mixed' 混合支付
    gold_price: Optional[float] = None  # 当日金价
    physical_gold_weight: Optional[float] = None  # 结料支付：客户提供的黄金重量
    # 混合支付专用参数
    gold_payment_weight: Optional[float] = None  # 混合支付：结料部分的克重
    cash_payment_weight: Optional[float] = None  # 混合支付：结价部分的克重
    remark: Optional[str] = None


class SettlementOrderResponse(BaseModel):
    """结算单响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    settlement_no: str
    sales_order_id: int
    payment_method: str
    gold_price: Optional[float]
    physical_gold_weight: Optional[float]
    total_weight: float
    material_amount: Optional[float]
    labor_amount: float
    total_amount: float
    # 混合支付专用字段
    gold_payment_weight: Optional[float] = None  # 混合支付：结料部分的克重
    cash_payment_weight: Optional[float] = None  # 混合支付：结价部分的克重
    # 客户历史余额信息
    previous_cash_debt: Optional[float] = 0.0  # 上次现金欠款（元）
    previous_gold_debt: Optional[float] = 0.0  # 上次金料欠款（克）
    gold_deposit_balance: Optional[float] = 0.0  # 存料余额（克）
    cash_deposit_balance: Optional[float] = 0.0  # 存款余额（元）
    # 灵活支付状态
    payment_difference: Optional[float] = 0.0  # 支付差额（正=多付，负=少付）
    payment_status: Optional[str] = 'full'  # 支付状态: full/overpaid/underpaid
    status: str
    created_by: Optional[str]
    confirmed_by: Optional[str]
    confirmed_at: Optional[datetime]
    printed_at: Optional[datetime]
    remark: Optional[str]
    created_at: datetime
    # 关联的销售单信息
    sales_order: Optional[SalesOrderResponse] = None
    # 金料收取信息（仅结料或混合支付时有值）
    gold_received: Optional[float] = None  # 已收金料总重量
    gold_remaining_due: Optional[float] = None  # 剩余欠款金料
    deposit_used: Optional[float] = None  # 使用存料抵扣的重量


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
    pinyin_initials: Optional[str] = None  # 拼音首字母，用于搜索
    location_id: int
    location_name: Optional[str] = None  # 位置名称（额外字段）
    location_code: Optional[str] = None  # 位置代码（额外字段）
    weight: float
    last_update: datetime


class LocationInventorySummary(BaseModel):
    """分仓库存汇总"""
    product_name: str
    total_weight: float  # 总库存
    quantity: int = 0  # 库存数量（件数）
    total_amount: float = 0.0  # 库存金额（含工费）
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


# ============= 转移单（新版：主表+明细）Schema =============

class TransferItemCreate(BaseModel):
    """创建转移单明细项"""
    product_name: str
    weight: float


class TransferOrderCreate(BaseModel):
    """创建转移单（支持多商品）"""
    from_location_id: int
    to_location_id: int
    items: List[TransferItemCreate]
    remark: Optional[str] = None


class TransferItemReceive(BaseModel):
    """接收单个商品"""
    item_id: int
    actual_weight: float
    diff_reason: Optional[str] = None


class TransferOrderReceive(BaseModel):
    """整单接收"""
    items: List[TransferItemReceive]


class TransferOrderActualUpdate(BaseModel):
    """更新待确认转移单实际重量"""
    items: List[TransferItemReceive]


class TransferItemResponse(BaseModel):
    """转移单明细响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_name: str
    weight: float
    actual_weight: Optional[float] = None
    weight_diff: Optional[float] = None
    diff_reason: Optional[str] = None


class TransferOrderResponse(BaseModel):
    """转移单响应（包含明细）"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    transfer_no: str
    from_location_id: int
    to_location_id: int
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None
    status: str
    created_by: Optional[str] = None
    created_at: datetime
    remark: Optional[str] = None
    received_by: Optional[str] = None
    received_at: Optional[datetime] = None
    items: List[TransferItemResponse] = []
    total_weight: Optional[float] = None  # 总预期重量
    total_actual_weight: Optional[float] = None  # 总实际重量
    # 关联信息
    source_order_id: Optional[int] = None  # 来源转移单ID（重新发起时的原单）
    source_transfer_no: Optional[str] = None  # 来源转移单号
    related_order_id: Optional[int] = None  # 关联的新转移单ID（被重新发起后产生的）
    related_transfer_no: Optional[str] = None  # 关联的新转移单号


# ============= 退货单相关 Schema =============

class ReturnItemCreate(BaseModel):
    """退货商品明细"""
    product_name: str  # 商品名称
    return_weight: float  # 退货克重
    labor_cost: float = 0.0  # 克工费（元/克）
    piece_count: Optional[int] = None  # 件数
    piece_labor_cost: Optional[float] = None  # 件工费（元/件）
    remark: Optional[str] = None  # 备注


class ReturnItemResponse(BaseModel):
    """退货商品明细响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_name: str
    return_weight: float
    labor_cost: float
    piece_count: Optional[int]
    piece_labor_cost: Optional[float]
    total_labor_cost: float
    remark: Optional[str]


class ReturnOrderCreate(BaseModel):
    """创建退货单（支持多商品）"""
    return_type: str  # to_supplier(退给供应商) / to_warehouse(退给商品部)
    items: List[ReturnItemCreate]  # 商品明细列表
    from_location_id: Optional[int] = None  # 发起位置ID
    supplier_id: Optional[int] = None  # 供应商ID（退给供应商时必填）
    inbound_order_id: Optional[int] = None  # 关联入库单ID（可选）
    return_reason: str  # 退货原因: 质量问题/款式不符/数量差异/工艺瑕疵/其他
    reason_detail: Optional[str] = None  # 详细说明
    images: Optional[List[str]] = None  # 退货图片URL列表
    remark: Optional[str] = None  # 备注


class ReturnOrderApprove(BaseModel):
    """审批退货单"""
    approved_by: str  # 审批人


class ReturnOrderReject(BaseModel):
    """驳回退货单"""
    rejected_by: str  # 驳回人
    reject_reason: str  # 驳回原因


class ReturnOrderComplete(BaseModel):
    """完成退货"""
    completed_by: str  # 完成操作人


class ReturnOrderResponse(BaseModel):
    """退货单响应（支持多商品）"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    return_no: str
    return_type: str
    # 保留旧字段兼容（单商品时使用）
    product_name: Optional[str] = None
    return_weight: Optional[float] = None
    # 新增汇总字段
    total_weight: float = 0.0
    total_labor_cost: float = 0.0
    item_count: int = 1
    # 明细列表
    items: List[ReturnItemResponse] = []
    # 位置和供应商
    from_location_id: Optional[int]
    from_location_name: Optional[str] = None
    supplier_id: Optional[int]
    supplier_name: Optional[str] = None
    inbound_order_id: Optional[int]
    inbound_order_no: Optional[str] = None
    return_reason: str
    reason_detail: Optional[str]
    status: str
    created_by: Optional[str]
    created_at: datetime
    approved_by: Optional[str]
    approved_at: Optional[datetime]
    reject_reason: Optional[str]
    completed_by: Optional[str]
    completed_at: Optional[datetime]
    images: Optional[str]  # JSON字符串
    remark: Optional[str]


# ============= 金料管理相关 Schema =============

class GoldReceiptCreate(BaseModel):
    """创建收料单（结算专员收到客户原料后创建）"""
    settlement_order_id: int  # 关联的结算单ID
    gold_weight: float  # 实际收到的金料重量（克）
    remark: Optional[str] = None  # 备注


class GoldReceiptUpdate(BaseModel):
    """修改收料单"""
    gold_weight: Optional[float] = None  # 修改金料重量
    remark: Optional[str] = None  # 修改备注


class GoldPaymentCreate(BaseModel):
    """创建付料单（料部支付供应商）"""
    supplier_id: int  # 供应商ID
    inbound_order_id: Optional[int] = None  # 关联的入库单ID（可选）
    gold_weight: float  # 支付的金料重量（克）
    remark: Optional[str] = None  # 备注


class GoldMaterialTransactionConfirm(BaseModel):
    """确认金料流转记录（料部确认收到原料）"""
    confirmed_by: str  # 确认人


class GoldMaterialTransactionResponse(BaseModel):
    """金料流转记录响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    transaction_no: str  # 流转单号
    transaction_type: str  # 'income' 收入 / 'expense' 支出
    
    # 收入场景
    settlement_order_id: Optional[int] = None
    settlement_no: Optional[str] = None  # 结算单号（额外字段）
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    
    # 支出场景
    inbound_order_id: Optional[int] = None
    inbound_order_no: Optional[str] = None  # 入库单号（额外字段）
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    
    # 金料信息
    gold_weight: float  # 金料重量（克）
    
    # 状态和时间
    status: str  # pending待确认 / confirmed已确认 / cancelled已取消
    created_by: Optional[str] = None
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    created_at: datetime
    
    # 单据打印时间
    receipt_printed_at: Optional[datetime] = None
    payment_printed_at: Optional[datetime] = None
    
    remark: Optional[str] = None


class GoldMaterialBalanceResponse(BaseModel):
    """金料库存余额响应"""
    total_income: float  # 累计收入（克）
    total_expense: float  # 累计支出（克）
    current_balance: float  # 当前余额（克）


class CustomerGoldDepositResponse(BaseModel):
    """客户存料响应"""
    model_config = ConfigDict(from_attributes=True)
    customer_id: int
    customer_name: str
    current_balance: float  # 当前存料余额（克）
    total_deposited: float  # 累计存入
    total_used: float  # 累计使用
    last_transaction_at: Optional[datetime] = None


class CustomerGoldDepositTransactionResponse(BaseModel):
    """客户存料交易记录响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    customer_name: str
    transaction_type: str  # 'deposit' 存入 / 'use' 使用 / 'refund' 退还
    gold_transaction_id: Optional[int] = None
    settlement_order_id: Optional[int] = None
    amount: float  # 本次交易金额（克）
    balance_before: float  # 交易前余额
    balance_after: float  # 交易后余额
    status: str
    created_at: datetime
    created_by: Optional[str] = None
    remark: Optional[str] = None


class CustomerTransactionResponse(BaseModel):
    """客户往来账记录响应"""
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    customer_name: str
    transaction_type: str  # 'sales' / 'settlement' / 'gold_receipt' / 'payment'
    
    # 关联单据
    sales_order_id: Optional[int] = None
    settlement_order_id: Optional[int] = None
    gold_transaction_id: Optional[int] = None
    
    # 关联单据号（额外字段）
    related_order_no: Optional[str] = None
    
    # 金额信息
    amount: float  # 金额（元）
    gold_weight: float  # 金料重量（克）
    
    # 欠款信息
    gold_due_before: float  # 交易前金料欠款
    gold_due_after: float  # 交易后金料欠款
    
    status: str
    created_at: datetime
    remark: Optional[str] = None


class CustomerAccountSummary(BaseModel):
    """客户账户汇总信息"""
    customer_id: int
    customer_name: str
    
    # 金料欠款
    current_gold_due: float  # 当前金料欠款（克）
    total_gold_due: float  # 累计应支付金料（克）
    total_gold_received: float  # 累计已收金料（克）
    
    # 存料信息
    current_deposit: float  # 当前存料余额（克）
    total_deposited: float  # 累计存入
    total_used: float  # 累计使用
    
    # 交易记录
    transactions: List[CustomerTransactionResponse] = []
    deposit_transactions: List[CustomerGoldDepositTransactionResponse] = []


# ============= 客户取料单 Schema =============

class CustomerWithdrawalCreate(BaseModel):
    """创建客户取料单"""
    customer_id: int  # 客户ID
    gold_weight: float  # 取料克重
    withdrawal_type: str = "self"  # 取料方式：self 自取 / deliver 送到其他公司
    destination_company: Optional[str] = None  # 目的地公司
    destination_address: Optional[str] = None  # 目的地地址
    authorized_person: Optional[str] = None  # 授权取料人
    authorized_phone: Optional[str] = None  # 取料人电话
    remark: Optional[str] = None


class CustomerWithdrawalUpdate(BaseModel):
    """更新客户取料单"""
    gold_weight: Optional[float] = None
    withdrawal_type: Optional[str] = None
    destination_company: Optional[str] = None
    destination_address: Optional[str] = None
    authorized_person: Optional[str] = None
    authorized_phone: Optional[str] = None
    remark: Optional[str] = None


class CustomerWithdrawalComplete(BaseModel):
    """完成取料单"""
    completed_by: str  # 完成人


class CustomerWithdrawalResponse(BaseModel):
    """客户取料单响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    withdrawal_no: str  # 取料单号
    customer_id: int
    customer_name: str
    gold_weight: float  # 取料克重
    withdrawal_type: str  # 取料方式
    destination_company: Optional[str] = None
    destination_address: Optional[str] = None
    authorized_person: Optional[str] = None
    authorized_phone: Optional[str] = None
    status: str  # pending / completed / cancelled
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_by: Optional[str] = None
    completed_at: Optional[datetime] = None
    printed_at: Optional[datetime] = None
    remark: Optional[str] = None


# ============= 客户转料单 Schema =============

class CustomerTransferCreate(BaseModel):
    """创建客户转料单"""
    from_customer_id: int  # 转出客户ID
    to_customer_id: int  # 转入客户ID
    gold_weight: float  # 转料克重
    remark: Optional[str] = None


class CustomerTransferConfirm(BaseModel):
    """确认转料单"""
    confirmed_by: str  # 确认人


class CustomerTransferResponse(BaseModel):
    """客户转料单响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    transfer_no: str  # 转料单号
    from_customer_id: int
    from_customer_name: str
    to_customer_id: int
    to_customer_name: str
    gold_weight: float  # 转料克重
    status: str  # pending / completed / cancelled
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    printed_at: Optional[datetime] = None
    remark: Optional[str] = None


# ============= 商品编码 Schema =============

class ProductCodeCreate(BaseModel):
    """创建商品编码（仅F/FL编码）"""
    code: str  # 编码（F00000001 或 FL0001）
    name: str  # 商品名称
    code_type: str  # f_single（一码一件）或 fl_batch（批量）
    remark: Optional[str] = None


class ProductCodeUpdate(BaseModel):
    """更新商品编码"""
    name: Optional[str] = None
    remark: Optional[str] = None


class ProductCodeResponse(BaseModel):
    """商品编码响应"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    code: str  # 编码
    name: str  # 商品名称
    code_type: str  # predefined / f_single / fl_batch
    is_unique: int  # 是否唯一编码
    is_used: int  # 是否已使用
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    remark: Optional[str] = None
    supplier_name: Optional[str] = None  # 供应商名称（通过入库记录关联）


class ProductCodeSearchResponse(BaseModel):
    """商品编码搜索响应"""
    codes: List["ProductCodeResponse"]
    total: int


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
    # 结算
    'SettlementOrderCreate',
    'SettlementOrderConfirm',
    'SettlementOrderResponse',
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
    # 退货单
    'ReturnItemCreate',
    'ReturnItemResponse',
    'ReturnOrderCreate',
    'ReturnOrderApprove',
    'ReturnOrderReject',
    'ReturnOrderComplete',
    'ReturnOrderResponse',
    # 金料管理
    'GoldReceiptCreate',
    'GoldReceiptUpdate',
    'GoldPaymentCreate',
    'GoldMaterialTransactionConfirm',
    'GoldMaterialTransactionResponse',
    'GoldMaterialBalanceResponse',
    'CustomerGoldDepositResponse',
    'CustomerGoldDepositTransactionResponse',
    'CustomerTransactionResponse',
    'CustomerAccountSummary',
    # 客户取料单
    'CustomerWithdrawalCreate',
    'CustomerWithdrawalUpdate',
    'CustomerWithdrawalComplete',
    'CustomerWithdrawalResponse',
    # 客户转料单
    'CustomerTransferCreate',
    'CustomerTransferConfirm',
    'CustomerTransferResponse',
    # 商品编码
    'ProductCodeCreate',
    'ProductCodeUpdate',
    'ProductCodeResponse',
    'ProductCodeSearchResponse',
]
