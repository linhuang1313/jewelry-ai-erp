import React, { useState, useEffect } from 'react';
import { 
  BarChart3, Users, MessageSquare, Clock, TrendingUp, 
  CheckCircle, AlertCircle, ArrowLeft, RefreshCw,
  User, Briefcase, Package, Crown
} from 'lucide-react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { API_BASE_URL } from '../config';

// 角色配置
const ROLE_CONFIG: Record<string, { name: string; icon: React.ElementType; color: string; bgColor: string }> = {
  sales: { name: '业务员', icon: User, color: '#3B82F6', bgColor: 'bg-blue-50' },
  finance: { name: '财务', icon: Briefcase, color: '#10B981', bgColor: 'bg-green-50' },
  product: { name: '商品专员', icon: Package, color: '#F59E0B', bgColor: 'bg-orange-50' },
  settlement: { name: '结算专员', icon: Briefcase, color: '#06B6D4', bgColor: 'bg-cyan-50' },
  manager: { name: '管理层', icon: Crown, color: '#8B5CF6', bgColor: 'bg-purple-50' },
};

interface OverviewData {
  total_chats: number;
  week_chats: number;
  today_chats: number;
  role_distribution: Record<string, number>;
  intent_distribution: Array<{ intent: string; count: number }>;
  avg_response_time_ms: number;
  success_rate: number;
}

interface DailyData {
  date: string;
  total: number;
  by_role: Record<string, number>;
}

interface RoleData {
  role: string;
  total_chats: number;
  week_chats: number;
  top_intents: Array<{ intent: string; count: number }>;
  hot_keywords: Array<{ keyword: string; count: number }>;
  recent_chats: Array<{ content: string; created_at: string }>;
}

export const AnalyticsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleData, setRoleData] = useState<RoleData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 获取概览数据
  const fetchOverview = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/overview`);
      const data = await response.json();
      if (data.success) {
        setOverview(data.data);
      } else {
        setError(data.message || '获取数据失败');
      }
    } catch (e) {
      setError('无法连接到服务器');
    }
  };

  // 获取每日趋势
  const fetchDaily = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/daily?days=7`);
      const data = await response.json();
      if (data.success) {
        setDailyData(data.data);
      }
    } catch (e) {
      console.error('获取每日数据失败:', e);
    }
  };

  // 获取角色详情
  const fetchRoleData = async (role: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/role/${role}`);
      const data = await response.json();
      if (data.success) {
        setRoleData(data.data);
      }
    } catch (e) {
      console.error('获取角色数据失败:', e);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchOverview(), fetchDaily()]);
      setLoading(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    if (selectedRole) {
      fetchRoleData(selectedRole);
    }
  }, [selectedRole]);

  const refreshData = async () => {
    setLoading(true);
    await Promise.all([fetchOverview(), fetchDaily()]);
    if (selectedRole) {
      await fetchRoleData(selectedRole);
    }
    setLoading(false);
  };

  // 生成角色分布图表数据
  const roleChartData = overview ? {
    labels: Object.keys(overview.role_distribution).map(r => ROLE_CONFIG[r]?.name || r),
    datasets: [{
      data: Object.values(overview.role_distribution),
      backgroundColor: Object.keys(overview.role_distribution).map(r => ROLE_CONFIG[r]?.color || '#6B7280'),
      borderWidth: 2,
      borderColor: '#ffffff',
    }]
  } : null;

  // 生成每日趋势图表数据
  const dailyChartData = dailyData.length > 0 ? {
    labels: dailyData.map(d => d.date.slice(5)), // MM-DD
    datasets: [{
      label: '对话数',
      data: dailyData.map(d => d.total),
      fill: true,
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.4,
    }]
  } : null;

  // 生成意图分布图表数据
  const intentChartData = overview?.intent_distribution ? {
    labels: overview.intent_distribution.map(i => i.intent),
    datasets: [{
      label: '次数',
      data: overview.intent_distribution.map(i => i.count),
      backgroundColor: '#3B82F6',
      borderRadius: 6,
    }]
  } : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载统计数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={refreshData}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">数据分析中心</h1>
              <p className="text-sm text-gray-500">对话统计与用户行为分析</p>
            </div>
          </div>
          <button
            onClick={refreshData}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 
                       rounded-lg transition-colors text-gray-700"
          >
            <RefreshCw className="w-4 h-4" />
            <span>刷新</span>
          </button>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* 概览卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 总对话数 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">总对话数</p>
                <p className="text-3xl font-bold text-gray-900">{overview?.total_chats || 0}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <MessageSquare className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>

          {/* 本周对话 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">本周对话</p>
                <p className="text-3xl font-bold text-gray-900">{overview?.week_chats || 0}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>

          {/* 平均响应时间 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">平均响应</p>
                <p className="text-3xl font-bold text-gray-900">
                  {overview?.avg_response_time_ms ? `${(overview.avg_response_time_ms / 1000).toFixed(1)}s` : '-'}
                </p>
              </div>
              <div className="p-3 bg-orange-50 rounded-xl">
                <Clock className="w-6 h-6 text-orange-500" />
              </div>
            </div>
          </div>

          {/* 成功率 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">成功率</p>
                <p className="text-3xl font-bold text-gray-900">{overview?.success_rate || 100}%</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl">
                <CheckCircle className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* 图表区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 角色分布 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-500" />
              角色使用分布
            </h3>
            {roleChartData && Object.keys(overview?.role_distribution || {}).length > 0 ? (
              <div className="h-64">
                <Doughnut
                  data={roleChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom' }
                    }
                  }}
                />
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>暂无数据</p>
                </div>
              </div>
            )}
          </div>

          {/* 每日趋势 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-green-500" />
              7日对话趋势
            </h3>
            {dailyChartData && dailyData.length > 0 ? (
              <div className="h-64">
                <Line
                  data={dailyChartData}
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
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>暂无数据</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 意图分布 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <BarChart3 className="w-5 h-5 mr-2 text-purple-500" />
            热门意图 Top 10
          </h3>
          {intentChartData && overview?.intent_distribution.length ? (
            <div className="h-72">
              <Bar
                data={intentChartData}
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
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无意图数据</p>
              </div>
            </div>
          )}
        </div>

        {/* 角色详情选择 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">角色详细分析</h3>
          
          {/* 角色选择按钮 */}
          <div className="flex flex-wrap gap-3 mb-6">
            {Object.entries(ROLE_CONFIG).map(([roleId, config]) => {
              const IconComponent = config.icon;
              const isActive = selectedRole === roleId;
              return (
                <button
                  key={roleId}
                  onClick={() => setSelectedRole(isActive ? null : roleId)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border transition-all
                             ${isActive 
                               ? 'border-blue-500 bg-blue-50 text-blue-700' 
                               : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}
                >
                  <IconComponent className="w-4 h-4" style={{ color: config.color }} />
                  <span className="font-medium">{config.name}</span>
                  {overview?.role_distribution[roleId] && (
                    <span className={`text-xs px-2 py-0.5 rounded-full 
                                     ${isActive ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      {overview.role_distribution[roleId]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 角色详情 */}
          {selectedRole && roleData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 热门意图 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-700 mb-3">热门操作</h4>
                {roleData.top_intents.length > 0 ? (
                  <ul className="space-y-2">
                    {roleData.top_intents.map((intent, idx) => (
                      <li key={idx} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{intent.intent}</span>
                        <span className="text-gray-400">{intent.count}次</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-400 text-sm">暂无数据</p>
                )}
              </div>

              {/* 热门关键词 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-700 mb-3">热门关键词</h4>
                {roleData.hot_keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {roleData.hot_keywords.map((kw, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-white rounded-full text-sm text-gray-600 border border-gray-200"
                      >
                        {kw.keyword} ({kw.count})
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">暂无数据</p>
                )}
              </div>

              {/* 最近对话 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-700 mb-3">最近对话</h4>
                {roleData.recent_chats.length > 0 ? (
                  <ul className="space-y-2 max-h-40 overflow-y-auto">
                    {roleData.recent_chats.slice(0, 5).map((chat, idx) => (
                      <li key={idx} className="text-sm text-gray-600 truncate">
                        "{chat.content}"
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-400 text-sm">暂无对话记录</p>
                )}
              </div>
            </div>
          )}

          {!selectedRole && (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>选择一个角色查看详细分析</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;

