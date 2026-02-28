import React, { useState, useEffect } from 'react';
import { 
  Package, Warehouse, RefreshCw, AlertTriangle,
  TrendingUp, TrendingDown, Clock
} from 'lucide-react';
import { Doughnut, Bar } from 'react-chartjs-2';
import { API_BASE_URL } from '../../config';

interface InventoryValue {
  product_name: string;
  weight: number;
  labor_cost: number;
  value: number;
}

interface LocationValue {
  location_id: number;
  location_name: string;
  location_type: string;
  total_weight: number;
  total_value: number;
}

interface TurnoverData {
  product_name: string;
  current_stock: number;
  sold_weight: number;
  turnover_rate: number;
  turnover_days: number;
  status: 'fast' | 'normal' | 'slow';
}

interface SlowMovingProduct {
  product_name: string;
  current_stock: number;
  days_since_sale: number;
  last_sale_date: string | null;
  alert_level: 'high' | 'medium' | 'low';
}

interface CategoryDist {
  category: string;
  weight: number;
  count: number;
}

export const InventoryAnalysisTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [slowDays, setSlowDays] = useState(30);
  
  const [productValues, setProductValues] = useState<InventoryValue[]>([]);
  const [locationValues, setLocationValues] = useState<LocationValue[]>([]);
  const [valueSummary, setValueSummary] = useState<any>(null);
  const [turnoverData, setTurnoverData] = useState<TurnoverData[]>([]);
  const [turnoverSummary, setTurnoverSummary] = useState<any>(null);
  const [slowMoving, setSlowMoving] = useState<SlowMovingProduct[]>([]);
  const [slowSummary, setSlowSummary] = useState<any>(null);
  const [categoryDist, setCategoryDist] = useState<CategoryDist[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [valueRes, turnoverRes, slowRes, distRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/analytics/inventory/value`),
        fetch(`${API_BASE_URL}/api/analytics/inventory/turnover?days=30`),
        fetch(`${API_BASE_URL}/api/analytics/inventory/slow-moving?threshold_days=${slowDays}`),
        fetch(`${API_BASE_URL}/api/analytics/inventory/distribution`)
      ]);

      const valueData = await valueRes.json();
      if (valueData.success) {
        setProductValues(valueData.data.by_product);
        setLocationValues(valueData.data.by_location);
        setValueSummary(valueData.data.summary);
      }

      const turnoverDataRes = await turnoverRes.json();
      if (turnoverDataRes.success) {
        setTurnoverData(turnoverDataRes.data.products);
        setTurnoverSummary(turnoverDataRes.data.summary);
      }

      const slowData = await slowRes.json();
      if (slowData.success) {
        setSlowMoving(slowData.data.products);
        setSlowSummary(slowData.data.summary);
      }

      const distData = await distRes.json();
      if (distData.success) {
        setCategoryDist(distData.data.by_category);
      }
    } catch (error) {
      console.error('获取库存数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [slowDays]);

  // 位置分布图表数据
  const locationChartData = {
    labels: locationValues.map(l => l.location_name),
    datasets: [{
      data: locationValues.map(l => l.total_weight),
      backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
      borderWidth: 2,
      borderColor: '#ffffff'
    }]
  };

  // 类别分布图表数据
  const categoryChartData = {
    labels: categoryDist.slice(0, 8).map(c => c.category),
    datasets: [{
      label: '库存克重',
      data: categoryDist.slice(0, 8).map(c => c.weight),
      backgroundColor: '#3B82F6',
      borderRadius: 6
    }]
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fast': return 'text-green-600 bg-green-50';
      case 'normal': return 'text-yellow-600 bg-yellow-50';
      case 'slow': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-orange-600 bg-orange-50';
      case 'low': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">库存总值</span>
            <Package className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(valueSummary?.total_value || 0).toLocaleString()}
          </div>
          <div className="text-sm opacity-70 mt-1">
            {valueSummary?.product_count || 0} 种商品
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">库存总量</span>
            <Warehouse className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {(valueSummary?.total_weight || 0).toFixed(2)}克
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">周转良好</span>
            <TrendingUp className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {turnoverSummary?.fast_count || 0}
          </div>
          <div className="text-sm opacity-70 mt-1">
            周转率 &gt; 2
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">滞销商品</span>
            <AlertTriangle className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {slowSummary?.total_count || 0}
          </div>
          <div className="text-sm opacity-70 mt-1">
            超过{slowDays}天未售
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 位置分布 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Warehouse className="w-5 h-5 mr-2 text-blue-500" />
            库存位置分布
          </h3>
          <div className="h-64">
            {locationValues.length > 0 ? (
              <Doughnut
                data={locationChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom' }
                  }
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                暂无数据
              </div>
            )}
          </div>
        </div>

        {/* 类别分布 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Package className="w-5 h-5 mr-2 text-green-500" />
            商品类别分布
          </h3>
          <div className="h-64">
            {categoryDist.length > 0 ? (
              <Bar
                data={categoryChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false }
                  },
                  scales: {
                    y: { beginAtZero: true }
                  }
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                暂无数据
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 库存周转率 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp className="w-5 h-5 mr-2 text-purple-500" />
            库存周转率分析
            <span className="ml-auto text-sm text-gray-500 font-normal">
              近30天
            </span>
          </h3>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">商品</th>
                  <th className="text-right py-2 text-gray-500 font-medium">库存</th>
                  <th className="text-right py-2 text-gray-500 font-medium">销售</th>
                  <th className="text-right py-2 text-gray-500 font-medium">周转天数</th>
                  <th className="text-center py-2 text-gray-500 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {turnoverData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400 text-sm">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  turnoverData.slice(0, 15).map((t, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-900 truncate max-w-[150px]" title={t.product_name}>
                        {t.product_name}
                      </td>
                      <td className="py-2 text-right text-gray-700">{t.current_stock.toFixed(1)}g</td>
                      <td className="py-2 text-right text-gray-500">{t.sold_weight.toFixed(1)}g</td>
                      <td className="py-2 text-right text-gray-500">
                        {t.turnover_days > 900 ? '∞' : t.turnover_days.toFixed(0)}天
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(t.status)}`}>
                          {t.status === 'fast' ? '快' : t.status === 'normal' ? '中' : '慢'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 滞销商品 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Clock className="w-5 h-5 mr-2 text-red-500" />
              滞销商品预警
            </h3>
            <select
              value={slowDays}
              onChange={(e) => setSlowDays(Number(e.target.value))}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={15}>超过15天</option>
              <option value={30}>超过30天</option>
              <option value={60}>超过60天</option>
              <option value={90}>超过90天</option>
            </select>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">商品</th>
                  <th className="text-right py-2 text-gray-500 font-medium">库存</th>
                  <th className="text-right py-2 text-gray-500 font-medium">未售天数</th>
                  <th className="text-center py-2 text-gray-500 font-medium">等级</th>
                </tr>
              </thead>
              <tbody>
                {slowMoving.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400 text-sm">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  slowMoving.slice(0, 15).map((s, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-900 truncate max-w-[150px]" title={s.product_name}>
                        {s.product_name}
                      </td>
                      <td className="py-2 text-right text-gray-700">{s.current_stock.toFixed(1)}g</td>
                      <td className="py-2 text-right text-gray-500">
                        {s.days_since_sale > 900 ? '从未销售' : `${s.days_since_sale}天`}
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getAlertColor(s.alert_level)}`}>
                          {s.alert_level === 'high' ? '高' : s.alert_level === 'medium' ? '中' : '低'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 库存价值明细 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Package className="w-5 h-5 mr-2 text-blue-500" />
          库存价值明细 (Top 20)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-gray-500 font-medium">商品名称</th>
                <th className="text-right py-2 text-gray-500 font-medium">库存克重</th>
                <th className="text-right py-2 text-gray-500 font-medium">单位工费</th>
                <th className="text-right py-2 text-gray-500 font-medium">库存价值</th>
              </tr>
            </thead>
            <tbody>
              {productValues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400 text-sm">
                    暂无数据
                  </td>
                </tr>
              ) : (
                productValues.map((p, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{p.product_name || '未知'}</td>
                    <td className="py-2 text-right text-gray-700">{(p.weight || 0).toFixed(2)}克</td>
                    <td className="py-2 text-right text-gray-500">¥{(p.labor_cost || 0).toFixed(2)}/克</td>
                    <td className="py-2 text-right text-blue-600 font-medium">¥{(p.value || 0).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InventoryAnalysisTab;


