import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  TrendingUp, Package, Users, ShoppingBag, DollarSign,
  RefreshCw, ArrowUpRight, ArrowDownRight, Sparkles, Crown, Award
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import toast from 'react-hot-toast';

// 珠宝行业配色
const JEWELRY_COLORS = {
  gold: '#C9A86C',
  goldLight: '#D4AF37',
  goldDark: '#B8860B',
  navy: '#1E3A5F',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  purple: '#8B5CF6'
};

// 指标卡片组件 - 珠宝风格
interface MetricCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  change?: number;
  icon: React.ReactNode;
  gradient: string;
  iconBg: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subValue, change, icon, gradient, iconBg }) => (
  <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient} 
    shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5`}>
    {/* 装饰性背景 */}
    <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
      <div className="absolute inset-0 bg-white rounded-full transform translate-x-8 -translate-y-8" />
    </div>
    
    <div className="relative flex items-start justify-between">
      <div>
        <p className="text-sm font-medium opacity-80 mb-1">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
        {subValue && <p className="text-xs opacity-70 mt-1">{subValue}</p>}
      </div>
      <div className={`p-3 rounded-xl ${iconBg} shadow-sm`}>
        {icon}
      </div>
    </div>
    
    {change !== undefined && (
      <div className="mt-3 flex items-center text-sm">
        {change >= 0 ? (
          <>
            <ArrowUpRight className="w-4 h-4" />
            <span className="font-semibold">+{change.toFixed(1)}%</span>
          </>
        ) : (
          <>
            <ArrowDownRight className="w-4 h-4" />
            <span className="font-semibold">{change.toFixed(1)}%</span>
          </>
        )}
        <span className="opacity-70 ml-1">较昨日</span>
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

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
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

  const formatAmount = (amount: number) => {
    if (amount >= 10000) {
      return `¥${(amount / 10000).toFixed(2)}万`;
    }
    return `¥${amount.toFixed(2)}`;
  };

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
      <div className="flex flex-col items-center justify-center h-96">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-amber-200 rounded-full animate-pulse" />
          <Sparkles className="w-8 h-8 text-amber-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-spin" />
        </div>
        <p className="mt-4 text-gray-500 font-medium">加载数据中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50">
      {/* 页面头部 - 珠宝风格 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-amber-100/50 sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-amber-400 to-yellow-500 rounded-xl shadow-lg shadow-amber-200/50">
                <Crown className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">数据仪表盘</h1>
                <p className="text-xs text-gray-500">实时业务数据概览</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(Number(e.target.value))}
                className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm 
                  focus:ring-2 focus:ring-amber-500 focus:border-amber-500 
                  shadow-sm hover:border-amber-300 transition-colors"
              >
                <option value={7}>最近7天</option>
                <option value={30}>最近30天</option>
                <option value={90}>最近90天</option>
              </select>
              <button
                onClick={loadDashboardData}
                className="flex items-center gap-2 px-4 py-2 
                  bg-gradient-to-r from-amber-500 to-yellow-500 text-white 
                  rounded-xl shadow-lg shadow-amber-200/50
                  hover:from-amber-600 hover:to-yellow-600 
                  active:scale-95 transition-all duration-200 font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                刷新
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* 关键指标卡片 - 渐变背景 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          <MetricCard
            title="今日销售额"
            value={formatAmount(summary?.today?.sales_amount || 0)}
            subValue={`${summary?.today?.order_count || 0}单 / ${(summary?.today?.sales_weight || 0).toFixed(1)}g`}
            change={summary?.today?.change_percent}
            gradient="bg-gradient-to-br from-amber-400 to-yellow-500 text-white"
            iconBg="bg-white/20"
            icon={<DollarSign className="w-6 h-6 text-white" />}
          />
          <MetricCard
            title="本月销售额"
            value={formatAmount(summary?.month?.sales_amount || 0)}
            subValue={`${summary?.month?.order_count || 0}单 / ${(summary?.month?.sales_weight || 0).toFixed(1)}g`}
            change={summary?.month?.change_percent}
            gradient="bg-gradient-to-br from-emerald-500 to-teal-500 text-white"
            iconBg="bg-white/20"
            icon={<TrendingUp className="w-6 h-6 text-white" />}
          />
          <MetricCard
            title="库存总量"
            value={`${(summary?.inventory?.total_weight || 0).toFixed(1)}g`}
            gradient="bg-gradient-to-br from-blue-500 to-indigo-500 text-white"
            iconBg="bg-white/20"
            icon={<Package className="w-6 h-6 text-white" />}
          />
          <MetricCard
            title="本月新客户"
            value={summary?.new_customers || 0}
            subValue={summary?.pending?.settlements > 0 ? `${summary.pending.settlements}单待结算` : undefined}
            gradient="bg-gradient-to-br from-purple-500 to-pink-500 text-white"
            iconBg="bg-white/20"
            icon={<Users className="w-6 h-6 text-white" />}
          />
        </div>

        {/* 图表区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 销售趋势图 - 面积图 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100/50 p-6 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900">销售趋势</h3>
            </div>
            <div className="h-72">
              {trends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={JEWELRY_COLORS.gold} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={JEWELRY_COLORS.gold} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={formatDate}
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      axisLine={{ stroke: '#E5E7EB' }}
                    />
                    <YAxis 
                      tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      axisLine={{ stroke: '#E5E7EB' }}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                      labelFormatter={(label) => `日期: ${label}`}
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: 'none', 
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                        padding: '12px'
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="total_amount" 
                      stroke={JEWELRY_COLORS.gold}
                      strokeWidth={2}
                      fill="url(#colorAmount)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Package className="w-12 h-12 mb-2 opacity-50" />
                  <span>暂无销售数据</span>
                </div>
              )}
            </div>
          </div>

          {/* 热销商品TOP5 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100/50 p-6 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 bg-gradient-to-br from-green-100 to-emerald-100 rounded-lg">
                <ShoppingBag className="w-5 h-5 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-900">热销商品 TOP5</h3>
            </div>
            <div className="h-72">
              {topProducts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} layout="vertical">
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={JEWELRY_COLORS.gold} />
                        <stop offset="100%" stopColor={JEWELRY_COLORS.goldLight} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis 
                      type="number" 
                      tickFormatter={(v) => `¥${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} 
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                    />
                    <YAxis 
                      type="category" 
                      dataKey="product_name" 
                      width={100}
                      tick={{ fontSize: 11, fill: '#374151' }}
                      tickFormatter={(v) => v.length > 8 ? v.substring(0, 8) + '...' : v}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: 'none', 
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                        padding: '12px'
                      }}
                    />
                    <Bar 
                      dataKey="total_amount" 
                      fill="url(#barGradient)" 
                      radius={[0, 8, 8, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <ShoppingBag className="w-12 h-12 mb-2 opacity-50" />
                  <span>暂无商品数据</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 业务员业绩排行 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100/50 p-6 
          hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-5">
            <div className="p-2 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg">
              <Award className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900">业务员业绩排行</h3>
          </div>
          
          {salespersons.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">排名</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">业务员</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">销售额</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">克重</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">订单</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">客户</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">客单价</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {salespersons.map((sp, idx) => (
                    <tr key={sp.salesperson} 
                      className="hover:bg-amber-50/50 transition-colors">
                      <td className="px-4 py-4">
                        {idx === 0 ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full 
                            bg-gradient-to-br from-amber-400 to-yellow-500 text-white font-bold shadow-lg shadow-amber-200/50">
                            🥇
                          </span>
                        ) : idx === 1 ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full 
                            bg-gradient-to-br from-gray-300 to-gray-400 text-white font-bold">
                            🥈
                          </span>
                        ) : idx === 2 ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full 
                            bg-gradient-to-br from-orange-400 to-amber-500 text-white font-bold">
                            🥉
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full 
                            bg-gray-100 text-gray-500 font-medium">
                            {idx + 1}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-medium text-gray-900">{sp.salesperson || '未知'}</span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-bold text-amber-600">{formatAmount(sp.total_amount || 0)}</span>
                      </td>
                      <td className="px-4 py-4 text-right text-gray-600 font-mono">
                        {(sp.total_weight || 0).toFixed(1)}g
                      </td>
                      <td className="px-4 py-4 text-right text-gray-600">
                        {sp.order_count || 0}
                      </td>
                      <td className="px-4 py-4 text-right text-gray-600">
                        {sp.customer_count || 0}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-blue-600 font-medium">{formatAmount(sp.avg_order_amount || 0)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Users className="w-12 h-12 mb-2 opacity-50" />
              <span>暂无业务员业绩数据</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
