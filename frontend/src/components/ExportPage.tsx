import React, { useState, useEffect } from 'react';
import { 
  Download, FileSpreadsheet, Package, Users, Briefcase, 
  MessageSquare, ShoppingCart, ArrowLeft, RefreshCw, 
  Calendar, FolderArchive, CheckCircle, AlertCircle
} from 'lucide-react';
import { API_BASE_URL } from '../config';

interface ExportStats {
  chat_logs: number;
  inventory: number;
  inbound_orders: number;
  sales_orders: number;
  customers: number;
  suppliers: number;
}

interface ExportItem {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  endpoint: string;
  countKey: keyof ExportStats;
  description: string;
}

const EXPORT_ITEMS: ExportItem[] = [
  {
    id: 'chat-logs',
    name: '对话日志',
    icon: MessageSquare,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    endpoint: '/api/export/chat-logs',
    countKey: 'chat_logs',
    description: '用户与AI的对话记录'
  },
  {
    id: 'inventory',
    name: '库存数据',
    icon: Package,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    endpoint: '/api/export/inventory',
    countKey: 'inventory',
    description: '当前商品库存信息'
  },
  {
    id: 'inbound',
    name: '入库记录',
    icon: Download,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    endpoint: '/api/export/inbound',
    countKey: 'inbound_orders',
    description: '历史入库单明细'
  },
  {
    id: 'sales',
    name: '销售订单',
    icon: ShoppingCart,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    endpoint: '/api/export/sales',
    countKey: 'sales_orders',
    description: '销售订单和商品明细'
  },
  {
    id: 'customers',
    name: '客户列表',
    icon: Users,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50',
    endpoint: '/api/export/customers',
    countKey: 'customers',
    description: '客户基本信息'
  },
  {
    id: 'suppliers',
    name: '供应商列表',
    icon: Briefcase,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    endpoint: '/api/export/suppliers',
    countKey: 'suppliers',
    description: '供应商信息和供货统计'
  }
];

export const ExportPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 时间范围
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 获取统计数据
  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/export/stats`);
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      } else {
        setError(data.message || '获取统计数据失败');
      }
    } catch (e) {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // 计算日期范围
  const getDateParams = () => {
    const today = new Date();
    let start = '';
    let end = today.toISOString().split('T')[0];
    
    if (dateRange === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      start = weekAgo.toISOString().split('T')[0];
    } else if (dateRange === 'month') {
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      start = monthAgo.toISOString().split('T')[0];
    } else if (dateRange === 'custom') {
      start = startDate;
      end = endDate;
    }
    
    return { start, end };
  };

  // 导出单个数据
  const handleExport = async (item: ExportItem) => {
    try {
      setExporting(item.id);
      setExportSuccess(null);
      
      const { start, end } = getDateParams();
      let url = `${API_BASE_URL}${item.endpoint}`;
      
      // 添加日期参数（仅对支持的端点）
      if (['chat-logs', 'inbound', 'sales'].includes(item.id) && dateRange !== 'all') {
        const params = new URLSearchParams();
        if (start) params.append('start_date', start);
        if (end) params.append('end_date', end);
        url += `?${params.toString()}`;
      }
      
      // 直接打开下载链接
      window.open(url, '_blank');
      
      setExportSuccess(item.id);
      setTimeout(() => setExportSuccess(null), 3000);
    } catch (e) {
      setError('导出失败，请稍后重试');
    } finally {
      setExporting(null);
    }
  };

  // 一键导出全部
  const handleExportAll = async () => {
    try {
      setExporting('all');
      window.open(`${API_BASE_URL}/api/export/all`, '_blank');
      setExportSuccess('all');
      setTimeout(() => setExportSuccess(null), 3000);
    } catch (e) {
      setError('导出失败，请稍后重试');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载数据中...</p>
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
              <h1 className="text-xl font-semibold text-gray-900">数据导出中心</h1>
              <p className="text-sm text-gray-500">导出系统数据为 Excel 文件</p>
            </div>
          </div>
          <button
            onClick={fetchStats}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 
                       rounded-lg transition-colors text-gray-700"
          >
            <RefreshCw className="w-4 h-4" />
            <span>刷新</span>
          </button>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
              ✕
            </button>
          </div>
        )}

        {/* 时间范围选择 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-blue-500" />
            时间范围
          </h3>
          
          <div className="flex flex-wrap gap-3 mb-4">
            {[
              { value: 'all', label: '全部' },
              { value: 'week', label: '最近7天' },
              { value: 'month', label: '最近30天' },
              { value: 'custom', label: '自定义' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setDateRange(option.value as typeof dateRange)}
                className={`px-4 py-2 rounded-lg border transition-all ${
                  dateRange === option.value
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          
          {dateRange === 'custom' && (
            <div className="flex items-center space-x-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">开始日期</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <span className="text-gray-400 mt-6">至</span>
              <div>
                <label className="block text-sm text-gray-500 mb-1">结束日期</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          )}
          
          <p className="text-sm text-gray-400 mt-3">
            * 时间范围仅对对话日志、入库记录、销售订单有效
          </p>
        </div>

        {/* 数据导出卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {EXPORT_ITEMS.map((item) => {
            const IconComponent = item.icon;
            const count = stats?.[item.countKey] || 0;
            const isExporting = exporting === item.id;
            const isSuccess = exportSuccess === item.id;
            
            return (
              <div
                key={item.id}
                className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-3 rounded-xl ${item.bgColor}`}>
                    <IconComponent className={`w-6 h-6 ${item.color}`} />
                  </div>
                  {isSuccess && (
                    <span className="flex items-center text-green-600 text-sm">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      已下载
                    </span>
                  )}
                </div>
                
                <h4 className="text-lg font-semibold text-gray-900 mb-1">{item.name}</h4>
                <p className="text-sm text-gray-500 mb-3">{item.description}</p>
                
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900">{count}</span>
                  <button
                    onClick={() => handleExport(item)}
                    disabled={isExporting || count === 0}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all
                               ${count === 0 
                                 ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                 : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                  >
                    {isExporting ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4" />
                    )}
                    <span>导出 Excel</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 一键导出全部 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-6 shadow-lg text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold mb-2 flex items-center">
                <FolderArchive className="w-6 h-6 mr-2" />
                一键导出全部数据
              </h3>
              <p className="text-blue-100">
                将所有数据打包为 ZIP 文件下载，包含 6 个 Excel 表格
              </p>
            </div>
            <button
              onClick={handleExportAll}
              disabled={exporting === 'all'}
              className="flex items-center space-x-2 px-6 py-3 bg-white text-blue-600 rounded-xl
                         hover:bg-blue-50 transition-all font-semibold shadow-md"
            >
              {exporting === 'all' ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Download className="w-5 h-5" />
              )}
              <span>下载 ZIP 包</span>
            </button>
          </div>
          
          {exportSuccess === 'all' && (
            <div className="mt-4 p-3 bg-white/20 rounded-lg flex items-center space-x-2">
              <CheckCircle className="w-5 h-5" />
              <span>ZIP 文件已开始下载</span>
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="mt-6 p-4 bg-gray-100 rounded-xl text-sm text-gray-600">
          <h4 className="font-medium text-gray-700 mb-2">💡 导出说明</h4>
          <ul className="space-y-1 list-disc list-inside">
            <li>导出的 Excel 文件可用 Microsoft Excel、WPS 或 Google Sheets 打开</li>
            <li>ZIP 包包含所有数据表格，方便备份和迁移</li>
            <li>建议定期导出数据作为备份</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ExportPage;

