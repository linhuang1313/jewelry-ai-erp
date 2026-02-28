import React, { useState, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { RefreshCw, TrendingUp, TrendingDown, Wallet, FileText, DollarSign, CreditCard } from 'lucide-react';
import { FinanceStatsCards } from './FinanceStatsCards';
import { AccountReceivableTable, ReceivableFilterParams } from './AccountReceivableTable';
import { PaymentRecordTable, PaymentFilterParams } from './PaymentRecordTable';
import { ReminderManagement } from './ReminderManagement';
import { ReconciliationGenerator } from './ReconciliationGenerator';
import {
  getReceivables, ReceivableItem, getPaymentRecords, PaymentRecordItem,
  getPayables, PayableItem, getPayablesStatistics, recordSupplierPayment,
  getBankAccounts, BankAccountItem, getCashFlows, CashFlowItem, getCashFlowSummary,
  getExpenseCategories, ExpenseCategory, getExpenses, ExpenseItem, createExpense, getExpensesSummary, initExpenseCategories
} from '../../services/financeService';
import {
  mockStatistics,
} from '../../mockFinanceData';
import {
  AccountReceivable,
  AccountReceivableStatus,
  PaymentRecord,
  PaymentMethod,
  CustomerReference,
} from '../../types/finance';

export const FinancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'receivables' | 'payments' | 'reminders' | 'reconciliation' | 'payables' | 'cashflow' | 'expenses'>('receivables');
  const [receivables, setReceivables] = useState<AccountReceivable[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // 新增状态 - 应付账款
  const [payables, setPayables] = useState<PayableItem[]>([]);
  const [payablesLoading, setPayablesLoading] = useState(false);
  const [payablesStats, setPayablesStats] = useState<any>(null);

  // 新增状态 - 资金流水
  const [bankAccounts, setBankAccounts] = useState<BankAccountItem[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlowItem[]>([]);
  const [cashFlowSummary, setCashFlowSummary] = useState<any>(null);
  const [cashFlowLoading, setCashFlowLoading] = useState(false);

  // 新增状态 - 费用管理
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [expensesSummary, setExpensesSummary] = useState<any>(null);
  const [expensesLoading, setExpensesLoading] = useState(false);

  // 供应商付款对话框状态
  const [showSupplierPaymentDialog, setShowSupplierPaymentDialog] = useState(false);
  const [selectedPayable, setSelectedPayable] = useState<PayableItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentRemark, setPaymentRemark] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // 安全的日期解析函数
  const safeParseDate = (dateStr: string | null | undefined): Date => {
    if (!dateStr) return new Date();
    try {
      const date = new Date(dateStr);
      // 检查日期是否有效
      if (isNaN(date.getTime())) {
        console.warn('Invalid date value:', dateStr);
        return new Date();
      }
      return date;
    } catch (e) {
      console.warn('Failed to parse date:', dateStr, e);
      return new Date();
    }
  };

  // 转换后端数据为前端格式
  const convertReceivable = (item: ReceivableItem): AccountReceivable => {
    return {
      id: item.id,
      salesOrderId: item.salesOrderId,
      customerId: item.customerId,
      totalAmount: item.totalAmount,
      receivedAmount: item.receivedAmount,
      unpaidAmount: item.unpaidAmount,
      creditDays: (item as any).creditDays || 30,
      status: item.status === 'paid' ? AccountReceivableStatus.PAID :
        item.status === 'overdue' ? AccountReceivableStatus.OVERDUE :
          AccountReceivableStatus.UNPAID,
      isOverdue: item.isOverdue,
      overdueDays: item.overdueDays,
      creditStartDate: safeParseDate(item.creditStartDate),
      dueDate: safeParseDate(item.dueDate),
      salesperson: (item as any).salesperson || '',
      createTime: safeParseDate((item as any).createTime),
      updateTime: safeParseDate((item as any).updateTime),
      operator: (item as any).operator || '系统',
      customer: item.customer ? {
        id: item.customer.id,
        customerNo: item.customer.customerNo,
        name: item.customer.name,
        phone: item.customer.phone,
      } : undefined,
      salesOrder: item.salesOrder ? {
        id: item.salesOrder.id,
        orderNo: item.salesOrder.orderNo,
        orderDate: safeParseDate(item.salesOrder.orderDate),
        salesperson: item.salesOrder.salesperson || '',
        totalAmount: item.salesOrder.totalAmount,
      } : undefined,
    };
  };

  // 保存筛选参数
  const [receivableFilters, setReceivableFilters] = useState<ReceivableFilterParams>({
    filterType: 'all',
    sortBy: 'overdue_days',
    sortOrder: 'desc',
  });

  // 加载应收账款数据
  const loadReceivables = useCallback(async (filters?: ReceivableFilterParams) => {
    setLoading(true);
    try {
      const f = filters || receivableFilters;
      const result = await getReceivables(
        f.filterType || 'all',
        f.search,
        f.sortBy || 'overdue_days',
        f.sortOrder || 'desc',
        0,
        200,
        f.startDate,
        f.endDate,
        f.salesOrderNo,
        f.settlementNo
      );
      if (result.success && result.data) {
        const converted = Array.isArray(result.data) ? result.data.map(convertReceivable) : [];
        setReceivables(Array.isArray(converted) ? converted : []);
      } else {
        toast.error(result.error || '加载应收账款失败');
      }
    } catch (error) {
      console.error('加载应收账款失败:', error);
      toast.error('加载应收账款失败');
    } finally {
      setLoading(false);
    }
  }, [receivableFilters]);

  // 处理应收明细筛选变化
  const handleReceivableFilterChange = useCallback((params: ReceivableFilterParams) => {
    setReceivableFilters(params);
    loadReceivables(params);
  }, [loadReceivables]);

  // 转换收款记录数据格式
  const convertPaymentRecord = (item: PaymentRecordItem): PaymentRecord => {
    const methodMap: Record<string, PaymentMethod> = {
      'cash': PaymentMethod.CASH,
      'bank_transfer': PaymentMethod.BANK_TRANSFER,
      'wechat': PaymentMethod.WECHAT,
      'alipay': PaymentMethod.ALIPAY,
      'card': PaymentMethod.CARD,
      'check': PaymentMethod.CHECK,
      'other': PaymentMethod.OTHER,
    };
    return {
      id: item.id,
      accountReceivableId: item.accountReceivableId || 0,
      customerId: item.customerId,
      paymentDate: new Date(item.paymentDate),
      amount: item.amount,
      paymentMethod: methodMap[item.paymentMethod] || PaymentMethod.OTHER,
      voucherImages: item.voucherImages,
      remark: item.remark,
      operator: item.operator || '系统',
      createTime: new Date(item.createTime),
      customer: item.customer ? {
        id: item.customer.id,
        customerNo: item.customer.customerNo,
        name: item.customer.name,
      } : undefined,
    };
  };

  // 保存收款记录筛选参数
  const [paymentFilters, setPaymentFilters] = useState<PaymentFilterParams>({});

  // 加载收款记录
  const loadPaymentRecords = useCallback(async (filters?: PaymentFilterParams) => {
    setPaymentsLoading(true);
    try {
      const f = filters || paymentFilters;
      const result = await getPaymentRecords(
        undefined,
        0,
        200,
        f.startDate,
        f.endDate,
        f.salesOrderNo
      );
      if (result.success && Array.isArray(result.data)) {
        const converted = result.data.map(convertPaymentRecord);
        setPaymentRecords(converted);
      } else if (!result.success) {
        toast.error(result.error || '加载收款记录失败');
      }
    } catch (error) {
      console.error('加载收款记录失败:', error);
      toast.error('加载收款记录失败');
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentFilters]);

  // 处理收款记录筛选变化
  const handlePaymentFilterChange = useCallback((params: PaymentFilterParams) => {
    setPaymentFilters(params);
    loadPaymentRecords(params);
  }, [loadPaymentRecords]);

  // 初始加载
  useEffect(() => {
    loadReceivables();
    loadPaymentRecords();
  }, [loadReceivables]);

  // 获取逾期客户列表（添加数组安全检查）
  const overdueAccounts = (Array.isArray(receivables) ? receivables : []).filter((ar) => ar.isOverdue);

  // 获取客户列表（从应收账款中提取，添加数组安全检查）
  const customers: CustomerReference[] = (Array.isArray(receivables) ? receivables : [])
    .filter((ar) => ar.customer)
    .map((ar) => ar.customer!)
    .filter((customer, index, self) =>
      self.findIndex(c => c.id === customer.id) === index
    );

  const handleRecordPayment = (ar: AccountReceivable) => {
    console.log('记录收款:', ar);
    // PaymentDialog 组件会处理这个
  };

  const handleRemind = (ar: AccountReceivable) => {
    console.log('催款:', ar);
    toast.success(`已发送催款提醒：${ar.customer?.name}`);
  };

  const handleAddPayment = () => {
    console.log('新增收款');
    toast('请在应收明细中选择要收款的记录', { icon: '💡' });
  };

  const handleViewPaymentDetail = (record: PaymentRecord) => {
    console.log('查看收款详情:', record);
  };

  const handleRecordReminder = (ar: AccountReceivable) => {
    console.log('记录催款:', ar);
    toast.success(`催款记录已保存：${ar.customer?.name}`);
  };

  const handleGenerateScript = (ar: AccountReceivable) => {
    console.log('生成催款话术:', ar);
    toast.success('催款话术已生成');
  };

  const handleGenerateReconciliation = (customerId: number, startDate: Date, endDate: Date) => {
    console.log('生成对账单:', { customerId, startDate, endDate });
    toast.success('对账单生成成功');
  };

  // 打开供应商付款对话框
  const handleOpenPaymentDialog = (payable: PayableItem) => {
    setSelectedPayable(payable);
    setPaymentAmount(payable.unpaid_amount?.toString() || '');
    setPaymentMethod('bank_transfer');
    setPaymentRemark('');
    setShowSupplierPaymentDialog(true);
  };

  // 提交供应商付款
  const handleSubmitSupplierPayment = async () => {
    if (!selectedPayable) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('请输入有效的付款金额');
      return;
    }

    if (amount > selectedPayable.unpaid_amount) {
      toast.error('付款金额不能超过未付金额');
      return;
    }

    setPaymentSubmitting(true);
    try {
      const result = await recordSupplierPayment(
        selectedPayable.supplier_id,
        amount,
        paymentMethod,
        undefined,
        paymentRemark || `付款：${selectedPayable.payable_no}`
      );

      if (result.success) {
        toast.success(result.message || '付款成功');
        setShowSupplierPaymentDialog(false);
        loadPayables(); // 刷新列表
        loadCashFlows(); // 刷新资金流水
      } else {
        toast.error(result.error || '付款失败');
      }
    } catch (error) {
      console.error('付款失败:', error);
      toast.error('付款失败');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // 加载应付账款
  const loadPayables = useCallback(async () => {
    setPayablesLoading(true);
    try {
      const [listResult, statsResult] = await Promise.all([
        getPayables('all'),
        getPayablesStatistics()
      ]);
      if (listResult.success && Array.isArray(listResult.data)) {
        setPayables(listResult.data);
      }
      if (statsResult.success && statsResult.data) {
        setPayablesStats(statsResult.data);
      }
    } catch (error) {
      console.error('加载应付账款失败:', error);
    } finally {
      setPayablesLoading(false);
    }
  }, []);

  // 加载资金流水
  const loadCashFlows = useCallback(async () => {
    setCashFlowLoading(true);
    try {
      const [accountsResult, flowsResult, summaryResult] = await Promise.all([
        getBankAccounts(),
        getCashFlows(),
        getCashFlowSummary()
      ]);
      if (accountsResult.success && Array.isArray(accountsResult.data)) {
        setBankAccounts(accountsResult.data);
      }
      if (flowsResult.success && Array.isArray(flowsResult.data)) {
        setCashFlows(flowsResult.data);
      }
      if (summaryResult.success && summaryResult.data) {
        setCashFlowSummary(summaryResult.data);
      }
    } catch (error) {
      console.error('加载资金流水失败:', error);
    } finally {
      setCashFlowLoading(false);
    }
  }, []);

  // 加载费用
  const loadExpenses = useCallback(async () => {
    setExpensesLoading(true);
    try {
      const [categoriesResult, expensesResult, summaryResult] = await Promise.all([
        getExpenseCategories(),
        getExpenses(),
        getExpensesSummary()
      ]);
      if (categoriesResult.success && Array.isArray(categoriesResult.data)) {
        setExpenseCategories(categoriesResult.data);
      }
      if (expensesResult.success && Array.isArray(expensesResult.data)) {
        setExpenses(expensesResult.data);
      }
      if (summaryResult.success && summaryResult.data) {
        setExpensesSummary(summaryResult.data);
      }
    } catch (error) {
      console.error('加载费用失败:', error);
    } finally {
      setExpensesLoading(false);
    }
  }, []);

  // 切换Tab时加载数据
  useEffect(() => {
    if (activeTab === 'payables' && payables.length === 0) {
      loadPayables();
    } else if (activeTab === 'cashflow' && cashFlows.length === 0) {
      loadCashFlows();
    } else if (activeTab === 'expenses' && expenses.length === 0) {
      loadExpenses();
    }
  }, [activeTab, payables.length, cashFlows.length, expenses.length, loadPayables, loadCashFlows, loadExpenses]);

  const tabs = [
    { id: 'receivables' as const, label: '应收明细', count: receivables.length, icon: TrendingUp },
    { id: 'payments' as const, label: '收款记录', count: paymentRecords.length, icon: DollarSign },
    { id: 'payables' as const, label: '应付账款', count: payables.filter(p => p.status !== 'paid').length, icon: TrendingDown },
    { id: 'cashflow' as const, label: '资金流水', count: cashFlows.length, icon: Wallet },
    { id: 'expenses' as const, label: '费用管理', count: expenses.length, icon: CreditCard },
    { id: 'reminders' as const, label: '催款管理', count: overdueAccounts.length, icon: FileText },
    { id: 'reconciliation' as const, label: '对账单', count: null, icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-4 md:p-6 lg:p-8">
      <Toaster position="top-right" />
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 - 珠宝风格 */}
        <div className="mb-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl shadow-lg shadow-emerald-200/50">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">财务对账</h1>
              <p className="text-gray-500 text-sm">管理应收账款、收款记录和对账单</p>
            </div>
          </div>
          <button
            onClick={() => { loadReceivables(); loadPaymentRecords(); }}
            disabled={loading || paymentsLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white 
              rounded-xl shadow-lg shadow-amber-200/50 hover:from-amber-600 hover:to-yellow-600 
              transition-all disabled:opacity-50 font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 统计卡片 */}
        <FinanceStatsCards statistics={mockStatistics} />

        {/* Tab标签页 - 下拉选择风格 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100/50 mb-6 overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-amber-50/30 p-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-gray-600 whitespace-nowrap">功能模块:</label>
              <select
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value as typeof activeTab)}
                className="flex-1 max-w-xs px-4 py-2.5 rounded-xl border border-amber-200 bg-white text-amber-700 
                           font-medium text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer
                           appearance-none bg-no-repeat bg-right pr-10"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23d97706'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                  backgroundSize: '1.5rem',
                  backgroundPosition: 'right 0.5rem center'
                }}
              >
                {tabs.map(tab => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label} {tab.count !== null ? `(${tab.count})` : ''}
                  </option>
                ))}
              </select>
              {/* 显示当前选中模块的图标 */}
              {(() => {
                const currentTab = tabs.find(t => t.id === activeTab);
                if (currentTab) {
                  const IconComponent = currentTab.icon;
                  return (
                    <div className="flex items-center gap-2 text-amber-600">
                      <IconComponent className="w-5 h-5" />
                      <span className="text-sm font-medium hidden sm:inline">{currentTab.label}</span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          {/* Tab内容 */}
          <div className="p-4 md:p-6">
            {activeTab === 'receivables' && (
              loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : (
                <AccountReceivableTable
                  data={receivables}
                  onRecordPayment={handleRecordPayment}
                  onRemind={handleRemind}
                  onFilterChange={handleReceivableFilterChange}
                  onPaymentSuccess={() => {
                    // 刷新列表
                    loadReceivables();
                    toast.success('收款记录已保存');
                  }}
                />
              )
            )}

            {activeTab === 'payments' && (
              paymentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : (
                <PaymentRecordTable
                  data={paymentRecords}
                  onAddPayment={handleAddPayment}
                  onViewDetail={handleViewPaymentDetail}
                  onFilterChange={handlePaymentFilterChange}
                />
              )
            )}

            {activeTab === 'reminders' && (
              <ReminderManagement
                overdueAccounts={overdueAccounts}
                onRecordReminder={handleRecordReminder}
                onGenerateScript={handleGenerateScript}
              />
            )}

            {activeTab === 'reconciliation' && (
              <ReconciliationGenerator
                customers={customers}
                onGenerate={handleGenerateReconciliation}
              />
            )}

            {/* 应付账款 Tab */}
            {activeTab === 'payables' && (
              payablesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 应付账款统计卡片 */}
                  {payablesStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border border-red-200">
                        <div className="text-red-600 text-sm font-medium">总应付</div>
                        <div className="text-2xl font-bold text-red-700">¥{payablesStats.total_payable?.toLocaleString()}</div>
                      </div>
                      <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border border-orange-200">
                        <div className="text-orange-600 text-sm font-medium">本月应付</div>
                        <div className="text-2xl font-bold text-orange-700">¥{payablesStats.month_payable?.toLocaleString()}</div>
                      </div>
                      <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-xl p-4 border border-rose-200">
                        <div className="text-rose-600 text-sm font-medium">逾期金额</div>
                        <div className="text-2xl font-bold text-rose-700">¥{payablesStats.overdue_amount?.toLocaleString()}</div>
                      </div>
                      <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
                        <div className="text-amber-600 text-sm font-medium">逾期供应商</div>
                        <div className="text-2xl font-bold text-amber-700">{payablesStats.overdue_suppliers}家</div>
                      </div>
                    </div>
                  )}

                  {/* 应付账款列表 */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-semibold text-gray-900">应付账款列表</h3>
                      <button
                        onClick={loadPayables}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        刷新
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">应付单号</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">供应商</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">入库单号</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">应付金额</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">已付金额</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">未付金额</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">到期日</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">状态</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {payables.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="px-4 py-8 text-center text-gray-500">暂无应付账款数据</td>
                            </tr>
                          ) : (
                            payables.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.payable_no}</td>
                                <td className="px-4 py-3 text-sm text-gray-700">{item.supplier_name}</td>
                                <td className="px-4 py-3 text-sm text-gray-500">{item.inbound_order_no || '-'}</td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900">¥{item.total_amount?.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-right text-green-600">¥{item.paid_amount?.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-right text-red-600 font-medium">¥{item.unpaid_amount?.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-center text-gray-500">{item.due_date}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-1 text-xs rounded-full ${item.status === 'paid' ? 'bg-green-100 text-green-700' :
                                      item.is_overdue ? 'bg-red-100 text-red-700' :
                                        item.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-gray-100 text-gray-700'
                                    }`}>
                                    {item.status === 'paid' ? '已付清' :
                                      item.is_overdue ? `逾期${item.overdue_days}天` :
                                        item.status === 'partial' ? '部分付款' : '待付款'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {item.status !== 'paid' && (
                                    <button
                                      onClick={() => handleOpenPaymentDialog(item)}
                                      className="px-3 py-1 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                                    >
                                      付款
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* 资金流水 Tab */}
            {activeTab === 'cashflow' && (
              cashFlowLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 账户余额卡片 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {cashFlowSummary && (
                      <>
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
                          <div className="text-blue-600 text-sm font-medium">账户总余额</div>
                          <div className="text-2xl font-bold text-blue-700">¥{cashFlowSummary.current_balance?.toLocaleString()}</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                          <div className="text-green-600 text-sm font-medium">总收入</div>
                          <div className="text-2xl font-bold text-green-700">¥{cashFlowSummary.total_income?.toLocaleString()}</div>
                        </div>
                        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border border-red-200">
                          <div className="text-red-600 text-sm font-medium">总支出</div>
                          <div className="text-2xl font-bold text-red-700">¥{cashFlowSummary.total_expense?.toLocaleString()}</div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                          <div className="text-purple-600 text-sm font-medium">净流入</div>
                          <div className="text-2xl font-bold text-purple-700">¥{cashFlowSummary.net_flow?.toLocaleString()}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 账户列表 */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 mb-4">账户列表</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {bankAccounts.length === 0 ? (
                        <div className="col-span-3 text-center text-gray-500 py-4">暂无账户，请先创建账户</div>
                      ) : (
                        bankAccounts.map((account) => (
                          <div key={account.id} className={`p-4 rounded-lg border ${account.is_default ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="font-medium text-gray-900">{account.account_name}</div>
                                <div className="text-xs text-gray-500">
                                  {account.account_type === 'bank' ? '银行账户' :
                                    account.account_type === 'cash' ? '现金' :
                                      account.account_type === 'alipay' ? '支付宝' : '微信'}
                                </div>
                              </div>
                              {account.is_default && <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">默认</span>}
                            </div>
                            <div className="mt-2 text-xl font-bold text-gray-900">¥{account.current_balance?.toLocaleString()}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 流水列表 */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-semibold text-gray-900">资金流水</h3>
                      <button
                        onClick={loadCashFlows}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        刷新
                      </button>
                    </div>
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">流水号</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">账户</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">类型</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">分类</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">余额</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">交易对方</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {cashFlows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无流水记录</td>
                            </tr>
                          ) : (
                            cashFlows.map((flow) => (
                              <tr key={flow.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{flow.flow_no}</td>
                                <td className="px-4 py-3 text-sm text-gray-700">{flow.account_name}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-0.5 text-xs rounded ${flow.flow_type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                    {flow.flow_type === 'income' ? '收入' : '支出'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{flow.category}</td>
                                <td className={`px-4 py-3 text-sm text-right font-medium ${flow.flow_type === 'income' ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                  {flow.flow_type === 'income' ? '+' : '-'}¥{flow.amount?.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900">¥{flow.balance_after?.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{flow.counterparty || '-'}</td>
                                <td className="px-4 py-3 text-sm text-center text-gray-500">{flow.flow_date?.split('T')[0]}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* 费用管理 Tab */}
            {activeTab === 'expenses' && (
              expensesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 费用汇总 */}
                  {expensesSummary?.details && Array.isArray(expensesSummary.details) && (
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold text-gray-900">本月费用汇总</h3>
                        <div className="text-xl font-bold text-red-600">¥{expensesSummary.total?.toLocaleString()}</div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {expensesSummary.details.map((item: any, idx: number) => (
                          <div key={idx} className="bg-gray-50 rounded-lg p-3">
                            <div className="text-sm text-gray-600">{item.category}</div>
                            <div className="text-lg font-semibold text-gray-900">¥{item.amount?.toLocaleString()}</div>
                            <div className="text-xs text-gray-500">{item.count}笔</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 费用列表 */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                      <h3 className="font-semibold text-gray-900">费用记录</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const result = await initExpenseCategories();
                            if (result.success) {
                              toast.success(result.message || '初始化成功');
                              loadExpenses();
                            }
                          }}
                          className="text-sm text-gray-600 hover:text-gray-700"
                        >
                          初始化类别
                        </button>
                        <button
                          onClick={loadExpenses}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          刷新
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">费用单号</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">类别</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">收款方</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">日期</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">状态</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">备注</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {expenses.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无费用记录</td>
                            </tr>
                          ) : (
                            expenses.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.expense_no}</td>
                                <td className="px-4 py-3 text-sm text-gray-700">{item.category_name}</td>
                                <td className="px-4 py-3 text-sm text-right text-red-600 font-medium">¥{item.amount?.toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{item.payee || '-'}</td>
                                <td className="px-4 py-3 text-sm text-center text-gray-500">{item.expense_date}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-1 text-xs rounded-full ${item.status === 'approved' ? 'bg-green-100 text-green-700' :
                                      item.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                        'bg-yellow-100 text-yellow-700'
                                    }`}>
                                    {item.status === 'approved' ? '已审批' :
                                      item.status === 'rejected' ? '已驳回' : '待审批'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500">{item.remark || '-'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 供应商付款对话框 */}
      {showSupplierPaymentDialog && selectedPayable && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">供应商付款</h3>
              <p className="text-sm text-gray-500 mt-1">应付单号：{selectedPayable.payable_no}</p>
            </div>

            <div className="p-6 space-y-4">
              {/* 供应商信息 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">供应商</span>
                  <span className="font-medium text-gray-900">{selectedPayable.supplier_name}</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">应付金额</span>
                  <span className="text-gray-900">¥{selectedPayable.total_amount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">已付金额</span>
                  <span className="text-green-600">¥{selectedPayable.paid_amount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">未付金额</span>
                  <span className="font-medium text-red-600">¥{selectedPayable.unpaid_amount?.toLocaleString()}</span>
                </div>
              </div>

              {/* 付款金额 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">付款金额</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="请输入付款金额"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 付款方式 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">付款方式</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="bank_transfer">银行转账</option>
                  <option value="cash">现金</option>
                  <option value="check">支票</option>
                  <option value="acceptance">承兑</option>
                </select>
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <input
                  type="text"
                  value={paymentRemark}
                  onChange={(e) => setPaymentRemark(e.target.value)}
                  placeholder="选填"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowSupplierPaymentDialog(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={paymentSubmitting}
              >
                取消
              </button>
              <button
                onClick={handleSubmitSupplierPayment}
                disabled={paymentSubmitting}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {paymentSubmitting ? '提交中...' : '确认付款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
