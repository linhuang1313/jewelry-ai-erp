import React, { useState, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { FinanceStatsCards } from './FinanceStatsCards';
import { AccountReceivableTable, ReceivableFilterParams } from './AccountReceivableTable';
import { PaymentRecordTable, PaymentFilterParams } from './PaymentRecordTable';
import { ReminderManagement } from './ReminderManagement';
import { ReconciliationGenerator } from './ReconciliationGenerator';
import { getReceivables, ReceivableItem, getPaymentRecords, PaymentRecordItem } from '../../services/financeService';
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
  const [activeTab, setActiveTab] = useState<'receivables' | 'payments' | 'reminders' | 'reconciliation'>('receivables');
  const [receivables, setReceivables] = useState<AccountReceivable[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

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
      status: item.status === 'paid' ? AccountReceivableStatus.PAID :
              item.status === 'overdue' ? AccountReceivableStatus.OVERDUE :
              AccountReceivableStatus.UNPAID,
      isOverdue: item.isOverdue,
      overdueDays: item.overdueDays,
      creditStartDate: safeParseDate(item.creditStartDate),
      dueDate: safeParseDate(item.dueDate),
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
        salesperson: item.salesOrder.salesperson,
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
        const converted = result.data.map(convertReceivable);
        setReceivables(converted);
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
      if (result.success && result.data) {
        const converted = result.data.map(convertPaymentRecord);
        setPaymentRecords(converted);
      } else {
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
  const customers: CustomerReference[] = Array.from(
    new Map(
      (Array.isArray(receivables) ? receivables : [])
        .map((ar) => [ar.customerId, ar.customer!])
        .filter(([_, customer]) => customer)
    ).values()
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

  const tabs = [
    { id: 'receivables' as const, label: '应收明细', count: receivables.length },
    { id: 'payments' as const, label: '收款记录', count: paymentRecords.length },
    { id: 'reminders' as const, label: '催款管理', count: overdueAccounts.length },
    { id: 'reconciliation' as const, label: '对账单', count: null },
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

        {/* Tab标签页 - 珠宝风格 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100/50 mb-6 overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-amber-50/30">
            <nav className="flex space-x-1 p-2 overflow-x-auto" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    py-2.5 px-4 rounded-xl font-medium text-sm transition-all whitespace-nowrap
                    ${
                      activeTab === tab.id
                        ? 'bg-white text-amber-700 shadow-sm border border-amber-100'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }
                  `}
                >
                  {tab.label}
                  {tab.count !== null && (
                    <span
                      className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                        activeTab === tab.id
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
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
          </div>
        </div>
      </div>
    </div>
  );
};
