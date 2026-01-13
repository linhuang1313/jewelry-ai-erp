import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  Package, MapPin, ArrowRight, ArrowLeft, Check, X, Clock, RefreshCw,
  Plus, Send, Inbox, AlertTriangle, ChevronDown, Search, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';

// 类型定义
interface Location {
  id: number;
  code: string;
  name: string;
  location_type: string;
  description: string | null;
  is_active: number;
}

interface LocationInventory {
  id: number;
  product_name: string;
  location_id: number;
  location_name: string;
  location_code: string;
  weight: number;
  last_update: string;
}

interface InventorySummary {
  product_name: string;
  total_weight: number;
  locations: LocationInventory[];
}

interface InventoryTransfer {
  id: number;
  transfer_no: string;
  product_name: string;
  weight: number;
  from_location_id: number;
  to_location_id: number;
  from_location_name: string;
  to_location_name: string;
  status: string;
  created_by: string;
  created_at: string;
  remark: string | null;
  received_by: string | null;
  received_at: string | null;
  actual_weight: number | null;
  weight_diff: number | null;
  diff_reason: string | null;
}

// Tab 组件
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-4 py-3 rounded-lg font-medium transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-md'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
        active ? 'bg-white/20' : 'bg-red-500 text-white'
      }`}>
        {count}
      </span>
    )}
  </button>
);

// 状态徽章
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待接收' },
    received: { bg: 'bg-green-100', text: 'text-green-700', label: '已接收' },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '已拒收' },
  };
  const { bg, text, label } = config[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
};

export const WarehousePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'inventory' | 'transfer' | 'receive'>('inventory');
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<InventoryTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);

  // 转移表单状态
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({
    product_name: '',
    weight: '',
    from_location_id: '',
    to_location_id: '',
    remark: ''
  });

  // 接收表单状态
  const [receivingTransfer, setReceivingTransfer] = useState<InventoryTransfer | null>(null);
  const [receiveForm, setReceiveForm] = useState({
    actual_weight: '',
    diff_reason: ''
  });

  // 加载数据
  useEffect(() => {
    loadLocations();
    loadInventorySummary();
    loadTransfers();
  }, []);

  const loadLocations = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.LOCATIONS);
      if (response.ok) {
        const data = await response.json();
        setLocations(data);
      }
    } catch (error) {
      console.error('加载位置失败:', error);
    }
  };

  const loadInventorySummary = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.INVENTORY_SUMMARY);
      if (response.ok) {
        const data = await response.json();
        setInventorySummary(data);
      }
    } catch (error) {
      console.error('加载库存汇总失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTransfers = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.TRANSFERS);
      if (response.ok) {
        const data = await response.json();
        setTransfers(data);
        setPendingTransfers(data.filter((t: InventoryTransfer) => t.status === 'pending'));
      }
    } catch (error) {
      console.error('加载转移单失败:', error);
    }
  };

  // 初始化默认位置
  const initDefaultLocations = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.INIT_DEFAULT_LOCATIONS, {
        method: 'POST'
      });
      if (response.ok) {
        toast.success('默认位置初始化成功');
        loadLocations();
      }
    } catch (error) {
      toast.error('初始化失败');
    }
  };

  // 创建转移单
  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!transferForm.product_name || !transferForm.weight || !transferForm.from_location_id || !transferForm.to_location_id) {
      toast.error('请填写完整信息');
      return;
    }

    try {
      const response = await fetch(API_ENDPOINTS.TRANSFERS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: transferForm.product_name,
          weight: parseFloat(transferForm.weight),
          from_location_id: parseInt(transferForm.from_location_id),
          to_location_id: parseInt(transferForm.to_location_id),
          remark: transferForm.remark || null
        })
      });

      if (response.ok) {
        toast.success('转移单创建成功');
        setShowTransferForm(false);
        setTransferForm({ product_name: '', weight: '', from_location_id: '', to_location_id: '', remark: '' });
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建失败');
      }
    } catch (error) {
      toast.error('创建失败');
    }
  };

  // 接收转移
  const handleReceiveTransfer = async () => {
    if (!receivingTransfer || !receiveForm.actual_weight) {
      toast.error('请输入实际接收重量');
      return;
    }

    try {
      const response = await fetch(API_ENDPOINTS.TRANSFER_RECEIVE(receivingTransfer.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actual_weight: parseFloat(receiveForm.actual_weight),
          diff_reason: receiveForm.diff_reason || null
        })
      });

      if (response.ok) {
        toast.success('接收成功');
        setReceivingTransfer(null);
        setReceiveForm({ actual_weight: '', diff_reason: '' });
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '接收失败');
      }
    } catch (error) {
      toast.error('接收失败');
    }
  };

  // 拒收转移
  const handleRejectTransfer = async (transfer: InventoryTransfer) => {
    const reason = prompt('请输入拒收原因:');
    if (!reason) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_REJECT(transfer.id)}?reason=${encodeURIComponent(reason)}`, {
        method: 'POST'
      });

      if (response.ok) {
        toast.success('已拒收');
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '拒收失败');
      }
    } catch (error) {
      toast.error('拒收失败');
    }
  };

  // 过滤库存
  const filteredInventory = inventorySummary.filter(item =>
    item.product_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 按位置过滤的库存
  const getInventoryByLocation = (locationId: number) => {
    return inventorySummary
      .map(item => ({
        ...item,
        locations: item.locations.filter(loc => loc.location_id === locationId)
      }))
      .filter(item => item.locations.length > 0);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">分仓库存管理</h1>
            <p className="text-gray-500 mt-1">管理不同位置的库存和货品转移</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => { loadInventorySummary(); loadTransfers(); }}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>
            {locations.length === 0 && (
              <button
                onClick={initDefaultLocations}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>初始化位置</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex space-x-3 mb-6">
          <TabButton
            active={activeTab === 'inventory'}
            onClick={() => setActiveTab('inventory')}
            icon={<Package className="w-4 h-4" />}
            label="库存总览"
          />
          <TabButton
            active={activeTab === 'transfer'}
            onClick={() => setActiveTab('transfer')}
            icon={<Send className="w-4 h-4" />}
            label="发起转移"
          />
          <TabButton
            active={activeTab === 'receive'}
            onClick={() => setActiveTab('receive')}
            icon={<Inbox className="w-4 h-4" />}
            label="待接收"
            count={pendingTransfers.length}
          />
        </div>

        {/* Tab 内容 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          {/* 库存总览 */}
          {activeTab === 'inventory' && (
            <div>
              {/* 搜索和筛选 */}
              <div className="flex space-x-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索商品名称..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={selectedLocation || ''}
                  onChange={(e) => setSelectedLocation(e.target.value ? parseInt(e.target.value) : null)}
                  className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">全部位置</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>

              {/* 位置卡片 */}
              {!selectedLocation && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {locations.map(loc => {
                    const locInventory = getInventoryByLocation(loc.id);
                    const totalWeight = locInventory.reduce((sum, item) => 
                      sum + item.locations.reduce((s, l) => s + l.weight, 0), 0
                    );
                    const productCount = locInventory.length;
                    
                    return (
                      <div
                        key={loc.id}
                        onClick={() => setSelectedLocation(loc.id)}
                        className={`p-4 rounded-xl cursor-pointer transition-all hover:shadow-md ${
                          loc.location_type === 'warehouse'
                            ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                            : 'bg-gradient-to-br from-green-500 to-green-600 text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <MapPin className="w-5 h-5 opacity-80" />
                          <span className="text-xs opacity-80">{loc.code}</span>
                        </div>
                        <h3 className="font-bold text-lg mb-2">{loc.name}</h3>
                        <div className="flex justify-between text-sm opacity-90">
                          <span>{productCount} 种商品</span>
                          <span>{totalWeight.toFixed(1)}g</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 库存列表 */}
              {loading ? (
                <div className="text-center py-12 text-gray-500">加载中...</div>
              ) : filteredInventory.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无库存数据</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(selectedLocation 
                    ? getInventoryByLocation(selectedLocation) 
                    : filteredInventory
                  ).map(item => (
                    <div key={item.product_name} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-gray-900">{item.product_name}</h4>
                        <span className="text-lg font-bold text-blue-600">{item.total_weight.toFixed(1)}g</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.locations.map(loc => (
                          <span
                            key={loc.id}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700"
                          >
                            <MapPin className="w-3 h-3 mr-1" />
                            {loc.location_name}: {loc.weight.toFixed(1)}g
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 发起转移 */}
          {activeTab === 'transfer' && (
            <div>
              {!showTransferForm ? (
                <div className="text-center py-12">
                  <Send className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-4">将货品从一个位置转移到另一个位置</p>
                  <button
                    onClick={() => setShowTransferForm(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4 inline mr-2" />
                    新建转移单
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateTransfer} className="max-w-lg mx-auto space-y-4">
                  <h3 className="text-lg font-semibold mb-4">新建货品转移单</h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">商品名称</label>
                    <select
                      value={transferForm.product_name}
                      onChange={(e) => setTransferForm({ ...transferForm, product_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="">选择商品</option>
                      {inventorySummary.map(item => (
                        <option key={item.product_name} value={item.product_name}>
                          {item.product_name} (总库存: {item.total_weight.toFixed(1)}g)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">转移重量 (g)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={transferForm.weight}
                      onChange={(e) => setTransferForm({ ...transferForm, weight: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="输入转移重量"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">发出位置</label>
                      <select
                        value={transferForm.from_location_id}
                        onChange={(e) => setTransferForm({ ...transferForm, from_location_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">选择发出位置</option>
                        {locations.map(loc => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">目标位置</label>
                      <select
                        value={transferForm.to_location_id}
                        onChange={(e) => setTransferForm({ ...transferForm, to_location_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">选择目标位置</option>
                        {locations.filter(l => l.id.toString() !== transferForm.from_location_id).map(loc => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                    <textarea
                      value={transferForm.remark}
                      onChange={(e) => setTransferForm({ ...transferForm, remark: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      placeholder="输入备注信息"
                    />
                  </div>

                  <div className="flex space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowTransferForm(false)}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      确认转移
                    </button>
                  </div>
                </form>
              )}

              {/* 转移记录 */}
              {transfers.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold mb-4">转移记录</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">转移单号</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">商品</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">重量</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">路径</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {transfers.slice(0, 10).map(t => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-mono">{t.transfer_no}</td>
                            <td className="px-4 py-3 text-sm">{t.product_name}</td>
                            <td className="px-4 py-3 text-sm font-semibold">{t.weight}g</td>
                            <td className="px-4 py-3 text-sm">
                              <span className="text-gray-600">{t.from_location_name}</span>
                              <ArrowRight className="w-4 h-4 inline mx-2 text-gray-400" />
                              <span className="text-gray-600">{t.to_location_name}</span>
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(t.created_at).toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 待接收 */}
          {activeTab === 'receive' && (
            <div>
              {pendingTransfers.length === 0 ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无待接收的货品</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingTransfers.map(t => (
                    <div key={t.id} className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <span className="font-mono text-sm text-gray-500">{t.transfer_no}</span>
                            <StatusBadge status={t.status} />
                          </div>
                          <h4 className="font-semibold text-gray-900 text-lg mb-2">{t.product_name}</h4>
                          <div className="flex items-center text-gray-600 mb-2">
                            <MapPin className="w-4 h-4 mr-1" />
                            <span>{t.from_location_name}</span>
                            <ArrowRight className="w-4 h-4 mx-2" />
                            <span className="font-semibold">{t.to_location_name}</span>
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span>预期重量: <strong className="text-gray-900">{t.weight}g</strong></span>
                            <span>发起人: {t.created_by}</span>
                            <span>时间: {new Date(t.created_at).toLocaleString('zh-CN')}</span>
                          </div>
                          {t.remark && (
                            <p className="mt-2 text-sm text-gray-600">备注: {t.remark}</p>
                          )}
                        </div>
                        <div className="flex space-x-2 ml-4">
                          <button
                            onClick={() => {
                              setReceivingTransfer(t);
                              setReceiveForm({ actual_weight: t.weight.toString(), diff_reason: '' });
                            }}
                            className="flex items-center space-x-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <Check className="w-4 h-4" />
                            <span>确认接收</span>
                          </button>
                          <button
                            onClick={() => handleRejectTransfer(t)}
                            className="flex items-center space-x-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                          >
                            <X className="w-4 h-4" />
                            <span>拒收</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 接收确认弹窗 */}
        {receivingTransfer && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">确认接收货品</h3>
              
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-1">转移单号: {receivingTransfer.transfer_no}</p>
                <p className="font-semibold">{receivingTransfer.product_name}</p>
                <p className="text-sm text-gray-600">预期重量: {receivingTransfer.weight}g</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">实际接收重量 (g)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={receiveForm.actual_weight}
                    onChange={(e) => setReceiveForm({ ...receiveForm, actual_weight: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  {parseFloat(receiveForm.actual_weight) !== receivingTransfer.weight && (
                    <p className="mt-1 text-sm text-yellow-600 flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      差异: {(parseFloat(receiveForm.actual_weight) - receivingTransfer.weight).toFixed(2)}g
                    </p>
                  )}
                </div>

                {parseFloat(receiveForm.actual_weight) !== receivingTransfer.weight && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">差异原因</label>
                    <textarea
                      value={receiveForm.diff_reason}
                      onChange={(e) => setReceiveForm({ ...receiveForm, diff_reason: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                      placeholder="请说明重量差异的原因"
                    />
                  </div>
                )}
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setReceivingTransfer(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleReceiveTransfer}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  确认接收
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WarehousePage;


