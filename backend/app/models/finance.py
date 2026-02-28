"""
财务对账模块 - 数据库模型定义
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Date, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class AccountReceivable(Base):
    """应收账款表"""
    __tablename__ = "account_receivables"
    
    id = Column(Integer, primary_key=True, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 金额字段
    total_amount = Column(Numeric(14, 2), nullable=False, default=0.0)  # 应收总额
    received_amount = Column(Numeric(14, 2), default=0.0)  # 已收金额
    unpaid_amount = Column(Numeric(14, 2), default=0.0)  # 未收金额
    
    # 账期字段
    credit_days = Column(Integer, default=30)  # 账期天数
    credit_start_date = Column(Date, nullable=False)  # 账期开始日期
    due_date = Column(Date, nullable=False, index=True)  # 到期日期
    overdue_days = Column(Integer, default=0)  # 逾期天数
    
    # 状态字段
    status = Column(String(20), default="unpaid", index=True)  # unpaid/paid/overdue/cancelled
    is_overdue = Column(Boolean, default=False)  # 是否逾期
    
    # 其他字段
    salesperson = Column(String(50))  # 业务员
    store_code = Column(String(50))  # 门店代码
    contract_no = Column(String(50))  # 合同编号
    invoice_no = Column(String(50))  # 发票编号
    expected_payment_date = Column(Date)  # 预计收款日期
    remark = Column(Text)  # 备注
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    operator = Column(String(50), default="系统管理员")
    last_updater = Column(String(50))
    
    # 关系
    customer = relationship("Customer", backref="account_receivables")
    sales_order = relationship("SalesOrder", backref="account_receivables")
    payment_records = relationship("PaymentRecord", back_populates="account_receivable", cascade="all, delete-orphan")
    reminder_records = relationship("ReminderRecord", back_populates="account_receivable", cascade="all, delete-orphan")


class PaymentRecord(Base):
    """收款记录表 - 记录客户的每一笔来款"""
    __tablename__ = "payment_records"
    
    id = Column(Integer, primary_key=True, index=True)
    # 收款单号
    payment_no = Column(String(50), unique=True, index=True)  # 收款单号 (SK+时间戳)
    # 关联信息（account_receivable_id 改为可选，因为一笔收款可能冲抵多笔应收）
    account_receivable_id = Column(Integer, ForeignKey("account_receivables.id", ondelete="SET NULL"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 收款信息
    payment_date = Column(Date, nullable=False, index=True)  # 收款日期
    amount = Column(Numeric(14, 2), nullable=False)  # 收款金额
    gold_amount = Column(Numeric(14, 2), default=0.0)  # 金款部分（元）
    labor_amount = Column(Numeric(14, 2), default=0.0)  # 工费部分（元）
    payment_method = Column(String(20), nullable=False)  # 收款方式: cash/bank_transfer/wechat/alipay/card/check/other
    receipt_reason = Column(String(100), default="货款")  # 收款事由
    
    # 凭证和银行信息
    voucher_images = Column(Text)  # 凭证图片（逗号分隔）
    bank_name = Column(String(100))  # 银行名称
    bank_account = Column(String(50))  # 银行账号
    transfer_no = Column(String(100))  # 转账流水号
    
    # 协同卡片关联
    action_card_id = Column(String(50), nullable=True, index=True)  # 关联的 ActionCard ID
    
    # 其他信息
    actual_received_date = Column(Date)  # 实际到账日期
    handling_fee = Column(Numeric(10, 2), default=0.0)  # 手续费
    exchange_rate = Column(Numeric(10, 6), default=1.0)  # 汇率
    remark = Column(Text)  # 备注
    
    # 单据生命周期
    status = Column(String(20), default="confirmed", index=True)  # pending/confirmed/cancelled
    confirmed_by = Column(String(50), nullable=True)  # 确认人（财务）
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    reviewed_by = Column(String(50), nullable=True)  # 复核人（结算）
    
    # 操作记录
    operator = Column(String(50), default="系统管理员")
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    account_receivable = relationship("AccountReceivable", back_populates="payment_records")
    customer = relationship("Customer", backref="payment_records")


class ReminderRecord(Base):
    """催款记录表"""
    __tablename__ = "reminder_records"
    
    id = Column(Integer, primary_key=True, index=True)
    account_receivable_id = Column(Integer, ForeignKey("account_receivables.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 催款信息
    reminder_date = Column(Date, nullable=False)  # 催款日期
    reminder_person = Column(String(50), nullable=False)  # 催款人
    reminder_method = Column(String(20), nullable=False)  # 催款方式: phone/wechat/visit/sms/email/other
    reminder_content = Column(Text)  # 催款内容
    
    # 客户反馈
    customer_feedback = Column(Text)  # 客户反馈
    promised_payment_date = Column(Date)  # 承诺付款日期
    promised_amount = Column(Numeric(14, 2))  # 承诺付款金额
    next_follow_up_date = Column(Date)  # 下次跟进日期
    
    # 状态和评分
    status = Column(String(30), default="pending_follow_up", index=True)  # pending_follow_up/customer_promised/customer_refused/paid/cancelled
    effectiveness_score = Column(Integer)  # 效果评分 1-5
    
    # 其他信息
    media_url = Column(Text)  # 媒体文件URL
    contact_info = Column(String(100))  # 联系方式
    remark = Column(Text)  # 备注
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    account_receivable = relationship("AccountReceivable", back_populates="reminder_records")
    customer = relationship("Customer", backref="reminder_records")


class GoldReceipt(Base):
    """收料单表 - 记录客户交付金料和期初金料"""
    __tablename__ = "gold_receipts"
    
    id = Column(Integer, primary_key=True, index=True)
    receipt_no = Column(String(50), unique=True, index=True, nullable=False)  # 收料单号 (SL+时间戳, QC期初)
    
    # 关联信息（添加索引优化查询）
    settlement_id = Column(Integer, ForeignKey("settlement_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联结算单
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)  # 客户ID
    
    # 金料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 收料克重
    gold_fineness = Column(String(50), default="足金999")  # 成色
    
    # 期初金料标记
    is_initial_balance = Column(Boolean, default=False, index=True)  # 是否为期初金料
    
    # 状态（添加索引优化按状态查询）
    status = Column(String(20), default="pending", index=True)  # pending=待接收, received=已接收
    
    # 开单信息
    created_by = Column(String(50), nullable=False)  # 开单人（结算专员）
    
    # 料部接收信息
    received_by = Column(String(50), nullable=True)  # 料部接收人
    received_at = Column(DateTime, nullable=True)  # 接收时间
    
    # 其他
    remark = Column(Text)  # 备注
    
    # 操作记录
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    customer = relationship("Customer", backref="gold_receipts")
    settlement = relationship("SettlementOrder", backref="gold_receipts")


class ReconciliationStatement(Base):
    """对账单表"""
    __tablename__ = "reconciliation_statements"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    statement_no = Column(String(50), unique=True, index=True, nullable=False)  # 对账单号
    
    # 期间
    period_start_date = Column(Date, nullable=False)  # 期间开始日期
    period_end_date = Column(Date, nullable=False)  # 期间结束日期
    period_description = Column(String(100))  # 期间描述
    
    # 金额汇总
    opening_balance = Column(Numeric(14, 2), default=0.0)  # 期初欠款
    period_sales_amount = Column(Numeric(14, 2), default=0.0)  # 本期销售
    period_payment_amount = Column(Numeric(14, 2), default=0.0)  # 本期收款
    closing_balance = Column(Numeric(14, 2), default=0.0)  # 期末欠款
    
    # 明细数据（JSON格式存储）
    sales_details = Column(Text)  # 销售明细（JSON）
    payment_details = Column(Text)  # 收款明细（JSON）
    
    # 状态
    status = Column(String(20), default="draft", index=True)  # draft/sent/confirmed/disputed/archived
    sent_date = Column(DateTime)  # 发送日期
    confirmed_date = Column(DateTime)  # 确认日期
    confirmed_by = Column(String(50))  # 确认人
    dispute_reason = Column(Text)  # 争议原因
    
    # 其他信息
    pdf_url = Column(Text)  # PDF文件URL
    remark = Column(Text)  # 备注
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    operator = Column(String(50), default="系统管理员")
    last_updater = Column(String(50))
    
    # 关系
    customer = relationship("Customer", backref="reconciliation_statements")


# ==================== 银行账户（需先定义，被其他模型引用） ====================

class BankAccount(Base):
    """银行账户表 - 管理公司的所有资金账户"""
    __tablename__ = "bank_accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 账户信息
    account_name = Column(String(100), nullable=False)  # 账户名称
    account_no = Column(String(50))  # 账号
    bank_name = Column(String(100))  # 开户银行
    account_type = Column(String(20), nullable=False, default="bank")  # bank/cash/alipay/wechat
    
    # 余额信息
    initial_balance = Column(Numeric(14, 2), default=0.0)  # 期初余额
    current_balance = Column(Numeric(14, 2), default=0.0)  # 当前余额
    
    # 状态
    is_default = Column(Boolean, default=False)  # 是否默认账户
    status = Column(String(20), default="active")  # active/inactive
    
    # 其他信息
    description = Column(Text)  # 描述
    remark = Column(Text)  # 备注
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by = Column(String(50), default="系统管理员")
    
    # 关系
    cash_flows = relationship("CashFlow", back_populates="bank_account", cascade="all, delete-orphan")


# ==================== 应付账款模块 ====================

class AccountPayable(Base):
    """应付账款表 - 记录欠供应商的款项"""
    __tablename__ = "account_payables"
    
    id = Column(Integer, primary_key=True, index=True)
    payable_no = Column(String(50), unique=True, index=True, nullable=False)  # 应付单号 YF20260126001
    
    # 关联信息
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联入库单
    
    # 金额信息
    total_amount = Column(Numeric(14, 2), nullable=False, default=0.0)  # 应付总额（工费金额）
    paid_amount = Column(Numeric(14, 2), default=0.0)  # 已付金额
    unpaid_amount = Column(Numeric(14, 2), default=0.0)  # 未付金额
    
    # 账期信息
    credit_days = Column(Integer, default=30)  # 账期天数
    credit_start_date = Column(Date, nullable=False)  # 账期开始日期（入库日期）
    due_date = Column(Date, nullable=False, index=True)  # 到期日期
    overdue_days = Column(Integer, default=0)  # 逾期天数
    
    # 状态
    status = Column(String(20), default="unpaid", index=True)  # unpaid/partial/paid/cancelled
    is_overdue = Column(Boolean, default=False)  # 是否逾期
    
    # 其他信息
    remark = Column(Text)  # 备注
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now(), index=True)
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    operator = Column(String(50), default="系统管理员")
    
    # 关系
    supplier = relationship("Supplier", backref="account_payables")
    inbound_order = relationship("InboundOrder", backref="account_payables")
    supplier_payments = relationship("SupplierPayment", back_populates="account_payable", cascade="all, delete-orphan")


class SupplierPayment(Base):
    """供应商付款记录表 - 记录给供应商的每一笔付款"""
    __tablename__ = "supplier_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_no = Column(String(50), unique=True, index=True, nullable=False)  # 付款单号 FK20260126001
    
    # 关联信息
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    payable_id = Column(Integer, ForeignKey("account_payables.id", ondelete="SET NULL"), nullable=True, index=True)  # 关联应付账款
    
    # 付款信息
    payment_date = Column(Date, nullable=False, index=True)  # 付款日期
    amount = Column(Numeric(14, 2), nullable=False)  # 付款金额
    payment_method = Column(String(20), nullable=False)  # 付款方式: bank_transfer/cash/check/acceptance
    
    # 银行信息
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True)  # 付款账户
    bank_name = Column(String(100))  # 银行名称
    transfer_no = Column(String(100))  # 转账流水号
    
    # 其他信息
    remark = Column(Text)  # 备注
    
    # 单据生命周期
    status = Column(String(20), default="confirmed", index=True)  # pending/confirmed/cancelled
    confirmed_by = Column(String(50), nullable=True)  # 确认人
    confirmed_at = Column(DateTime, nullable=True)  # 确认时间
    
    # 操作记录
    created_by = Column(String(50), default="系统管理员")
    create_time = Column(DateTime, server_default=func.now(), index=True)
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    supplier = relationship("Supplier", backref="supplier_payments")
    account_payable = relationship("AccountPayable", back_populates="supplier_payments")
    bank_account = relationship("BankAccount", backref="supplier_payments")


# ==================== 资金流水模块 ====================

class CashFlow(Base):
    """资金流水表 - 记录所有资金进出"""
    __tablename__ = "cash_flows"
    
    id = Column(Integer, primary_key=True, index=True)
    flow_no = Column(String(50), unique=True, index=True, nullable=False)  # 流水号 LS20260126001
    
    # 账户信息
    account_id = Column(Integer, ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # 流水信息
    flow_type = Column(String(20), nullable=False, index=True)  # income/expense
    category = Column(String(50), nullable=False)  # 分类：销售收款/供应商付款/费用支出/其他收入/其他支出
    amount = Column(Numeric(14, 2), nullable=False)  # 金额
    balance_before = Column(Numeric(14, 2), nullable=False)  # 交易前余额
    balance_after = Column(Numeric(14, 2), nullable=False)  # 交易后余额
    
    # 关联业务
    related_type = Column(String(50))  # 关联类型：payment_record/supplier_payment/expense/transfer
    related_id = Column(Integer)  # 关联ID
    
    # 时间信息
    flow_date = Column(DateTime, nullable=False, index=True)  # 流水日期
    
    # 其他信息
    counterparty = Column(String(100))  # 交易对方
    remark = Column(Text)  # 备注
    
    # 操作记录
    created_by = Column(String(50), default="系统管理员")
    create_time = Column(DateTime, server_default=func.now())
    
    # 关系
    bank_account = relationship("BankAccount", back_populates="cash_flows")


# ==================== 费用管理模块 ====================

class ExpenseCategory(Base):
    """费用类别表 - 管理费用分类"""
    __tablename__ = "expense_categories"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 类别信息
    code = Column(String(20), unique=True, nullable=False)  # 类别编码
    name = Column(String(50), nullable=False)  # 类别名称
    parent_id = Column(Integer, ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True)  # 父类别
    
    # 其他信息
    description = Column(Text)  # 描述
    sort_order = Column(Integer, default=0)  # 排序
    is_active = Column(Boolean, default=True)  # 是否启用
    
    # 操作记录
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    parent = relationship("ExpenseCategory", remote_side=[id], backref="children")
    expenses = relationship("Expense", back_populates="category")


class Expense(Base):
    """费用记录表 - 记录日常运营费用"""
    __tablename__ = "expenses"
    
    id = Column(Integer, primary_key=True, index=True)
    expense_no = Column(String(50), unique=True, index=True, nullable=False)  # 费用单号 FY20260126001
    
    # 类别和账户
    category_id = Column(Integer, ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 费用信息
    amount = Column(Numeric(14, 2), nullable=False)  # 费用金额
    expense_date = Column(Date, nullable=False, index=True)  # 费用日期
    
    # 收款方信息
    payee = Column(String(100))  # 收款方
    payment_method = Column(String(20))  # 支付方式
    
    # 附件信息
    attachment = Column(String(500))  # 附件路径（发票等）
    
    # 审批信息
    status = Column(String(20), default="pending", index=True)  # pending/approved/rejected
    approved_by = Column(String(50))  # 审批人
    approved_at = Column(DateTime)  # 审批时间
    reject_reason = Column(Text)  # 驳回原因
    
    # 其他信息
    remark = Column(Text)  # 备注
    
    # 操作记录
    created_by = Column(String(50), default="系统管理员")
    create_time = Column(DateTime, server_default=func.now())
    update_time = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    # 关系
    category = relationship("ExpenseCategory", back_populates="expenses")
    bank_account = relationship("BankAccount", backref="expenses")


class CustomerGoldTransfer(Base):
    """客料回仓单 - 结算将收到的客户金料转交给料部"""
    __tablename__ = "customer_gold_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, index=True, nullable=False)  # 单号 KHH+日期+序号
    
    # 金料信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 转交克重
    gold_fineness = Column(String(50), default="足金999")  # 成色
    
    # 状态
    status = Column(String(20), default="pending", index=True)  # pending/confirmed/unconfirmed
    
    # 开单信息（结算）
    created_by = Column(String(50), nullable=False)
    create_time = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    
    # 确认信息（料部）
    confirmed_by = Column(String(50), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    
    # 备注
    remark = Column(Text, nullable=True)


class DepositSettlement(Base):
    """存料结价单 - 将客户存料折算成现金抵扣欠款"""
    __tablename__ = "deposit_settlements"
    
    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, index=True, nullable=False)  # 编号 CJ+日期+序号
    
    # 客户信息
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_name = Column(String(100), nullable=False)
    
    # 结价信息
    gold_weight = Column(Numeric(12, 4), nullable=False)  # 结价克重
    gold_price = Column(Numeric(14, 2), nullable=False)  # 金价（元/克）
    total_amount = Column(Numeric(14, 2), nullable=False)  # 总金额 = gold_weight × gold_price
    
    # 状态：draft草稿 / confirmed已确认 / cancelled已取消
    status = Column(String(20), default="draft", index=True)
    
    # 创建信息
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    
    # 确认信息
    confirmed_by = Column(String(50), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    
    # 备注
    remark = Column(Text, nullable=True)
    
    # 关系
    customer = relationship("Customer", backref="deposit_settlements")


# 预置费用类别
DEFAULT_EXPENSE_CATEGORIES = [
    {"code": "rent", "name": "房租", "sort_order": 1},
    {"code": "salary", "name": "工资", "sort_order": 2},
    {"code": "utilities", "name": "水电费", "sort_order": 3},
    {"code": "communication", "name": "通讯费", "sort_order": 4},
    {"code": "office", "name": "办公用品", "sort_order": 5},
    {"code": "transport", "name": "交通费", "sort_order": 6},
    {"code": "entertainment", "name": "业务招待", "sort_order": 7},
    {"code": "tax", "name": "税费", "sort_order": 8},
    {"code": "maintenance", "name": "维修费", "sort_order": 9},
    {"code": "insurance", "name": "保险费", "sort_order": 10},
    {"code": "other", "name": "其他费用", "sort_order": 99},
]



