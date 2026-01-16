import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Package, Users, User, RefreshCw,
  ArrowUp, ArrowDown, Calendar
} from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import { API_BASE_URL } from '../../config';

interface SalesTrend {
  date: string;
  total_amount: number;
  total_weight: number;
  labor_amount: number;
  order_count: number;
}

interface TopProduct {
  rank: number;
  product_name: string;
  total_weight: number;
  total_amount: number;
  sale_count: number;
}

interface SalespersonPerf {
  rank: number;
  salesperson: string;
  total_amount: number;
  total_weight: number;
  order_count: number;
  customer_count: number;
  avg_order_amount: number;
}

interface CustomerData {
  customer_name: string;
  total_amount: number;
  total_weight: number;
  purchase_count: number;
  avg_order_amount: number;
  first_purchase: string | null;
  last_purchase: string | null;
}

export const SalesAnalysisTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [days, setDays] = useState(30);
  
  const [trends, setTrends] = useState<SalesTrend[]>([]);
  const [trendSummary, setTrendSummary] = useState<any>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [salespersons, setSalespersons] = useState<SalespersonPerf[]>([]);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [customerSummary, setCustomerSummary] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [trendsRes, productsRes, salespersonRes, customersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/analytics/sales/trends?period=${period}&days=${days}`),
        fetch(`${API_BASE_URL}/api/analytics/sales/top-products?days=${days}&limit=10`),
        fetch(`${API_BASE_URL}/api/analytics/sales/salesperson-performance?days=${days}`),
        fetch(`${API_BASE_URL}/api/analytics/sales/customer-analysis?days=${days}&limit=20`)
      ]);

      const trendsData = await trendsRes.json();
      if (trendsData.success) {
        setTrends(trendsData.data.trends);
        setTrendSummary(trendsData.data.summary);
      }

      const productsData = await productsRes.json();
      if (productsData.success) {
        setTopProducts(productsData.data.products);
      }

      const salespersonData = await salespersonRes.json();
      if (salespersonData.success) {
        setSalespersons(salespersonData.data.salespersons);
      }

      const customersData = await customersRes.json();
      if (customersData.success) {
        setCustomers(customersData.data.customers);
        setCustomerSummary(customersData.data.summary);
      }
    } catch (error) {
      console.error('获取销售数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period, days]);

  // 销售趋势图表数据
  const trendChartData = {
    labels: trends.map(t => t.date.slice(5)), // MM-DD or YYYY-MM
    datasets: [
      {
        label: '销售额(元)',
        data: trends.map(t => t.total_amount),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y'
      },
      {
        label: '克重(克)',
        data: trends.map(t => t.total_weight),
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y1'
      }
    ]
  };

  // 热销商品图表数据
  const productChartData = {
    labels: topProducts.map(p => p.product_name.length > 8 ? p.product_name.slice(0, 8) + '...' : p.product_name),
    datasets: [{
      label: '销售额(元)',
      data: topProducts.map(p => p.total_amount),
      backgroundColor: '#3B82F6',
      borderRadius: 6
    }]
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
      {/* 筛选条件 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={7}>最近7天</option>
              <option value={30}>最近30天</option>
              <option value={90}>最近90天</option>
            </select>
          </div>
          <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
            {(['day', 'week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  period === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {p === 'day' ? '日' : p === 'week' ? '周' : '月'}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>刷新</span>
        </button>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">销售总额</span>
            <TrendingUp className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(trendSummary?.total_amount || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">销售克重</span>
            <Package className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {(trendSummary?.total_weight || 0).toFixed(2)}克
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">订单数</span>
            <Users className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {trendSummary?.total_orders || 0}
          </div>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">客均单价</span>
            <User className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(trendSummary?.avg_order_amount || 0).toFixed(0)}
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 销售趋势 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp className="w-5 h-5 mr-2 text-blue-500" />
            销售趋势
          </h3>
          <div className="h-64">
            <Line
              data={trendChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: 'bottom' }
                },
                scales: {
                  y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: '销售额(元)' }
                  },
                  y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: '克重(克)' },
                    grid: { drawOnChartArea: false }
                  }
                }
              }}
            />
          </div>
        </div>

        {/* 热销商品 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Package className="w-5 h-5 mr-2 text-green-500" />
            热销商品 Top 10
          </h3>
          <div className="h-64">
            <Bar
              data={productChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                  legend: { display: false }
                },
                scales: {
                  x: { beginAtZero: true }
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 业务员业绩 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Users className="w-5 h-5 mr-2 text-purple-500" />
            业务员业绩排行
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">排名</th>
                  <th className="text-left py-2 text-gray-500 font-medium">业务员</th>
                  <th className="text-right py-2 text-gray-500 font-medium">销售额</th>
                  <th className="text-right py-2 text-gray-500 font-medium">订单数</th>
                  <th className="text-right py-2 text-gray-500 font-medium">客户数</th>
                </tr>
              </thead>
              <tbody>
                {salespersons.slice(0, 10).map((s) => (
                  <tr key={s.salesperson} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        s.rank === 1 ? 'bg-yellow-100 text-yellow-700' :
                        s.rank === 2 ? 'bg-gray-100 text-gray-700' :
                        s.rank === 3 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="py-2 font-medium text-gray-900">{s.salesperson || '未知'}</td>
                    <td className="py-2 text-right text-gray-700">¥{(s.total_amount || 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">{s.order_count || 0}</td>
                    <td className="py-2 text-right text-gray-500">{s.customer_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 客户分析 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-orange-500" />
            客户分析
            {customerSummary && (
              <span className="ml-auto text-sm text-gray-500 font-normal">
                复购率: <span className="text-green-600 font-medium">{customerSummary.repeat_rate}%</span>
              </span>
            )}
          </h3>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">客户</th>
                  <th className="text-right py-2 text-gray-500 font-medium">消费额</th>
                  <th className="text-right py-2 text-gray-500 font-medium">次数</th>
                  <th className="text-right py-2 text-gray-500 font-medium">客单价</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{c.customer_name || '未知'}</td>
                    <td className="py-2 text-right text-gray-700">¥{(c.total_amount || 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-500">{c.purchase_count || 0}</td>
                    <td className="py-2 text-right text-gray-500">¥{(c.avg_order_amount || 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesAnalysisTab;


