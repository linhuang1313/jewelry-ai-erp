import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { Search, Download, RefreshCw, Users, TrendingDown, Scale } from 'lucide-react';
import toast from 'react-hot-toast';

interface CustomerDebtItem {
  customer_id: number;
  customer_no: string;
  customer_name: string;
  phone: string;
  salesperson: string;
  cash_debt: number;
  net_gold: number;
  gold_debt: number;
  gold_deposit: number;
  gold_balance: number;
  total_debt: number;
  last_transaction_date: string | null;
}

interface DebtSummary {
  total_cash_debt: number;
  total_net_gold: number;
  total_gold_balance: number;
  customer_count: number;
}

interface Props {
  userRole?: string;
}

export const CustomerAccountPage: React.FC<Props> = ({ userRole = 'sales' }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CustomerDebtItem[]>([]);
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState('total_debt');
  const [sortOrder, setSortOrder] = useState('desc');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        hide_zero: 'true',
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: '500',
        user_role: userRole,
      });
      const res = await fetch(`${API_BASE_URL}/api/customers/debt-summary?${params}`);
      const data = await res.json();
      if (data.success && data.data) {
        setItems(data.data.items || []);
        setSummary(data.data.summary || null);
      } else {
        toast.error(data.message || '加载失败');
      }
    } catch (e: any) {
      toast.error('网络错误: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder, userRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 前端搜索过滤
  const filteredItems = items.filter(item => {
    if (!searchText.trim()) return true;
    const keyword = searchText.trim().toLowerCase();
    return (
      item.customer_name.toLowerCase().includes(keyword) ||
      (item.salesperson && item.salesperson.toLowerCase().includes(keyword)) ||
      (item.customer_no && item.customer_no.toLowerCase().includes(keyword))
    );
  });

  // 计算过滤后的汇总
  const filteredSummary = {
    total_cash_debt: filteredItems.reduce((sum, i) => sum + i.cash_debt, 0),
    total_net_gold: filteredItems.reduce((sum, i) => sum + i.net_gold, 0),
    customer_count: filteredItems.length,
  };

  const handleExport = async () => {
    try {
      toast.loading('正在生成Excel...', { id: 'export' });
      const res = await fetch(`${API_BASE_URL}/api/export/customer-account-summary`);
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename\*=UTF-8''(.+)/);
      a.download = filenameMatch ? decodeURIComponent(filenameMatch[1]) : '客户实时账目表.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('导出成功', { id: 'export' });
    } catch (e: any) {
      toast.error('导出失败: ' + e.message, { id: 'export' });
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-amber-600 ml-1">{sortOrder === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className="p-3 md:p-6 max-w-7xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">客户实时账目表</h1>
            <p className="text-sm text-gray-500">显示所有客户的欠料和欠款汇总</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center space-x-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>导出Excel</span>
          </button>
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-gray-500">客户数量</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {filteredSummary.customer_count}
            <span className="text-sm font-normal text-gray-400 ml-1">位</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Scale className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-gray-500">总欠料</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">
            {filteredSummary.total_net_gold.toFixed(3)}
            <span className="text-sm font-normal text-gray-400 ml-1">克</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center space-x-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-sm text-gray-500">总欠款</span>
          </div>
          <p className="text-2xl font-bold text-red-600">
            {filteredSummary.total_cash_debt.toFixed(2)}
            <span className="text-sm font-normal text-gray-400 ml-1">元</span>
          </p>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4">
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索客户名称、业务员、客户编号..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
            />
          </div>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-16">序号</th>
                  <th
                    className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('name')}
                  >
                    客户名称 <SortIcon field="name" />
                  </th>
                  <th
                    className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3 cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('gold_balance')}
                  >
                    欠料重量(克) <SortIcon field="gold_balance" />
                  </th>
                  <th
                    className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3 cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('cash_debt')}
                  >
                    欠款金额(元) <SortIcon field="cash_debt" />
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">业务员</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-gray-400">
                      {searchText ? '没有找到匹配的客户' : '暂无欠款/欠料客户'}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => (
                    <tr key={item.customer_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">{item.customer_name}</span>
                        {item.customer_no && (
                          <span className="ml-2 text-xs text-gray-400">{item.customer_no}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-medium ${
                          item.net_gold > 0 ? 'text-amber-600' : item.net_gold < 0 ? 'text-green-600' : 'text-gray-400'
                        }`}>
                          {item.net_gold > 0 ? '+' : ''}{item.net_gold.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-medium ${
                          item.cash_debt > 0 ? 'text-red-600' : item.cash_debt < 0 ? 'text-green-600' : 'text-gray-400'
                        }`}>
                          {item.cash_debt > 0 ? '' : ''}{item.cash_debt.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.salesperson || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredItems.length > 0 && (
                <tfoot>
                  <tr className="bg-amber-50/50 border-t-2 border-amber-200">
                    <td className="px-4 py-3 text-sm font-bold text-gray-700" colSpan={2}>
                      合计（{filteredSummary.customer_count} 位客户）
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-amber-700">
                      {filteredSummary.total_net_gold.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-700">
                      {filteredSummary.total_cash_debt.toFixed(2)}
                    </td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerAccountPage;
