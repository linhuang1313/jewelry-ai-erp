"""
财务对账模块 - 数据库模型定义
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class AccountReceivable(Base):
    """应收账款表"""
    __tablename__ = "account_receivables"
    
    id = Column(Integer, primary_key=True, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    
    # 金额字段
    total_amount = Column(Float, nullable=False, default=0.0)  # 应收总额
    received_amount = Column(Float, default=0.0)  # 已收金额
    unpaid_amount = Column(Float, default=0.0)  # 未收金额
    
    # 账期字段
    credit_days = Column(Integer, default=30)  # 账期天数
    credit_start_date = Column(Date, nullable=False)  # 账期开始日期
    due_date = Column(Date, nullable=False)  # 到期日期
    overdue_days = Column(Integer, default=0)  # 逾期天数
    
    # 状态字段
    status = Column(String(20), default="unpaid")  # unpaid/paid/overdue/cancelled
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
    """收款记录表"""
    __tablename__ = "payment_records"
    
    id = Column(Integer, primary_key=True, index=True)
    account_receivable_id = Column(Integer, ForeignKey("account_receivables.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    
    # 收款信息
    payment_date = Column(Date, nullable=False)  # 收款日期
    amount = Column(Float, nullable=False)  # 收款金额
    payment_method = Column(String(20), nullable=False)  # 收款方式: cash/bank_transfer/wechat/alipay/card/check/other
    
    # 凭证和银行信息
    voucher_images = Column(Text)  # 凭证图片（逗号分隔）
    bank_name = Column(String(100))  # 银行名称
    bank_account = Column(String(50))  # 银行账号
    transfer_no = Column(String(100))  # 转账流水号
    
    # 其他信息
    actual_received_date = Column(Date)  # 实际到账日期
    handling_fee = Column(Float, default=0.0)  # 手续费
    exchange_rate = Column(Float, default=1.0)  # 汇率
    remark = Column(Text)  # 备注
    
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
    account_receivable_id = Column(Integer, ForeignKey("account_receivables.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    
    # 催款信息
    reminder_date = Column(Date, nullable=False)  # 催款日期
    reminder_person = Column(String(50), nullable=False)  # 催款人
    reminder_method = Column(String(20), nullable=False)  # 催款方式: phone/wechat/visit/sms/email/other
    reminder_content = Column(Text)  # 催款内容
    
    # 客户反馈
    customer_feedback = Column(Text)  # 客户反馈
    promised_payment_date = Column(Date)  # 承诺付款日期
    promised_amount = Column(Float)  # 承诺付款金额
    next_follow_up_date = Column(Date)  # 下次跟进日期
    
    # 状态和评分
    status = Column(String(30), default="pending_follow_up")  # pending_follow_up/customer_promised/customer_refused/paid/cancelled
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


class ReconciliationStatement(Base):
    """对账单表"""
    __tablename__ = "reconciliation_statements"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    statement_no = Column(String(50), unique=True, index=True, nullable=False)  # 对账单号
    
    # 期间
    period_start_date = Column(Date, nullable=False)  # 期间开始日期
    period_end_date = Column(Date, nullable=False)  # 期间结束日期
    period_description = Column(String(100))  # 期间描述
    
    # 金额汇总
    opening_balance = Column(Float, default=0.0)  # 期初欠款
    period_sales_amount = Column(Float, default=0.0)  # 本期销售
    period_payment_amount = Column(Float, default=0.0)  # 本期收款
    closing_balance = Column(Float, default=0.0)  # 期末欠款
    
    # 明细数据（JSON格式存储）
    sales_details = Column(Text)  # 销售明细（JSON）
    payment_details = Column(Text)  # 收款明细（JSON）
    
    # 状态
    status = Column(String(20), default="draft")  # draft/sent/confirmed/disputed/archived
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


