import React, { useState, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, RefreshCw,
  PieChart, Building2, ArrowUpRight, ArrowDownRight, Calendar
} from 'lucide-react';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { API_BASE_URL } from '../../config';

interface ProfitTrend {
  date: string;
  revenue: number;
  labor_revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
}

interface CostStructure {
  labor_cost: number;
  material_cost: number;
  total_cost: number;
}

interface SupplierCost {
  supplier: string;
  cost: number;
  weight: number;
}

interface CashflowData {
  date: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
}

export const FinanceAnalysisTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  
  const [profitTrends, setProfitTrends] = useState<ProfitTrend[]>([]);
  const [profitSummary, setProfitSummary] = useState<any>(null);
  const [costStructure, setCostStructure] = useState<CostStructure | null>(null);
  const [supplierCosts, setSupplierCosts] = useState<SupplierCost[]>([]);
  const [cashflow, setCashflow] = useState<CashflowData[]>([]);
  const [cashflowSummary, setCashflowSummary] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profitRes, costRes, cashflowRes, supplierRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/analytics/finance/profit?days=${days}`),
        fetch(`${API_BASE_URL}/api/analytics/finance/cost-structure?days=${days}`),
        fetch(`${API_BASE_URL}/api/analytics/finance/cashflow?days=${days}`),
        fetch(`${API_BASE_URL}/api/analytics/finance/supplier-cost?days=90`)
      ]);

      const profitData = await profitRes.json();
      if (profitData.success) {
        setProfitTrends(profitData.data.trends);
        setProfitSummary(profitData.data.summary);
      }

      const costData = await costRes.json();
      if (costData.success) {
        setCostStructure(costData.data.structure);
        setSupplierCosts(costData.data.by_supplier);
      }

      const cashflowData = await cashflowRes.json();
      if (cashflowData.success) {
        setCashflow(cashflowData.data.flows);
        setCashflowSummary(cashflowData.data.summary);
      }

      const supplierData = await supplierRes.json();
      if (supplierData.success) {
        setSupplierCosts(supplierData.data.suppliers);
      }
    } catch (error) {
      console.error('获取财务数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  // 利润趋势图表数据
  const profitChartData = {
    labels: profitTrends.map(t => t.date.slice(5)),
    datasets: [
      {
        label: '收入',
        data: profitTrends.map(t => t.revenue),
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4
      },
      {
        label: '成本',
        data: profitTrends.map(t => t.cost),
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.4
      },
      {
        label: '利润',
        data: profitTrends.map(t => t.profit),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4
      }
    ]
  };

  // 成本结构图表数据
  const costChartData = costStructure ? {
    labels: ['工费成本', '原料成本'],
    datasets: [{
      data: [costStructure.labor_cost, costStructure.material_cost],
      backgroundColor: ['#3B82F6', '#F59E0B'],
      borderWidth: 2,
      borderColor: '#ffffff'
    }]
  } : null;

  // 供应商成本图表数据
  const supplierChartData = {
    labels: supplierCosts.slice(0, 8).map(s => s.supplier.length > 6 ? s.supplier.slice(0, 6) + '...' : s.supplier),
    datasets: [{
      label: '采购成本(元)',
      data: supplierCosts.slice(0, 8).map(s => s.cost),
      backgroundColor: '#3B82F6',
      borderRadius: 6
    }]
  };

  // 现金流图表数据
  const cashflowChartData = {
    labels: cashflow.map(c => c.date.slice(5)),
    datasets: [
      {
        label: '收入',
        data: cashflow.map(c => c.income),
        backgroundColor: '#10B981',
        borderRadius: 4,
        stack: 'stack1'
      },
      {
        label: '支出',
        data: cashflow.map(c => -c.expense),
        backgroundColor: '#EF4444',
        borderRadius: 4,
        stack: 'stack1'
      }
    ]
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
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">总收入</span>
            <ArrowUpRight className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(profitSummary?.total_revenue || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">总成本</span>
            <ArrowDownRight className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(profitSummary?.total_cost || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">净利润</span>
            <DollarSign className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ¥{(profitSummary?.total_profit || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">利润率</span>
            <TrendingUp className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-2xl font-bold mt-2">
            {profitSummary?.profit_margin || 0}%
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 利润趋势 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp className="w-5 h-5 mr-2 text-blue-500" />
            利润趋势
          </h3>
          <div className="h-64">
            {profitTrends.length > 0 ? (
              <Line
                data={profitChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom' }
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

        {/* 成本结构 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <PieChart className="w-5 h-5 mr-2 text-green-500" />
            成本结构
          </h3>
          <div className="h-64">
            {costChartData ? (
              <Doughnut
                data={costChartData}
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
          {costStructure && (
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-blue-600 font-medium">工费成本</div>
                <div className="text-lg font-bold text-gray-900">
                  ¥{costStructure.labor_cost.toLocaleString()}
                </div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-orange-600 font-medium">原料成本</div>
                <div className="text-lg font-bold text-gray-900">
                  ¥{costStructure.material_cost.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 现金流和供应商成本 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 现金流 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <DollarSign className="w-5 h-5 mr-2 text-purple-500" />
            现金流分析
          </h3>
          <div className="h-64">
            {cashflow.length > 0 ? (
              <Bar
                data={cashflowChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom' }
                  },
                  scales: {
                    x: { stacked: true },
                    y: { stacked: true }
                  }
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                暂无数据
              </div>
            )}
          </div>
          {cashflowSummary && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-green-600 text-xs">总收入</div>
                <div className="font-bold text-gray-900">
                  ¥{(cashflowSummary.total_income / 10000).toFixed(1)}万
                </div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-red-600 text-xs">总支出</div>
                <div className="font-bold text-gray-900">
                  ¥{(cashflowSummary.total_expense / 10000).toFixed(1)}万
                </div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-blue-600 text-xs">净流入</div>
                <div className="font-bold text-gray-900">
                  ¥{(cashflowSummary.net_cashflow / 10000).toFixed(1)}万
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 供应商成本 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Building2 className="w-5 h-5 mr-2 text-orange-500" />
            供应商成本对比
          </h3>
          <div className="h-64">
            {supplierCosts.length > 0 ? (
              <Bar
                data={supplierChartData}
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
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                暂无数据
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 供应商明细表 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Building2 className="w-5 h-5 mr-2 text-blue-500" />
          供应商成本明细
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-gray-500 font-medium">供应商</th>
                <th className="text-right py-2 text-gray-500 font-medium">采购成本</th>
                <th className="text-right py-2 text-gray-500 font-medium">采购克重</th>
                <th className="text-right py-2 text-gray-500 font-medium">平均单价</th>
              </tr>
            </thead>
            <tbody>
              {supplierCosts.map((s, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-900">{s.supplier}</td>
                  <td className="py-2 text-right text-gray-700">¥{s.cost.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-500">{s.weight.toFixed(2)}克</td>
                  <td className="py-2 text-right text-blue-600">
                    ¥{s.weight > 0 ? (s.cost / s.weight).toFixed(2) : '0'}/克
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FinanceAnalysisTab;


