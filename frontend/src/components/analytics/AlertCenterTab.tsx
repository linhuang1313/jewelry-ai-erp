import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, Bell, Settings, RefreshCw,
  Package, Clock, AlertCircle, Check, X,
  ChevronDown, ChevronUp, Save
} from 'lucide-react';
import { API_BASE_URL } from '../../config';

interface Alert {
  type: 'low_stock' | 'slow_moving' | 'abnormal';
  level: 'high' | 'medium' | 'low';
  product_name: string;
  current_value: number;
  threshold: number;
  message: string;
  created_at: string;
}

interface AlertSetting {
  product_name: string;
  min_weight: number;
  slow_days: number;
  is_enabled: boolean;
}

export const AlertCenterTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [settings, setSettings] = useState<AlertSetting[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [saving, setSaving] = useState(false);
  const [editedSettings, setEditedSettings] = useState<AlertSetting[]>([]);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/alerts/list`);
      const data = await response.json();
      if (data.success) {
        setAlerts(data.data.alerts);
        setSummary(data.data.summary);
      }
    } catch (error) {
      console.error('获取预警列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/alerts/settings`);
      const data = await response.json();
      if (data.success) {
        setSettings(data.data.settings);
        setEditedSettings(data.data.settings);
      }
    } catch (error) {
      console.error('获取预警设置失败:', error);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/alerts/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSettings)
      });
      const data = await response.json();
      if (data.success) {
        setSettings(editedSettings);
        setShowSettings(false);
        fetchAlerts(); // 刷新预警列表
      }
    } catch (error) {
      console.error('保存预警设置失败:', error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    fetchSettings();
  }, []);

  const filteredAlerts = alerts.filter(alert => {
    if (filterType !== 'all' && alert.type !== filterType) return false;
    if (filterLevel !== 'all' && alert.level !== filterLevel) return false;
    return true;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'low_stock': return <Package className="w-4 h-4" />;
      case 'slow_moving': return <Clock className="w-4 h-4" />;
      case 'abnormal': return <AlertCircle className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'low_stock': return '低库存';
      case 'slow_moving': return '滞销';
      case 'abnormal': return '异常';
      default: return '未知';
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-red-100 text-red-700 border-red-200';
      case 'medium': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'low': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'low_stock': return 'bg-blue-100 text-blue-700';
      case 'slow_moving': return 'bg-purple-100 text-purple-700';
      case 'abnormal': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const updateSetting = (productName: string, field: string, value: any) => {
    setEditedSettings(prev => prev.map(s => 
      s.product_name === productName ? { ...s, [field]: value } : s
    ));
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">高级预警</span>
            <AlertTriangle className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-3xl font-bold mt-2">{summary?.high || 0}</div>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">中级预警</span>
            <Bell className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-3xl font-bold mt-2">{summary?.medium || 0}</div>
        </div>
        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">低级预警</span>
            <Bell className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-3xl font-bold mt-2">{summary?.low || 0}</div>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">低库存</span>
            <Package className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-3xl font-bold mt-2">{summary?.by_type?.low_stock || 0}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-80">滞销商品</span>
            <Clock className="w-5 h-5 opacity-60" />
          </div>
          <div className="text-3xl font-bold mt-2">{summary?.by_type?.slow_moving || 0}</div>
        </div>
      </div>

      {/* 筛选和操作栏 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center space-x-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部类型</option>
            <option value="low_stock">低库存</option>
            <option value="slow_moving">滞销</option>
            <option value="abnormal">异常</option>
          </select>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">全部级别</option>
            <option value="high">高级</option>
            <option value="medium">中级</option>
            <option value="low">低级</option>
          </select>
          <span className="text-sm text-gray-500">
            共 {filteredAlerts.length} 条预警
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              showSettings ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>预警设置</span>
            {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={fetchAlerts}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 预警设置面板 */}
      {showSettings && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Settings className="w-5 h-5 mr-2 text-blue-500" />
              预警阈值设置
            </h3>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>保存设置</span>
            </button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">商品名称</th>
                  <th className="text-center py-2 text-gray-500 font-medium">最低库存(克)</th>
                  <th className="text-center py-2 text-gray-500 font-medium">滞销天数</th>
                  <th className="text-center py-2 text-gray-500 font-medium">启用预警</th>
                </tr>
              </thead>
              <tbody>
                {editedSettings.map((s, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{s.product_name}</td>
                    <td className="py-2 text-center">
                      <input
                        type="number"
                        value={s.min_weight}
                        onChange={(e) => updateSetting(s.product_name, 'min_weight', parseFloat(e.target.value) || 0)}
                        className="w-20 px-2 py-1 border border-gray-200 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="number"
                        value={s.slow_days}
                        onChange={(e) => updateSetting(s.product_name, 'slow_days', parseInt(e.target.value) || 0)}
                        className="w-20 px-2 py-1 border border-gray-200 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="py-2 text-center">
                      <button
                        onClick={() => updateSetting(s.product_name, 'is_enabled', !s.is_enabled)}
                        className={`p-1 rounded-full transition-colors ${
                          s.is_enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {s.is_enabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 预警列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Bell className="w-5 h-5 mr-2 text-red-500" />
            预警列表
          </h3>
        </div>
        <div className="divide-y divide-gray-100">
          {filteredAlerts.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Check className="w-16 h-16 mx-auto mb-4 text-green-300" />
              <p className="text-lg">暂无预警</p>
              <p className="text-sm mt-1">所有指标正常</p>
            </div>
          ) : (
            filteredAlerts.map((alert, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start space-x-4">
                  {/* 级别标识 */}
                  <div className={`p-2 rounded-lg ${getLevelColor(alert.level)}`}>
                    {getTypeIcon(alert.type)}
                  </div>
                  
                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-gray-900">{alert.product_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getTypeColor(alert.type)}`}>
                        {getTypeLabel(alert.type)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getLevelColor(alert.level)}`}>
                        {alert.level === 'high' ? '高' : alert.level === 'medium' ? '中' : '低'}级
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{alert.message}</p>
                  </div>
                  
                  {/* 数值 */}
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">
                      {alert.type === 'low_stock' 
                        ? `${alert.current_value.toFixed(1)}克`
                        : alert.type === 'slow_moving'
                        ? `${alert.current_value}天`
                        : alert.current_value
                      }
                    </div>
                    <div className="text-xs text-gray-500">
                      阈值: {alert.type === 'low_stock' 
                        ? `${alert.threshold}克`
                        : alert.type === 'slow_moving'
                        ? `${alert.threshold}天`
                        : alert.threshold
                      }
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertCenterTab;

