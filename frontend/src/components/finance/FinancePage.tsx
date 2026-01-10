import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { FinanceStatsCards } from './FinanceStatsCards';
import { AccountReceivableTable } from './AccountReceivableTable';
import { PaymentRecordTable } from './PaymentRecordTable';
import { ReminderManagement } from './ReminderManagement';
import { ReconciliationGenerator } from './ReconciliationGenerator';
import {
  mockStatistics,
  mockAccountReceivables,
  mockPaymentRecords,
} from '../../mockFinanceData';
import {
  AccountReceivable,
  PaymentRecord,
  CustomerReference,
} from '../../types/finance';

export const FinancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'receivables' | 'payments' | 'reminders' | 'reconciliation'>('receivables');

  // 获取逾期客户列表
  const overdueAccounts = mockAccountReceivables.filter((ar) => ar.isOverdue);

  // 获取客户列表（从应收账款中提取）
  const customers: CustomerReference[] = Array.from(
    new Map(
      mockAccountReceivables
        .map((ar) => [ar.customerId, ar.customer!])
        .filter(([_, customer]) => customer)
    ).values()
  );

  const handleRecordPayment = (ar: AccountReceivable) => {
    console.log('记录收款:', ar);
    // TODO: 打开收款记录弹窗
    alert(`记录收款：${ar.customer?.name} - ${ar.salesOrder?.orderNo}`);
  };

  const handleRemind = (ar: AccountReceivable) => {
    console.log('催款:', ar);
    // TODO: 打开催款记录弹窗
    alert(`催款：${ar.customer?.name} - 逾期${ar.overdueDays}天`);
  };

  const handleAddPayment = () => {
    console.log('新增收款');
    // TODO: 打开新增收款弹窗
    alert('打开新增收款弹窗');
  };

  const handleViewPaymentDetail = (record: PaymentRecord) => {
    console.log('查看收款详情:', record);
    // TODO: 打开收款详情弹窗
    alert(`查看收款详情：${record.id}`);
  };

  const handleRecordReminder = (ar: AccountReceivable) => {
    console.log('记录催款:', ar);
    // TODO: 打开催款记录弹窗
    alert(`记录催款：${ar.customer?.name}`);
  };

  const handleGenerateScript = (ar: AccountReceivable) => {
    console.log('生成催款话术:', ar);
    // TODO: 调用AI生成催款话术
    alert(`生成催款话术：${ar.customer?.name}`);
  };

  const handleGenerateReconciliation = (customerId: number, startDate: Date, endDate: Date) => {
    console.log('生成对账单:', { customerId, startDate, endDate });
    // TODO: 调用API生成对账单
    alert(`生成对账单：客户ID ${customerId}`);
  };

  const tabs = [
    { id: 'receivables' as const, label: '应收明细', count: mockAccountReceivables.length },
    { id: 'payments' as const, label: '收款记录', count: mockPaymentRecords.length },
    { id: 'reminders' as const, label: '催款管理', count: overdueAccounts.length },
    { id: 'reconciliation' as const, label: '对账单', count: null },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <Toaster position="top-right" />
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">财务对账</h1>
          <p className="text-gray-600 mt-2 text-sm md:text-base">管理应收账款、收款记录、催款和对账单</p>
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
              <AccountReceivableTable
                data={mockAccountReceivables}
                onRecordPayment={handleRecordPayment}
                onRemind={handleRemind}
                onPaymentSuccess={() => {
                  // 刷新列表的逻辑，这里可以重新获取数据
                  console.log('收款成功，刷新列表');
                  // TODO: 实际应该重新获取应收账款列表
                }}
              />
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

