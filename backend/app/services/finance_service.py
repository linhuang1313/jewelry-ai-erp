"""
财务对账模块 - 业务逻辑服务
"""

import logging
import json
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from ..models.finance import AccountReceivable, PaymentRecord, ReminderRecord, ReconciliationStatement
from ..models import Customer, SalesOrder
from ..schemas.finance import (
    AccountReceivableCreate,
    PaymentRecordCreate,
    ReminderRecordCreate,
    ReconciliationStatementCreate,
    FinanceStatistics,
    AccountReceivableResponse,
    PaymentRecordResponse,
    ReminderRecordResponse,
    ReconciliationStatementResponse,
    ReconciliationSalesDetail,
    ReconciliationPaymentDetail,
)

logger = logging.getLogger(__name__)


class FinanceService:
    """财务服务类"""
    
    def __init__(self, db: Session):
        """
        初始化财务服务
        
        Args:
            db: 数据库会话
        """
        self.db = db
    
    # ============= 应收账款相关 =============
    
    async def get_receivables(
        self,
        filter_type: str = "all",
        search: Optional[str] = None,
        sort_by: str = "overdue_days",
        sort_order: str = "desc",
        skip: int = 0,
        limit: int = 100
    ) -> List[AccountReceivable]:
        """
        获取应收账款列表
        
        Args:
            filter_type: 筛选类型 (all/unpaid/overdue/due_this_month)
            search: 搜索关键词（客户名称）
            sort_by: 排序字段
            sort_order: 排序方向 (asc/desc)
            skip: 跳过记录数
            limit: 返回记录数
            
        Returns:
            应收账款列表
        """
        # 先更新逾期状态
        await self._update_overdue_status()
        
        query = self.db.query(AccountReceivable)
        
        # 筛选
        today = date.today()
        if filter_type == "unpaid":
            query = query.filter(AccountReceivable.unpaid_amount > 0)
        elif filter_type == "overdue":
            query = query.filter(
                and_(
                    AccountReceivable.is_overdue == True,
                    AccountReceivable.unpaid_amount > 0
                )
            )
        elif filter_type == "due_this_month":
            month_start = today.replace(day=1)
            if today.month == 12:
                month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
            query = query.filter(
                and_(
                    AccountReceivable.due_date >= month_start,
                    AccountReceivable.due_date <= month_end,
                    AccountReceivable.unpaid_amount > 0
                )
            )
        
        # 搜索（通过客户名称）
        if search:
            query = query.join(Customer).filter(
                Customer.name.contains(search)
            )
        
        # 排序
        if sort_by == "amount":
            sort_column = AccountReceivable.unpaid_amount
        elif sort_by == "due_date":
            sort_column = AccountReceivable.due_date
        else:
            sort_column = AccountReceivable.overdue_days
        
        if sort_order == "asc":
            query = query.order_by(sort_column.asc())
        else:
            query = query.order_by(sort_column.desc())
        
        # 分页
        receivables = query.offset(skip).limit(limit).all()
        
        return receivables
    
    async def get_receivable_count(self, filter_type: str = "all") -> int:
        """
        获取应收账款总数
        
        Args:
            filter_type: 筛选类型
            
        Returns:
            记录总数
        """
        query = self.db.query(func.count(AccountReceivable.id))
        
        today = date.today()
        if filter_type == "unpaid":
            query = query.filter(AccountReceivable.unpaid_amount > 0)
        elif filter_type == "overdue":
            query = query.filter(
                and_(
                    AccountReceivable.is_overdue == True,
                    AccountReceivable.unpaid_amount > 0
                )
            )
        elif filter_type == "due_this_month":
            month_start = today.replace(day=1)
            if today.month == 12:
                month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
            query = query.filter(
                and_(
                    AccountReceivable.due_date >= month_start,
                    AccountReceivable.due_date <= month_end,
                    AccountReceivable.unpaid_amount > 0
                )
            )
        
        return query.scalar() or 0
    
    async def _update_overdue_status(self):
        """
        更新所有应收账款的逾期状态
        """
        today = date.today()
        
        # 获取所有未付清的应收账款
        receivables = self.db.query(AccountReceivable).filter(
            AccountReceivable.unpaid_amount > 0
        ).all()
        
        for receivable in receivables:
            # 计算逾期天数
            if receivable.due_date < today:
                overdue_days = (today - receivable.due_date).days
                receivable.overdue_days = max(0, overdue_days)
                receivable.is_overdue = True
                receivable.status = "overdue"
            else:
                receivable.overdue_days = 0
                receivable.is_overdue = False
                if receivable.received_amount == 0:
                    receivable.status = "unpaid"
                else:
                    receivable.status = "unpaid"  # 部分付款仍为unpaid
        
        self.db.commit()
    
    def _update_receivable_status(self, receivable: AccountReceivable):
        """
        更新单个应收账款的状态
        
        Args:
            receivable: 应收账款对象
        """
        today = date.today()
        
        # 计算逾期天数
        if receivable.due_date < today and receivable.unpaid_amount > 0:
            receivable.overdue_days = max(0, (today - receivable.due_date).days)
            receivable.is_overdue = True
            receivable.status = "overdue"
        else:
            receivable.overdue_days = 0
            receivable.is_overdue = False
        
        # 更新状态
        if receivable.unpaid_amount <= 0:
            receivable.status = "paid"
            receivable.is_overdue = False
        elif receivable.is_overdue:
            receivable.status = "overdue"
        else:
            receivable.status = "unpaid"
    
    # ============= 收款相关 =============
    
    async def record_payment(self, payment_data: PaymentRecordCreate) -> PaymentRecord:
        """
        记录收款
        
        Args:
            payment_data: 收款数据
            
        Returns:
            收款记录
            
        Raises:
            ValueError: 验证失败
        """
        # 验证应收账款存在
        receivable = self.db.query(AccountReceivable).filter(
            AccountReceivable.id == payment_data.account_receivable_id
        ).first()
        
        if not receivable:
            raise ValueError(f"应收账款不存在: {payment_data.account_receivable_id}")
        
        # 验证客户存在
        customer = self.db.query(Customer).filter(
            Customer.id == payment_data.customer_id
        ).first()
        
        if not customer:
            raise ValueError(f"客户不存在: {payment_data.customer_id}")
        
        # 验证收款金额
        if payment_data.amount <= 0:
            raise ValueError("收款金额必须大于0")
        
        if payment_data.amount > receivable.unpaid_amount:
            raise ValueError(f"收款金额不能超过未收金额: {receivable.unpaid_amount}")
        
        try:
            # 创建收款记录
            payment = PaymentRecord(
                account_receivable_id=payment_data.account_receivable_id,
                customer_id=payment_data.customer_id,
                payment_date=payment_data.payment_date,
                amount=payment_data.amount,
                payment_method=payment_data.payment_method.value,
                voucher_images=payment_data.voucher_images,
                bank_name=payment_data.bank_name,
                bank_account=payment_data.bank_account,
                transfer_no=payment_data.transfer_no,
                remark=payment_data.remark,
            )
            
            self.db.add(payment)
            
            # 更新应收账款
            receivable.received_amount += payment_data.amount
            receivable.unpaid_amount = receivable.total_amount - receivable.received_amount
            receivable.update_time = datetime.now()
            
            # 更新状态
            self._update_receivable_status(receivable)
            
            self.db.commit()
            self.db.refresh(payment)
            
            logger.info(f"收款记录成功: 金额={payment_data.amount}, 应收账款ID={payment_data.account_receivable_id}")
            
            return payment
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"记录收款失败: {e}")
            raise
    
    # ============= 催款相关 =============
    
    async def record_reminder(self, reminder_data: ReminderRecordCreate) -> ReminderRecord:
        """
        记录催款
        
        Args:
            reminder_data: 催款数据
            
        Returns:
            催款记录
        """
        # 验证应收账款存在
        receivable = self.db.query(AccountReceivable).filter(
            AccountReceivable.id == reminder_data.account_receivable_id
        ).first()
        
        if not receivable:
            raise ValueError(f"应收账款不存在: {reminder_data.account_receivable_id}")
        
        # 验证客户存在
        customer = self.db.query(Customer).filter(
            Customer.id == reminder_data.customer_id
        ).first()
        
        if not customer:
            raise ValueError(f"客户不存在: {reminder_data.customer_id}")
        
        try:
            # 创建催款记录
            reminder = ReminderRecord(
                account_receivable_id=reminder_data.account_receivable_id,
                customer_id=reminder_data.customer_id,
                reminder_date=reminder_data.reminder_date,
                reminder_person=reminder_data.reminder_person,
                reminder_method=reminder_data.reminder_method.value,
                reminder_content=reminder_data.reminder_content,
                customer_feedback=reminder_data.customer_feedback,
                promised_payment_date=reminder_data.promised_payment_date,
                promised_amount=reminder_data.promised_amount,
                next_follow_up_date=reminder_data.next_follow_up_date,
                status=reminder_data.status.value,
                remark=reminder_data.remark,
            )
            
            self.db.add(reminder)
            self.db.commit()
            self.db.refresh(reminder)
            
            logger.info(f"催款记录成功: 客户ID={reminder_data.customer_id}")
            
            return reminder
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"记录催款失败: {e}")
            raise
    
    # ============= 对账单相关 =============
    
    async def generate_statement(
        self,
        statement_data: ReconciliationStatementCreate
    ) -> ReconciliationStatement:
        """
        生成对账单
        
        Args:
            statement_data: 对账单数据
            
        Returns:
            对账单
        """
        # 验证客户存在
        customer = self.db.query(Customer).filter(
            Customer.id == statement_data.customer_id
        ).first()
        
        if not customer:
            raise ValueError(f"客户不存在: {statement_data.customer_id}")
        
        try:
            # 生成对账单号
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            statement_no = f"DZ{statement_data.customer_id}{timestamp}"
            
            # 计算期初欠款（期间开始前的未收金额）
            opening_balance = self._calculate_opening_balance(
                statement_data.customer_id,
                statement_data.period_start_date
            )
            
            # 获取本期销售
            sales_details, period_sales_amount = self._get_period_sales(
                statement_data.customer_id,
                statement_data.period_start_date,
                statement_data.period_end_date
            )
            
            # 获取本期收款
            payment_details, period_payment_amount = self._get_period_payments(
                statement_data.customer_id,
                statement_data.period_start_date,
                statement_data.period_end_date
            )
            
            # 计算期末欠款
            closing_balance = opening_balance + period_sales_amount - period_payment_amount
            
            # 创建对账单
            statement = ReconciliationStatement(
                customer_id=statement_data.customer_id,
                statement_no=statement_no,
                period_start_date=statement_data.period_start_date,
                period_end_date=statement_data.period_end_date,
                period_description=statement_data.period_description,
                opening_balance=opening_balance,
                period_sales_amount=period_sales_amount,
                period_payment_amount=period_payment_amount,
                closing_balance=closing_balance,
                sales_details=json.dumps(sales_details, default=str, ensure_ascii=False),
                payment_details=json.dumps(payment_details, default=str, ensure_ascii=False),
                remark=statement_data.remark,
            )
            
            self.db.add(statement)
            self.db.commit()
            self.db.refresh(statement)
            
            logger.info(f"对账单生成成功: {statement_no}")
            
            return statement
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"生成对账单失败: {e}")
            raise
    
    def _calculate_opening_balance(self, customer_id: int, period_start: date) -> float:
        """
        计算期初欠款
        
        Args:
            customer_id: 客户ID
            period_start: 期间开始日期
            
        Returns:
            期初欠款金额
        """
        # 获取期间开始前的所有销售金额
        total_sales = self.db.query(func.coalesce(func.sum(SalesOrder.total_labor_cost), 0)).filter(
            and_(
                SalesOrder.customer_id == customer_id,
                SalesOrder.order_date < period_start
            )
        ).scalar() or 0
        
        # 获取期间开始前的所有收款金额
        total_payments = self.db.query(func.coalesce(func.sum(PaymentRecord.amount), 0)).filter(
            and_(
                PaymentRecord.customer_id == customer_id,
                PaymentRecord.payment_date < period_start
            )
        ).scalar() or 0
        
        return float(total_sales) - float(total_payments)
    
    def _get_period_sales(
        self,
        customer_id: int,
        period_start: date,
        period_end: date
    ) -> tuple:
        """
        获取本期销售
        
        Args:
            customer_id: 客户ID
            period_start: 期间开始日期
            period_end: 期间结束日期
            
        Returns:
            (销售明细列表, 销售总额)
        """
        sales = self.db.query(SalesOrder).filter(
            and_(
                SalesOrder.customer_id == customer_id,
                SalesOrder.order_date >= period_start,
                SalesOrder.order_date <= period_end
            )
        ).all()
        
        details = []
        total = 0
        
        for sale in sales:
            details.append({
                "sales_order_id": sale.id,
                "sales_order_no": sale.order_no,
                "sales_date": sale.order_date.date() if isinstance(sale.order_date, datetime) else sale.order_date,
                "sales_amount": sale.total_labor_cost,
                "salesperson": sale.salesperson,
                "store_code": sale.store_code,
            })
            total += sale.total_labor_cost
        
        return details, total
    
    def _get_period_payments(
        self,
        customer_id: int,
        period_start: date,
        period_end: date
    ) -> tuple:
        """
        获取本期收款
        
        Args:
            customer_id: 客户ID
            period_start: 期间开始日期
            period_end: 期间结束日期
            
        Returns:
            (收款明细列表, 收款总额)
        """
        payments = self.db.query(PaymentRecord).filter(
            and_(
                PaymentRecord.customer_id == customer_id,
                PaymentRecord.payment_date >= period_start,
                PaymentRecord.payment_date <= period_end
            )
        ).all()
        
        details = []
        total = 0
        
        for payment in payments:
            # 获取关联的销售单号
            related_order_no = None
            if payment.account_receivable:
                receivable = self.db.query(AccountReceivable).filter(
                    AccountReceivable.id == payment.account_receivable_id
                ).first()
                if receivable and receivable.sales_order:
                    related_order_no = receivable.sales_order.order_no
            
            details.append({
                "payment_record_id": payment.id,
                "payment_date": payment.payment_date,
                "payment_amount": payment.amount,
                "payment_method": payment.payment_method,
                "related_sales_order_no": related_order_no,
            })
            total += payment.amount
        
        return details, total
    
    # ============= 统计相关 =============
    
    async def get_statistics(self) -> FinanceStatistics:
        """
        获取财务统计
        
        Returns:
            财务统计数据
        """
        # 先更新逾期状态
        await self._update_overdue_status()
        
        today = date.today()
        
        # 总应收账款
        total_receivable = self.db.query(
            func.coalesce(func.sum(AccountReceivable.unpaid_amount), 0)
        ).filter(
            AccountReceivable.unpaid_amount > 0
        ).scalar() or 0
        
        # 本月回款
        month_start = today.replace(day=1)
        monthly_payment = self.db.query(
            func.coalesce(func.sum(PaymentRecord.amount), 0)
        ).filter(
            PaymentRecord.payment_date >= month_start
        ).scalar() or 0
        
        # 上月回款（计算环比）
        last_month_start = (month_start - timedelta(days=1)).replace(day=1)
        last_month_end = month_start - timedelta(days=1)
        last_monthly_payment = self.db.query(
            func.coalesce(func.sum(PaymentRecord.amount), 0)
        ).filter(
            and_(
                PaymentRecord.payment_date >= last_month_start,
                PaymentRecord.payment_date <= last_month_end
            )
        ).scalar() or 0
        
        # 计算环比变化
        if last_monthly_payment > 0:
            monthly_payment_change = ((monthly_payment - last_monthly_payment) / last_monthly_payment) * 100
        else:
            monthly_payment_change = 100 if monthly_payment > 0 else 0
        
        # 逾期金额
        overdue_amount = self.db.query(
            func.coalesce(func.sum(AccountReceivable.unpaid_amount), 0)
        ).filter(
            and_(
                AccountReceivable.is_overdue == True,
                AccountReceivable.unpaid_amount > 0
            )
        ).scalar() or 0
        
        # 逾期客户数
        overdue_customer_count = self.db.query(
            func.count(func.distinct(AccountReceivable.customer_id))
        ).filter(
            and_(
                AccountReceivable.is_overdue == True,
                AccountReceivable.unpaid_amount > 0
            )
        ).scalar() or 0
        
        return FinanceStatistics(
            total_receivable=float(total_receivable),
            monthly_payment=float(monthly_payment),
            overdue_amount=float(overdue_amount),
            overdue_customer_count=int(overdue_customer_count),
            monthly_payment_change=round(float(monthly_payment_change), 2),
        )

