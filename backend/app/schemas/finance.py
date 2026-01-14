"""
财务对账模块 - Pydantic Schema定义
"""

from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime, date
from typing import Optional, List
from enum import Enum


# ============= 枚举类型定义 =============

class AccountReceivableStatus(str, Enum):
    """应收账款状态"""
    UNPAID = "unpaid"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PaymentMethod(str, Enum):
    """收款方式"""
    CASH = "cash"
    BANK_TRANSFER = "bank_transfer"
    WECHAT = "wechat"
    ALIPAY = "alipay"
    CARD = "card"
    CHECK = "check"
    OTHER = "other"


class ReminderMethod(str, Enum):
    """催款方式"""
    PHONE = "phone"
    WECHAT = "wechat"
    VISIT = "visit"
    SMS = "sms"
    EMAIL = "email"
    OTHER = "other"


class ReminderStatus(str, Enum):
    """催款状态"""
    PENDING_FOLLOW_UP = "pending_follow_up"
    CUSTOMER_PROMISED = "customer_promised"
    CUSTOMER_REFUSED = "customer_refused"
    PAID = "paid"
    CANCELLED = "cancelled"


class ReconciliationStatus(str, Enum):
    """对账单状态"""
    DRAFT = "draft"
    SENT = "sent"
    CONFIRMED = "confirmed"
    DISPUTED = "disputed"
    ARCHIVED = "archived"


# ============= 基础引用类型 =============

class CustomerReference(BaseModel):
    """客户引用"""
    id: int
    customer_no: str
    name: str
    phone: Optional[str] = None
    wechat: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)


class SalesOrderReference(BaseModel):
    """销售单引用"""
    id: int
    order_no: str
    order_date: datetime
    salesperson: str
    store_code: Optional[str] = None
    total_amount: float
    
    model_config = ConfigDict(from_attributes=True)


# ============= 应收账款 =============

class AccountReceivableBase(BaseModel):
    """应收账款基础字段"""
    sales_order_id: int
    customer_id: int
    total_amount: float
    credit_days: int = 30
    salesperson: Optional[str] = None
    store_code: Optional[str] = None
    remark: Optional[str] = None


class AccountReceivableCreate(AccountReceivableBase):
    """创建应收账款"""
    credit_start_date: date


class AccountReceivableResponse(BaseModel):
    """应收账款响应"""
    id: int
    sales_order_id: int
    customer_id: int
    total_amount: float
    received_amount: float
    unpaid_amount: float
    credit_days: int
    credit_start_date: date
    due_date: date
    overdue_days: int
    status: str
    is_overdue: bool
    salesperson: Optional[str] = None
    store_code: Optional[str] = None
    contract_no: Optional[str] = None
    invoice_no: Optional[str] = None
    expected_payment_date: Optional[date] = None
    remark: Optional[str] = None
    create_time: datetime
    update_time: datetime
    operator: str
    last_updater: Optional[str] = None
    
    # 关联数据
    customer: Optional[CustomerReference] = None
    sales_order: Optional[SalesOrderReference] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============= 收款记录 =============

class PaymentRecordBase(BaseModel):
    """收款记录基础字段"""
    account_receivable_id: int
    customer_id: int
    amount: float
    payment_method: PaymentMethod
    payment_date: date
    voucher_images: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    transfer_no: Optional[str] = None
    remark: Optional[str] = None


class PaymentRecordCreate(PaymentRecordBase):
    """创建收款记录"""
    pass


class PaymentRecordResponse(BaseModel):
    """收款记录响应"""
    id: int
    account_receivable_id: int
    customer_id: int
    payment_date: date
    amount: float
    payment_method: str
    voucher_images: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    transfer_no: Optional[str] = None
    actual_received_date: Optional[date] = None
    handling_fee: Optional[float] = None
    exchange_rate: Optional[float] = None
    remark: Optional[str] = None
    operator: str
    create_time: datetime
    update_time: Optional[datetime] = None
    
    # 关联数据
    customer: Optional[CustomerReference] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============= 催款记录 =============

class ReminderRecordBase(BaseModel):
    """催款记录基础字段"""
    account_receivable_id: int
    customer_id: int
    reminder_date: date
    reminder_person: str
    reminder_method: ReminderMethod
    reminder_content: Optional[str] = None
    customer_feedback: Optional[str] = None
    promised_payment_date: Optional[date] = None
    promised_amount: Optional[float] = None
    next_follow_up_date: Optional[date] = None
    status: ReminderStatus = ReminderStatus.PENDING_FOLLOW_UP
    remark: Optional[str] = None


class ReminderRecordCreate(ReminderRecordBase):
    """创建催款记录"""
    pass


class ReminderRecordResponse(BaseModel):
    """催款记录响应"""
    id: int
    account_receivable_id: int
    customer_id: int
    reminder_date: date
    reminder_person: str
    reminder_method: str
    reminder_content: Optional[str] = None
    customer_feedback: Optional[str] = None
    promised_payment_date: Optional[date] = None
    promised_amount: Optional[float] = None
    next_follow_up_date: Optional[date] = None
    status: str
    effectiveness_score: Optional[int] = None
    media_url: Optional[str] = None
    contact_info: Optional[str] = None
    remark: Optional[str] = None
    create_time: datetime
    update_time: Optional[datetime] = None
    
    # 关联数据
    customer: Optional[CustomerReference] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============= 对账单 =============

class ReconciliationSalesDetail(BaseModel):
    """对账单销售明细"""
    sales_order_id: int
    sales_order_no: str
    sales_date: date
    sales_amount: float
    salesperson: str
    store_code: Optional[str] = None


class ReconciliationPaymentDetail(BaseModel):
    """对账单收款明细"""
    payment_record_id: int
    payment_date: date
    payment_amount: float
    payment_method: str
    related_sales_order_no: Optional[str] = None


class ReconciliationStatementCreate(BaseModel):
    """创建对账单"""
    customer_id: int
    period_start_date: date
    period_end_date: date
    period_description: Optional[str] = None
    remark: Optional[str] = None


class ReconciliationStatementResponse(BaseModel):
    """对账单响应"""
    id: int
    customer_id: int
    statement_no: str
    period_start_date: date
    period_end_date: date
    period_description: Optional[str] = None
    opening_balance: float
    period_sales_amount: float
    period_payment_amount: float
    closing_balance: float
    status: str
    sent_date: Optional[datetime] = None
    confirmed_date: Optional[datetime] = None
    confirmed_by: Optional[str] = None
    dispute_reason: Optional[str] = None
    pdf_url: Optional[str] = None
    remark: Optional[str] = None
    create_time: datetime
    update_time: datetime
    operator: str
    last_updater: Optional[str] = None
    
    # 明细数据
    sales_details: List[ReconciliationSalesDetail] = []
    payment_details: List[ReconciliationPaymentDetail] = []
    
    # 关联数据
    customer: Optional[CustomerReference] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============= 统计 =============

class FinanceStatistics(BaseModel):
    """财务统计"""
    total_receivable: float  # 总应收账款
    monthly_payment: float  # 本月回款
    overdue_amount: float  # 逾期金额
    overdue_customer_count: int  # 逾期客户数
    monthly_payment_change: Optional[float] = None  # 环比变化百分比


# ============= 统一响应格式 =============

class ApiResponse(BaseModel):
    """统一API响应"""
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    message: Optional[str] = None


class ReceivableListResponse(BaseModel):
    """应收账款列表响应"""
    success: bool
    data: List[AccountReceivableResponse] = []
    total: int = 0
    error: Optional[str] = None


class StatisticsResponse(BaseModel):
    """统计响应"""
    success: bool
    data: Optional[FinanceStatistics] = None
    error: Optional[str] = None



