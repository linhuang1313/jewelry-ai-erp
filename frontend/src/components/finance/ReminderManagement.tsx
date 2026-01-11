import React from 'react';
import { Phone, Sparkles, AlertCircle, Clock } from 'lucide-react';
import { AccountReceivable } from '../../types/finance';

interface ReminderManagementProps {
  overdueAccounts: AccountReceivable[];
  onRecordReminder: (ar: AccountReceivable) => void;
  onGenerateScript: (ar: AccountReceivable) => void;
}

export const ReminderManagement: React.FC<ReminderManagementProps> = ({
  overdueAccounts,
  onRecordReminder,
  onGenerateScript,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  // 按逾期天数倒序排列
  const sortedAccounts = [...overdueAccounts].sort((a, b) => b.overdueDays - a.overdueDays);

  return (
    <div className="space-y-4">
      {sortedAccounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">暂无逾期客户</p>
          <p className="text-gray-400 text-sm mt-2">所有应收账款都在正常账期内</p>
        </div>
      ) : (
        sortedAccounts.map((account) => (
          <div
            key={account.id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-4">
              {/* 左侧：客户头像占位符 */}
              <div className="flex-shrink-0">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-semibold">
                  {account.customer?.name?.charAt(0) || '客'}
                </div>
              </div>

              {/* 中间：客户信息 */}
              <div className="flex-1 w-full">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {account.customer?.name || '未知客户'}
                  </h3>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    逾期 {account.overdueDays} 天
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                  <div>
                    <span className="text-gray-500">欠款金额：</span>
                    <span className="font-semibold text-red-600">
                      {formatCurrency(account.unpaidAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">销售单号：</span>
                    <span className="text-blue-600">{account.salesOrder?.orderNo || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">到期日期：</span>
                    <span>{formatDate(account.dueDate)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  {account.customer?.phone && (
                    <div>
                      联系电话：{account.customer.phone}
                    </div>
                  )}
                  {account.updateTime && (
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>最后催款：{formatDate(account.updateTime)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：操作按钮 */}
              <div className="flex-shrink-0 flex flex-col sm:flex-row md:flex-col space-y-2 sm:space-y-0 sm:space-x-2 md:space-x-0 md:space-y-2">
                <button
                  onClick={() => onRecordReminder(account)}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium flex items-center justify-center space-x-2 whitespace-nowrap"
                >
                  <Phone className="w-4 h-4" />
                  <span>记录催款</span>
                </button>
                <button
                  onClick={() => onGenerateScript(account)}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm font-medium flex items-center justify-center space-x-2 whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>生成话术</span>
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};


import { AccountReceivable } from '../../types/finance';

interface ReminderManagementProps {
  overdueAccounts: AccountReceivable[];
  onRecordReminder: (ar: AccountReceivable) => void;
  onGenerateScript: (ar: AccountReceivable) => void;
}

export const ReminderManagement: React.FC<ReminderManagementProps> = ({
  overdueAccounts,
  onRecordReminder,
  onGenerateScript,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  // 按逾期天数倒序排列
  const sortedAccounts = [...overdueAccounts].sort((a, b) => b.overdueDays - a.overdueDays);

  return (
    <div className="space-y-4">
      {sortedAccounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">暂无逾期客户</p>
          <p className="text-gray-400 text-sm mt-2">所有应收账款都在正常账期内</p>
        </div>
      ) : (
        sortedAccounts.map((account) => (
          <div
            key={account.id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-4">
              {/* 左侧：客户头像占位符 */}
              <div className="flex-shrink-0">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-semibold">
                  {account.customer?.name?.charAt(0) || '客'}
                </div>
              </div>

              {/* 中间：客户信息 */}
              <div className="flex-1 w-full">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {account.customer?.name || '未知客户'}
                  </h3>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    逾期 {account.overdueDays} 天
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                  <div>
                    <span className="text-gray-500">欠款金额：</span>
                    <span className="font-semibold text-red-600">
                      {formatCurrency(account.unpaidAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">销售单号：</span>
                    <span className="text-blue-600">{account.salesOrder?.orderNo || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">到期日期：</span>
                    <span>{formatDate(account.dueDate)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  {account.customer?.phone && (
                    <div>
                      联系电话：{account.customer.phone}
                    </div>
                  )}
                  {account.updateTime && (
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>最后催款：{formatDate(account.updateTime)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：操作按钮 */}
              <div className="flex-shrink-0 flex flex-col sm:flex-row md:flex-col space-y-2 sm:space-y-0 sm:space-x-2 md:space-x-0 md:space-y-2">
                <button
                  onClick={() => onRecordReminder(account)}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium flex items-center justify-center space-x-2 whitespace-nowrap"
                >
                  <Phone className="w-4 h-4" />
                  <span>记录催款</span>
                </button>
                <button
                  onClick={() => onGenerateScript(account)}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm font-medium flex items-center justify-center space-x-2 whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>生成话术</span>
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

