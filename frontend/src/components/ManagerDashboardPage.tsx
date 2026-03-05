import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  DollarSign, Package, Scale, TrendingUp, RefreshCw, Crown,
  Coins, BarChart3, Warehouse, Clock
} from 'lucide-react';
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
  unit?: string;
  icon: React.ReactNode;
  gradient: string;
  iconBg: string;
  isPlaceholder?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ 
  title, value, unit, icon, gradient, iconBg, isPlaceholder = false 
}) => (
  <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient} 
    shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5
    ${isPlaceholder ? 'opacity-60' : ''}`}>
    {/* 装饰性背景 */}
    <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
      <div className="absolute inset-0 bg-white rounded-full transform translate-x-8 -translate-y-8" />
    </div>
    
    <div className="relative flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm font-medium opacity-80 mb-1">{title}</p>
        <div className="flex items-baseline gap-1">
          <p className="text-2xl font-bold">{value}</p>
          {unit && <p className="text-sm opacity-70">{unit}</p>}
        </div>
      </div>
      <div className={`p-3 rounded-xl ${iconBg} shadow-sm`}>
        {icon}
      </div>
    </div>
    
    {isPlaceholder && (
      <div className="mt-3 text-xs opacity-60 italic">
        功能开发中
      </div>
    )}
  </div>
);

// 主组件
const ManagerDashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/dashboard/summary`);
      const data = await response.json();

      if (data.success) {
        setSummary(data.data);
      } else {
        toast.error('加载数据失败');
      }
    } catch (error) {
      console.error('加载仪表盘数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const formatAmount = (amount: number) => {
    if (amount >= 10000) {
      return `¥${(amount / 10000).toFixed(2)}万`;
    }
    return `¥${amount.toFixed(2)}`;
  };

  const formatWeight = (weight: number) => {
    return weight.toFixed(2);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-amber-200 rounded-full animate-pulse" />
          <Crown className="w-8 h-8 text-amber-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-spin" />
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
                <h1 className="text-xl font-bold text-gray-900">管理层数据看板</h1>
                <p className="text-xs text-gray-500">核心业务指标实时监控</p>
              </div>
            </div>
            
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

      <div className="p-6">
        {/* 关键指标卡片 - 2行4列布局 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {/* 第一行 */}
          <MetricCard
            title="今日销售工费"
            value={formatAmount(summary?.today?.labor_amount || 0)}
            icon={<DollarSign className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-amber-400 to-yellow-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="今日销售克重"
            value={formatWeight(summary?.today?.sales_weight || 0)}
            unit="g"
            icon={<Scale className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-emerald-500 to-teal-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="今日收料克重"
            value={formatWeight(summary?.today?.gold_received_weight || 0)}
            unit="g"
            icon={<Coins className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-blue-500 to-indigo-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="今日结价金价"
            value={summary?.today?.avg_gold_price ? formatAmount(summary.today.avg_gold_price) : '--'}
            unit={summary?.today?.avg_gold_price ? '/g' : ''}
            icon={<BarChart3 className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-purple-500 to-pink-500 text-white"
            iconBg="bg-white/20"
          />
          
          {/* 第二行 */}
          <MetricCard
            title="今日结价克重"
            value={formatWeight(summary?.today?.cash_price_weight || 0)}
            unit="g"
            icon={<TrendingUp className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-rose-500 to-red-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="本月销售克重"
            value={formatWeight(summary?.month?.sales_weight || 0)}
            unit="g"
            icon={<Package className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-cyan-500 to-blue-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="公司库存克重"
            value={formatWeight(summary?.inventory?.total_weight || 0)}
            unit="g"
            icon={<Warehouse className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-violet-500 to-purple-500 text-white"
            iconBg="bg-white/20"
          />
          <MetricCard
            title="暂借克重"
            value={formatWeight(summary?.loan?.outstanding_weight || 0)}
            unit="g"
            icon={<Clock className="w-6 h-6 text-white" />}
            gradient="bg-gradient-to-br from-orange-500 to-amber-500 text-white"
            iconBg="bg-white/20"
          />
        </div>

        {/* 数据更新时间 */}
        {summary?.updated_at && (
          <div className="text-center text-xs text-gray-500 mt-4">
            最后更新: {new Date(summary.updated_at).toLocaleString('zh-CN')}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManagerDashboardPage;
