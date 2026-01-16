import React, { useState, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { FinanceStatsCards } from './FinanceStatsCards';
import { AccountReceivableTable } from './AccountReceivableTable';
import { PaymentRecordTable } from './PaymentRecordTable';
import { ReminderManagement } from './ReminderManagement';
import { ReconciliationGenerator } from './ReconciliationGenerator';
import { getReceivables, ReceivableItem } from '../../services/financeService';
import {
  mockStatistics,
  mockPaymentRecords,
} from '../../mockFinanceData';
import {
  AccountReceivable,
  AccountReceivableStatus,
  PaymentRecord,
  CustomerReference,
} from '../../types/finance';

export const FinancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'receivables' | 'payments' | 'reminders' | 'reconciliation'>('receivables');
  const [receivables, setReceivables] = useState<AccountReceivable[]>([]);
  const [loading, setLoading] = useState(false);

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
      creditStartDate: new Date(item.creditStartDate),
      dueDate: new Date(item.dueDate),
      customer: item.customer ? {
        id: item.customer.id,
        customerNo: item.customer.customerNo,
        name: item.customer.name,
        phone: item.customer.phone,
      } : undefined,
      salesOrder: item.salesOrder ? {
        id: item.salesOrder.id,
        orderNo: item.salesOrder.orderNo,
        orderDate: new Date(item.salesOrder.orderDate),
        salesperson: item.salesOrder.salesperson,
        totalAmount: item.salesOrder.totalAmount,
      } : undefined,
    };
  };

  // 加载应收账款数据
  const loadReceivables = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getReceivables('all', undefined, 'overdue_days', 'desc', 0, 200);
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
  }, []);

  // 初始加载
  useEffect(() => {
    loadReceivables();
  }, [loadReceivables]);

  // 获取逾期客户列表
  const overdueAccounts = receivables.filter((ar) => ar.isOverdue);

  // 获取客户列表（从应收账款中提取）
  const customers: CustomerReference[] = Array.from(
    new Map(
      receivables
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
    { id: 'payments' as const, label: '收款记录', count: mockPaymentRecords.length },
    { id: 'reminders' as const, label: '催款管理', count: overdueAccounts.length },
    { id: 'reconciliation' as const, label: '对账单', count: null },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <Toaster position="top-right" />
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">财务对账</h1>
            <p className="text-gray-600 mt-2 text-sm md:text-base">管理应收账款、收款记录、催款和对账单</p>
          </div>
          <button
            onClick={loadReceivables}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 统计卡片 */}
        <FinanceStatsCards statistics={mockStatistics} />

        {/* Tab标签页 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6 overflow-x-auto" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap
                    ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  {tab.label}
                  {tab.count !== null && (
                    <span
                      className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                        activeTab === tab.id
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-100 text-gray-600'
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
                  onPaymentSuccess={() => {
                    // 刷新列表
                    loadReceivables();
                    toast.success('收款记录已保存');
                  }}
                />
              )
            )}

            {activeTab === 'payments' && (
              <PaymentRecordTable
                data={mockPaymentRecords}
                onAddPayment={handleAddPayment}
                onViewDetail={handleViewPaymentDetail}
              />
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
