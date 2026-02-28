import React, { useState, useCallback } from 'react';
import { Plus, Eye, Wallet, CreditCard, Smartphone, Building2, Banknote, Receipt, Calendar, Search } from 'lucide-react';
import { PaymentRecord, PaymentMethod } from '../../types/finance';

export interface PaymentFilterParams {
  startDate?: string;
  endDate?: string;
  salesOrderNo?: string;
}

interface PaymentRecordTableProps {
  data: PaymentRecord[];
  onAddPayment: () => void;
  onViewDetail: (record: PaymentRecord) => void;
  onFilterChange?: (params: PaymentFilterParams) => void;
}

export const PaymentRecordTable: React.FC<PaymentRecordTableProps> = ({
  data,
  onAddPayment,
  onViewDetail,
  onFilterChange,
}) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [salesOrderNo, setSalesOrderNo] = useState('');

  // 触发筛选
  const handleSearch = useCallback(() => {
    if (onFilterChange) {
      onFilterChange({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        salesOrderNo: salesOrderNo || undefined,
      });
    }
  }, [startDate, endDate, salesOrderNo, onFilterChange]);

  // 重置筛选
  const handleReset = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setSalesOrderNo('');
    if (onFilterChange) {
      onFilterChange({});
    }
  }, [onFilterChange]);
  const getPaymentMethodIcon = (method: PaymentMethod) => {
    switch (method) {
      case PaymentMethod.CASH:
        return <Banknote className="w-4 h-4" />;
      case PaymentMethod.BANK_TRANSFER:
        return <Building2 className="w-4 h-4" />;
      case PaymentMethod.WECHAT:
      case PaymentMethod.ALIPAY:
        return <Smartphone className="w-4 h-4" />;
      case PaymentMethod.CARD:
        return <CreditCard className="w-4 h-4" />;
      default:
        return <Wallet className="w-4 h-4" />;
    }
  };

  const getPaymentMethodText = (method: PaymentMethod) => {
    const methodMap: Record<PaymentMethod, string> = {
      [PaymentMethod.CASH]: '现金',
      [PaymentMethod.BANK_TRANSFER]: '银行转账',
      [PaymentMethod.WECHAT]: '微信',
      [PaymentMethod.ALIPAY]: '支付宝',
      [PaymentMethod.CARD]: '刷卡',
      [PaymentMethod.CHECK]: '支票',
      [PaymentMethod.OTHER]: '其他',
    };
    return methodMap[method] || '其他';
  };

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

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* 头部操作栏 */}
      <div className="p-4 border-b border-gray-200 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">收款记录</h3>
          <button
            onClick={onAddPayment}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors w-full sm:w-auto justify-center sm:justify-start"
          >
            <Plus className="w-4 h-4" />
            <span>新增收款</span>
          </button>
        </div>

        {/* 筛选控件 */}
        <div className="flex flex-col md:flex-row gap-4 items-end">
          {/* 时间范围 */}
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="开始日期"
            />
            <span className="text-gray-500">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="结束日期"
            />
          </div>

          {/* 销售单号 */}
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="搜索销售单号..."
              value={salesOrderNo}
              onChange={(e) => setSalesOrderNo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
            />
          </div>

          {/* 搜索和重置按钮 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
            >
              搜索
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                收款日期
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                客户名称
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                关联销售单
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                收款金额
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                收款方式
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                收款人
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                凭证
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <Receipt className="w-12 h-12 text-gray-400 mb-3" />
                    <p className="text-gray-500 text-sm">暂无收款记录</p>
                    <p className="text-gray-400 text-xs mt-1">点击右上角"新增收款"按钮添加收款记录</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(record.paymentDate)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {record.customer?.name || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 hover:text-blue-800 cursor-pointer">
                    {record.accountReceivable?.salesOrderNo || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-green-600 text-lg">
                    {formatCurrency(record.amount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center space-x-1 text-sm text-gray-700">
                      {getPaymentMethodIcon(record.paymentMethod)}
                      <span>{getPaymentMethodText(record.paymentMethod)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {record.operator}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {record.voucherImages ? (
                      <button
                        onClick={() => onViewDetail(record)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        查看
                      </button>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <button
                      onClick={() => onViewDetail(record)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs"
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

