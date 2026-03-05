import React, { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, DollarSign, Scale, Coins, TrendingUp, 
  Package, Warehouse, Clock, BarChart3 
} from 'lucide-react';
import { API_ENDPOINTS } from '../config';

interface DashboardSummary {
  today: {
    sales_amount: number;
    sales_weight: number;
    order_count: number;
    change_percent: number;
    labor_amount: number;
    gold_received_weight: number;
    avg_gold_price: number;
    cash_price_weight: number;
  };
  month: {
    sales_amount: number;
    sales_weight: number;
    order_count: number;
    change_percent: number;
  };
  inventory: {
    total_weight: number;
  };
  updated_at: string;
}

// 单个指标卡片
interface MetricItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  iconBg: string;
  isPlaceholder?: boolean;
}

const MetricItem: React.FC<MetricItemProps> = ({ 
  icon, label, value, unit, iconBg, isPlaceholder = false 
}) => (
  <div className={`flex items-center gap-3 p-3 rounded-xl bg-gray-50/50 hover:bg-gray-100/50 transition-colors ${isPlaceholder ? 'opacity-50' : ''}`}>
    <div className={`p-2 rounded-lg ${iconBg}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <div className="flex items-baseline gap-1">
        <p className="text-lg font-bold text-gray-900">{value}</p>
        {unit && <span className="text-xs text-gray-500">{unit}</span>}
      </div>
    </div>
  </div>
);

export default function ManagerDashboardCard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/analytics/dashboard/summary`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSummary(data.data);
          setLastRefresh(new Date());
        }
      }
    } catch (error) {
      console.error('获取管理层数据看板失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // 自动刷新（每30秒）
  useEffect(() => {
    const interval = setInterval(fetchSummary, 30000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  const formatAmount = (amount: number) => {
    if (amount >= 10000) {
      return `¥${(amount / 10000).toFixed(2)}万`;
    }
    return `¥${amount.toFixed(2)}`;
  };

  const formatWeight = (weight: number) => {
    return weight.toFixed(2);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (isLoading && !summary) {
    return (
      <div className="bg-white rounded-2xl border border-purple-200/60 p-6 shadow-sm">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
          <span className="ml-2 text-gray-500">加载数据看板...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-purple-200/60 p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">管理层数据看板</h3>
            <p className="text-xs text-gray-400">上次刷新: {formatTime(lastRefresh)}</p>
          </div>
        </div>
        <button
          onClick={fetchSummary}
          disabled={isLoading}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="刷新数据"
        >
          <RefreshCw className={`w-4 h-4 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 指标网格 - 2行4列 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* 第一行 */}
        <MetricItem
          icon={<DollarSign className="w-4 h-4 text-amber-600" />}
          label="今日销售工费"
          value={formatAmount(summary?.today?.labor_amount || 0)}
          iconBg="bg-amber-100"
        />
        <MetricItem
          icon={<Scale className="w-4 h-4 text-emerald-600" />}
          label="今日销售克重"
          value={formatWeight(summary?.today?.sales_weight || 0)}
          unit="g"
          iconBg="bg-emerald-100"
        />
        <MetricItem
          icon={<Coins className="w-4 h-4 text-blue-600" />}
          label="今日收料克重"
          value={formatWeight(summary?.today?.gold_received_weight || 0)}
          unit="g"
          iconBg="bg-blue-100"
        />
        <MetricItem
          icon={<TrendingUp className="w-4 h-4 text-purple-600" />}
          label="今日结价平均金价"
          value={summary?.today?.avg_gold_price ? formatAmount(summary.today.avg_gold_price) : '--'}
          unit={summary?.today?.avg_gold_price ? '/g' : ''}
          iconBg="bg-purple-100"
        />

        {/* 第二行 */}
        <MetricItem
          icon={<BarChart3 className="w-4 h-4 text-rose-600" />}
          label="今日结价克重"
          value={formatWeight(summary?.today?.cash_price_weight || 0)}
          unit="g"
          iconBg="bg-rose-100"
        />
        <MetricItem
          icon={<Package className="w-4 h-4 text-cyan-600" />}
          label="本月销售克重"
          value={formatWeight(summary?.month?.sales_weight || 0)}
          unit="g"
          iconBg="bg-cyan-100"
        />
        <MetricItem
          icon={<Warehouse className="w-4 h-4 text-violet-600" />}
          label="公司库存克重"
          value={formatWeight(summary?.inventory?.total_weight || 0)}
          unit="g"
          iconBg="bg-violet-100"
        />
        <MetricItem
          icon={<Clock className="w-4 h-4 text-gray-400" />}
          label="暂借克重"
          value="--"
          unit="g"
          iconBg="bg-gray-100"
          isPlaceholder={true}
        />
      </div>
    </div>
  );
}
