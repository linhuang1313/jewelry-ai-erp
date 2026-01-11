import React, { useState, useMemo } from 'react';
import { Search, Filter, ArrowUpDown, AlertCircle } from 'lucide-react';
import { AccountReceivable, AccountReceivableStatus } from '../../types/finance';
import { PaymentDialog } from './PaymentDialog';

interface AccountReceivableTableProps {
  data: AccountReceivable[];
  onRecordPayment: (ar: AccountReceivable) => void;
  onRemind: (ar: AccountReceivable) => void;
  onPaymentSuccess?: () => void;
}

type FilterType = 'all' | 'unpaid' | 'overdue' | 'due_this_month';
type SortType = 'amount' | 'overdue_days' | 'due_date';

export const AccountReceivableTable: React.FC<AccountReceivableTableProps> = ({
  data,
  onRecordPayment,
  onRemind,
  onPaymentSuccess,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('overdue_days');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedReceivable, setSelectedReceivable] = useState<AccountReceivable | null>(null);

  const filteredAndSortedData = useMemo(() => {
    let filtered = [...data];

    // 搜索过滤
    if (searchTerm) {
      filtered = filtered.filter(
        (item) =>
          item.customer?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.salesOrder?.orderNo.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // 状态过滤
    if (filter === 'unpaid') {
      filtered = filtered.filter((item) => item.status === AccountReceivableStatus.UNPAID);
    } else if (filter === 'overdue') {
      filtered = filtered.filter((item) => item.isOverdue);
    } else if (filter === 'due_this_month') {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      filtered = filtered.filter(
        (item) => item.dueDate >= now && item.dueDate <= endOfMonth && !item.isOverdue
      );
    }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'amount') {
        comparison = a.unpaidAmount - b.unpaidAmount;
      } else if (sortBy === 'overdue_days') {
        comparison = a.overdueDays - b.overdueDays;
      } else if (sortBy === 'due_date') {
        comparison = a.dueDate.getTime() - b.dueDate.getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [data, filter, searchTerm, sortBy, sortOrder]);

  const getStatusBadge = (status: AccountReceivableStatus, isOverdue: boolean) => {
    if (isOverdue) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
          已逾期
        </span>
      );
    }
    if (status === AccountReceivableStatus.PAID) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
          已付清
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
        部分付款
      </span>
    );
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
      {/* 筛选器 */}
      <div className="p-4 border-b border-gray-200 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* 状态筛选 */}
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="unpaid">未付清</option>
              <option value="overdue">已逾期</option>
              <option value="due_this_month">本月到期</option>
            </select>
          </div>

          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索客户名称或销售单号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 排序 */}
          <div className="flex items-center space-x-2">
            <ArrowUpDown className="w-4 h-4 text-gray-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="overdue_days">按逾期天数</option>
              <option value="amount">按欠款金额</option>
              <option value="due_date">按到期日期</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
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
                客户名称
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                销售单号
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                销售日期
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                应收金额
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                已收金额
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                未收金额
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                到期日期
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                逾期天数
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                状态
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAndSortedData.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <Search className="w-12 h-12 text-gray-400 mb-3" />
                    <p className="text-gray-500 text-sm">暂无符合条件的应收账款记录</p>
                    <p className="text-gray-400 text-xs mt-1">请尝试调整筛选条件或搜索关键词</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredAndSortedData.map((item) => (
                <tr
                  key={item.id}
                  className={`hover:bg-gray-50 transition-colors ${
                    item.isOverdue ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.customer?.name || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 hover:text-blue-800 cursor-pointer">
                    {item.salesOrder?.orderNo || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {item.salesOrder?.orderDate ? formatDate(item.salesOrder.orderDate) : '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                    {formatCurrency(item.totalAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                    {formatCurrency(item.receivedAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                    {formatCurrency(item.unpaidAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(item.dueDate)}
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-center font-semibold ${
                      item.overdueDays > 0 ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {item.overdueDays > 0 ? (
                      <span className="flex items-center justify-center space-x-1">
                        <AlertCircle className="w-4 h-4" />
                        <span>{item.overdueDays} 天</span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {getStatusBadge(item.status, item.isOverdue)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm">
                    <div className="flex items-center justify-center space-x-2 flex-wrap gap-1">
                      <button
                        onClick={() => {
                          setSelectedReceivable(item);
                          setPaymentDialogOpen(true);
                        }}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-xs whitespace-nowrap"
                      >
                        记录收款
                      </button>
                      <button
                        onClick={() => onRemind(item)}
                        className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors text-xs whitespace-nowrap"
                      >
                        催款
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 收款弹窗 */}
      {selectedReceivable && (
        <PaymentDialog
          isOpen={paymentDialogOpen}
          onClose={() => {
            setPaymentDialogOpen(false);
            setSelectedReceivable(null);
          }}
          customerId={selectedReceivable.customerId}
          customerName={selectedReceivable.customer?.name || ''}
          receivableId={selectedReceivable.id}
          receivable={selectedReceivable}
          unpaidReceivables={data.filter(
            (ar) =>
              ar.customerId === selectedReceivable.customerId &&
              ar.unpaidAmount > 0 &&
              ar.status !== AccountReceivableStatus.PAID
          )}
          onSuccess={() => {
            onPaymentSuccess?.();
            setPaymentDialogOpen(false);
            setSelectedReceivable(null);
          }}
        />
      )}
    </div>
  );
};


import { AccountReceivable, AccountReceivableStatus } from '../../types/finance';
import { PaymentDialog } from './PaymentDialog';

interface AccountReceivableTableProps {
  data: AccountReceivable[];
  onRecordPayment: (ar: AccountReceivable) => void;
  onRemind: (ar: AccountReceivable) => void;
  onPaymentSuccess?: () => void;
}

type FilterType = 'all' | 'unpaid' | 'overdue' | 'due_this_month';
type SortType = 'amount' | 'overdue_days' | 'due_date';

export const AccountReceivableTable: React.FC<AccountReceivableTableProps> = ({
  data,
  onRecordPayment,
  onRemind,
  onPaymentSuccess,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('overdue_days');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedReceivable, setSelectedReceivable] = useState<AccountReceivable | null>(null);

  const filteredAndSortedData = useMemo(() => {
    let filtered = [...data];

    // 搜索过滤
    if (searchTerm) {
      filtered = filtered.filter(
        (item) =>
          item.customer?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.salesOrder?.orderNo.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // 状态过滤
    if (filter === 'unpaid') {
      filtered = filtered.filter((item) => item.status === AccountReceivableStatus.UNPAID);
    } else if (filter === 'overdue') {
      filtered = filtered.filter((item) => item.isOverdue);
    } else if (filter === 'due_this_month') {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      filtered = filtered.filter(
        (item) => item.dueDate >= now && item.dueDate <= endOfMonth && !item.isOverdue
      );
    }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'amount') {
        comparison = a.unpaidAmount - b.unpaidAmount;
      } else if (sortBy === 'overdue_days') {
        comparison = a.overdueDays - b.overdueDays;
      } else if (sortBy === 'due_date') {
        comparison = a.dueDate.getTime() - b.dueDate.getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [data, filter, searchTerm, sortBy, sortOrder]);

  const getStatusBadge = (status: AccountReceivableStatus, isOverdue: boolean) => {
    if (isOverdue) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
          已逾期
        </span>
      );
    }
    if (status === AccountReceivableStatus.PAID) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
          已付清
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
        部分付款
      </span>
    );
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
      {/* 筛选器 */}
      <div className="p-4 border-b border-gray-200 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* 状态筛选 */}
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="unpaid">未付清</option>
              <option value="overdue">已逾期</option>
              <option value="due_this_month">本月到期</option>
            </select>
          </div>

          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索客户名称或销售单号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 排序 */}
          <div className="flex items-center space-x-2">
            <ArrowUpDown className="w-4 h-4 text-gray-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="overdue_days">按逾期天数</option>
              <option value="amount">按欠款金额</option>
              <option value="due_date">按到期日期</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
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
                客户名称
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                销售单号
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                销售日期
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                应收金额
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                已收金额
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                未收金额
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                到期日期
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                逾期天数
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                状态
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredAndSortedData.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <Search className="w-12 h-12 text-gray-400 mb-3" />
                    <p className="text-gray-500 text-sm">暂无符合条件的应收账款记录</p>
                    <p className="text-gray-400 text-xs mt-1">请尝试调整筛选条件或搜索关键词</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredAndSortedData.map((item) => (
                <tr
                  key={item.id}
                  className={`hover:bg-gray-50 transition-colors ${
                    item.isOverdue ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.customer?.name || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 hover:text-blue-800 cursor-pointer">
                    {item.salesOrder?.orderNo || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {item.salesOrder?.orderDate ? formatDate(item.salesOrder.orderDate) : '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                    {formatCurrency(item.totalAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                    {formatCurrency(item.receivedAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                    {formatCurrency(item.unpaidAmount)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(item.dueDate)}
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-center font-semibold ${
                      item.overdueDays > 0 ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {item.overdueDays > 0 ? (
                      <span className="flex items-center justify-center space-x-1">
                        <AlertCircle className="w-4 h-4" />
                        <span>{item.overdueDays} 天</span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    {getStatusBadge(item.status, item.isOverdue)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm">
                    <div className="flex items-center justify-center space-x-2 flex-wrap gap-1">
                      <button
                        onClick={() => {
                          setSelectedReceivable(item);
                          setPaymentDialogOpen(true);
                        }}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-xs whitespace-nowrap"
                      >
                        记录收款
                      </button>
                      <button
                        onClick={() => onRemind(item)}
                        className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors text-xs whitespace-nowrap"
                      >
                        催款
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 收款弹窗 */}
      {selectedReceivable && (
        <PaymentDialog
          isOpen={paymentDialogOpen}
          onClose={() => {
            setPaymentDialogOpen(false);
            setSelectedReceivable(null);
          }}
          customerId={selectedReceivable.customerId}
          customerName={selectedReceivable.customer?.name || ''}
          receivableId={selectedReceivable.id}
          receivable={selectedReceivable}
          unpaidReceivables={data.filter(
            (ar) =>
              ar.customerId === selectedReceivable.customerId &&
              ar.unpaidAmount > 0 &&
              ar.status !== AccountReceivableStatus.PAID
          )}
          onSuccess={() => {
            onPaymentSuccess?.();
            setPaymentDialogOpen(false);
            setSelectedReceivable(null);
          }}
        />
      )}
    </div>
  );
};

