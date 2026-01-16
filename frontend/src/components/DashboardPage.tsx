import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  TrendingUp, TrendingDown, Package, Users, ShoppingBag, DollarSign,
  RefreshCw, Calendar, BarChart3, PieChart as PieChartIcon, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import toast from 'react-hot-toast';

// 颜色配置
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// 指标卡片组件
interface MetricCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  change?: number;
  icon: React.ReactNode;
  color: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subValue, change, icon, color }) => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-gray-500 mb-1">{title}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {subValue && <p className="text-xs text-gray-400 mt-1">{subValue}</p>}
      </div>
      <div className={`p-3 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100')}`}>
        {icon}
      </div>
    </div>
    {change !== undefined && (
      <div className="mt-3 flex items-center text-sm">
        {change >= 0 ? (
          <>
            <ArrowUpRight className="w-4 h-4 text-green-500" />
            <span className="text-green-500 font-medium">+{change.toFixed(1)}%</span>
          </>
        ) : (
          <>
            <ArrowDownRight className="w-4 h-4 text-red-500" />
            <span className="text-red-500 font-medium">{change.toFixed(1)}%</span>
          </>
        )}
        <span className="text-gray-400 ml-1">较昨日</span>
      </div>
    )}
  </div>
);

// 主组件
const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState(30);

  // 加载仪表盘数据
  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      // 并行请求所有数据
      const [summaryRes, trendsRes, productsRes, salespersonRes] = await Promise.all([
        fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/dashboard/summary`),
        fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/sales/trends?days=${timeRange}&period=day`),
        fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/sales/top-products?days=${timeRange}&limit=5`),
        fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/sales/salesperson-performance?days=${timeRange}`)
      ]);

      const [summaryData, trendsData, productsData, salespersonData] = await Promise.all([
        summaryRes.json(),
        trendsRes.json(),
        productsRes.json(),
        salespersonRes.json()
      ]);

      if (summaryData.success) setSummary(summaryData.data);
      if (trendsData.success) setTrends(trendsData.data.trends || []);
      if (productsData.success) setTopProducts(productsData.data.products || []);
      if (salespersonData.success) setSalespersons(salespersonData.data.salespersons || []);

    } catch (error) {
      console.error('加载仪表盘数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // 格式化金额
  const formatAmount = (amount: number) => {
    if (amount >= 10000) {
      return `¥${(amount / 10000).toFixed(2)}万`;
    }
    return `¥${amount.toFixed(2)}`;
  };

  // 格式化日期（只显示月-日）
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length >= 3) {
      return `${parts[1]}-${parts[2]}`;
    }
    return dateStr;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500">加载中...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">数据仪表盘</h1>
          <p className="text-sm text-gray-500 mt-1">实时业务数据概览</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 时间范围选择 */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
          </select>
          <button
            onClick={loadDashboardData}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* 关键指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <MetricCard
          title="今日销售额"
          value={formatAmount(summary?.today?.sales_amount || 0)}
          subValue={`${summary?.today?.order_count || 0}单 / ${(summary?.today?.sales_weight || 0).toFixed(1)}g`}
          change={summary?.today?.change_percent}
          icon={<DollarSign className="w-6 h-6 text-blue-600" />}
          color="text-blue-600"
        />
        <MetricCard
          title="本月销售额"
          value={formatAmount(summary?.month?.sales_amount || 0)}
          subValue={`${summary?.month?.order_count || 0}单 / ${(summary?.month?.sales_weight || 0).toFixed(1)}g`}
          change={summary?.month?.change_percent}
          icon={<TrendingUp className="w-6 h-6 text-green-600" />}
          color="text-green-600"
        />
        <MetricCard
          title="库存总量"
          value={`${(summary?.inventory?.total_weight || 0).toFixed(1)}g`}
          icon={<Package className="w-6 h-6 text-amber-600" />}
          color="text-amber-600"
        />
        <MetricCard
          title="本月新客户"
          value={summary?.new_customers || 0}
          subValue={summary?.pending?.settlements > 0 ? `${summary.pending.settlements}单待结算` : undefined}
          icon={<Users className="w-6 h-6 text-purple-600" />}
          color="text-purple-600"
        />
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 销售趋势图 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              销售趋势
            </h3>
          </div>
          <div className="h-72">
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={formatDate}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                    labelFormatter={(label) => `日期: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="total_amount" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ fill: '#3B82F6', strokeWidth: 2, r: 3 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                暂无销售数据
              </div>
            )}
          </div>
        </div>

        {/* 热销商品TOP5 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-green-500" />
              热销商品 TOP5
            </h3>
          </div>
          <div className="h-72">
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tickFormatter={(v) => `¥${v}`} tick={{ fontSize: 12 }} />
                  <YAxis 
                    type="category" 
                    dataKey="product_name" 
                    width={100}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v.length > 8 ? v.substring(0, 8) + '...' : v}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                  />
                  <Bar dataKey="total_amount" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                暂无商品数据
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 业务员业绩 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-500" />
            业务员业绩排行
          </h3>
        </div>
        {salespersons.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">排名</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">业务员</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">销售额</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">销售克重</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">订单数</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">客户数</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">客单价</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {salespersons.map((sp, idx) => (
                  <tr key={sp.salesperson} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                        idx === 1 ? 'bg-gray-100 text-gray-700' :
                        idx === 2 ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{sp.salesperson || '未知'}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-semibold">
                      {formatAmount(sp.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{sp.total_weight.toFixed(1)}g</td>
                    <td className="px-4 py-3 text-right text-gray-700">{sp.order_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{sp.customer_count}</td>
                    <td className="px-4 py-3 text-right text-blue-600">{formatAmount(sp.avg_order_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            暂无业务员业绩数据
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;

