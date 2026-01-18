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
  quantity: number;  // 库存数量（件数）
  total_amount: number;  // 库存金额（含工费）
  locations: LocationInventory[];
}

interface BarcodeInventoryItem {
  id: number;
  product_code: string;
  product_name: string;
  weight: number;
  labor_cost: number;
  piece_count: number | null;
  piece_labor_cost: number | null;
  total_cost: number;
  supplier: string | null;
  order_no: string;
  inbound_time: string | null;
  status: string;
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

// Tab 组件 - 珠宝风格
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${
      active
        ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
        : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
    }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
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

// 角色与负责仓库的映射
const ROLE_LOCATION_MAP: Record<string, string> = {
  'counter': '展厅',        // 柜员负责展厅
  'product': '商品部仓库',   // 商品专员负责商品部仓库
};

interface WarehousePageProps {
  userRole?: string;
}

export const WarehousePage: React.FC<WarehousePageProps> = ({ userRole = 'product' }) => {
  const [activeTab, setActiveTab] = useState<'inventory' | 'transfer' | 'receive'>('inventory');
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<InventoryTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  
  // 视图切换：按品名 / 按条码
  const [inventoryViewMode, setInventoryViewMode] = useState<'byName' | 'byBarcode'>('byName');
  const [barcodeInventory, setBarcodeInventory] = useState<BarcodeInventoryItem[]>([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  
  // 展开的商品名称（用于按品名视图中查看条码明细）
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

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

  // 切换商品展开状态
  const toggleProductExpand = async (productName: string) => {
    const newSet = new Set(expandedProducts);
    if (newSet.has(productName)) {
      newSet.delete(productName);
    } else {
      newSet.add(productName);
      // 如果条码数据还没加载，先加载
      if (barcodeInventory.length === 0) {
        await loadBarcodeInventory();
      }
    }
    setExpandedProducts(newSet);
  };
  
  // 获取某个商品名称下的所有条码明细
  const getProductBarcodes = (productName: string) => {
    return barcodeInventory.filter(item => item.product_name === productName);
  };

  // 加载按条码库存
  const loadBarcodeInventory = async (search?: string) => {
    setBarcodeLoading(true);
    try {
      const url = search 
        ? `${API_ENDPOINTS.API_BASE_URL}/api/inventory/by-barcode?search=${encodeURIComponent(search)}&limit=200`
        : `${API_ENDPOINTS.API_BASE_URL}/api/inventory/by-barcode?limit=200`;
      const response = await fetch(url);
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setBarcodeInventory(result.data || []);
        }
      }
    } catch (error) {
      console.error('加载条码库存失败:', error);
    } finally {
      setBarcodeLoading(false);
    }
  };

  const loadTransfers = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.TRANSFERS);
      if (response.ok) {
        const data = await response.json();
        setTransfers(data);
        
        // 根据角色过滤待接收的转移单
        // 只显示目标仓库属于当前角色管辖的转移单
        const myResponsibleLocation = ROLE_LOCATION_MAP[userRole];
        if (myResponsibleLocation) {
          // 有明确的责任仓库，只显示目标是该仓库的待接收单
          setPendingTransfers(
            data.filter((t: InventoryTransfer) => 
              t.status === 'pending' && t.to_location_name === myResponsibleLocation
            )
          );
        } else {
          // 管理员等角色可以看到所有待接收
          setPendingTransfers(data.filter((t: InventoryTransfer) => t.status === 'pending'));
        }
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 - 珠宝风格 */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl shadow-lg shadow-blue-200/50">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">分仓库存管理</h1>
              <p className="text-gray-500 text-sm">管理库存和货品转移</p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => { loadInventorySummary(); loadTransfers(); }}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white 
                rounded-xl shadow-lg shadow-amber-200/50 hover:from-amber-600 hover:to-yellow-600 
                transition-all font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>
            {locations.length === 0 && (
              <button
                onClick={initDefaultLocations}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm font-medium"
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
              {/* 视图切换按钮 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => {
                      setInventoryViewMode('byName');
                    }}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      inventoryViewMode === 'byName'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    按品名
                  </button>
                  <button
                    onClick={() => {
                      setInventoryViewMode('byBarcode');
                      if (barcodeInventory.length === 0) {
                        loadBarcodeInventory(searchTerm || undefined);
                      }
                    }}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      inventoryViewMode === 'byBarcode'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    按条码
                  </button>
                </div>
                <span className="text-sm text-gray-500">
                  {inventoryViewMode === 'byName' 
                    ? `${filteredInventory.length} 种商品`
                    : `${barcodeInventory.length} 条记录`
                  }
                </span>
              </div>

              {/* 搜索和筛选 */}
              <div className="flex space-x-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder={inventoryViewMode === 'byName' ? "搜索商品名称..." : "搜索条码或商品名称..."}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      if (inventoryViewMode === 'byBarcode') {
                        // 延迟搜索
                        const timer = setTimeout(() => {
                          loadBarcodeInventory(e.target.value || undefined);
                        }, 500);
                        return () => clearTimeout(timer);
                      }
                    }}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {inventoryViewMode === 'byName' && (
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
                )}
              </div>

              {/* 按品名视图 */}
              {inventoryViewMode === 'byName' && (
                <>
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

                  {/* 库存列表 - 按品名 */}
                  {loading ? (
                    <div className="text-center py-12 text-gray-500">加载中...</div>
                  ) : filteredInventory.length === 0 ? (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">暂无库存数据</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium text-gray-600 w-8"></th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">饰品名称</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">明细数量</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">库存重量</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">库存金额</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">仓库分布</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                      {(selectedLocation 
                        ? getInventoryByLocation(selectedLocation) 
                        : filteredInventory
                      ).map(item => (
                        <React.Fragment key={item.product_name}>
                          {/* 商品行 - 可点击展开 */}
                          <tr 
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => toggleProductExpand(item.product_name)}
                          >
                            <td className="px-4 py-3">
                              <ChevronDown 
                                className={`w-4 h-4 text-gray-400 transition-transform ${
                                  expandedProducts.has(item.product_name) ? 'rotate-180' : ''
                                }`} 
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">{item.product_name}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{item.quantity || 0}</td>
                            <td className="px-4 py-3 text-right font-semibold text-blue-600">{item.total_weight.toFixed(2)}g</td>
                            <td className="px-4 py-3 text-right text-green-600">¥{(item.total_amount || 0).toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {item.locations.map(loc => (
                                  <span
                                    key={loc.id}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600"
                                  >
                                    {loc.location_name}: {loc.weight.toFixed(1)}g
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                          
                          {/* 条码明细 - 展开时显示 */}
                          {expandedProducts.has(item.product_name) && (
                            <tr>
                              <td colSpan={6} className="bg-blue-50 p-0">
                                <div className="p-4">
                                  <div className="text-xs text-gray-500 mb-2 font-medium">条码明细：</div>
                                  {getProductBarcodes(item.product_name).length === 0 ? (
                                    <div className="text-sm text-gray-400 py-2">
                                      {barcodeLoading ? '加载中...' : '暂无条码明细数据'}
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
                                      <table className="w-full text-sm">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">条码</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">克重</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">克工费</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">件工费</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">金额小计</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">供应商</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">入库时间</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {getProductBarcodes(item.product_name).map((barcode, idx) => (
                                            <tr key={barcode.id || idx} className="bg-white hover:bg-gray-50">
                                              <td className="px-3 py-2">
                                                <span className="font-mono text-blue-600">
                                                  {barcode.product_code || '-（无编码）'}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2 text-right">{barcode.weight.toFixed(2)}g</td>
                                              <td className="px-3 py-2 text-right">¥{barcode.labor_cost}/g</td>
                                              <td className="px-3 py-2 text-right">{barcode.piece_labor_cost ? `¥${barcode.piece_labor_cost}/件` : '-'}</td>
                                              <td className="px-3 py-2 text-right text-green-600">¥{barcode.total_cost.toFixed(2)}</td>
                                              <td className="px-3 py-2 text-gray-600">{barcode.supplier || '-'}</td>
                                              <td className="px-3 py-2 text-gray-500 text-xs">{barcode.inbound_time || '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                        </tbody>
                        {/* 汇总行 */}
                        <tfoot className="bg-gray-100 font-medium">
                          <tr>
                            <td className="px-4 py-3"></td>
                            <td className="px-4 py-3 text-gray-700">合计</td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {(selectedLocation 
                                ? getInventoryByLocation(selectedLocation) 
                                : filteredInventory
                              ).reduce((sum, item) => sum + (item.quantity || 0), 0)}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-blue-600">
                              {(selectedLocation 
                                ? getInventoryByLocation(selectedLocation) 
                                : filteredInventory
                              ).reduce((sum, item) => sum + item.total_weight, 0).toFixed(2)}g
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-green-600">
                              ¥{(selectedLocation 
                                ? getInventoryByLocation(selectedLocation) 
                                : filteredInventory
                              ).reduce((sum, item) => sum + (item.total_amount || 0), 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-3"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
              )}
                </>
              )}

              {/* 按条码视图 */}
              {inventoryViewMode === 'byBarcode' && (
                <>
                  {barcodeLoading ? (
                    <div className="text-center py-12 text-gray-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                      加载中...
                    </div>
                  ) : barcodeInventory.length === 0 ? (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">暂无入库明细数据</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-3 text-left font-medium text-gray-600">条码号</th>
                            <th className="px-3 py-3 text-left font-medium text-gray-600">饰品名称</th>
                            <th className="px-3 py-3 text-right font-medium text-gray-600">库存重量</th>
                            <th className="px-3 py-3 text-right font-medium text-gray-600">克工费</th>
                            <th className="px-3 py-3 text-right font-medium text-gray-600">件工费</th>
                            <th className="px-3 py-3 text-right font-medium text-gray-600">金额小计</th>
                            <th className="px-3 py-3 text-left font-medium text-gray-600">供应商</th>
                            <th className="px-3 py-3 text-left font-medium text-gray-600">入库单号</th>
                            <th className="px-3 py-3 text-left font-medium text-gray-600">入库时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {barcodeInventory.map(item => (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-3 py-3">
                                <span className="font-mono text-blue-600">{item.product_code}</span>
                              </td>
                              <td className="px-3 py-3 font-medium text-gray-900">{item.product_name}</td>
                              <td className="px-3 py-3 text-right">{item.weight.toFixed(2)}g</td>
                              <td className="px-3 py-3 text-right">¥{item.labor_cost}/g</td>
                              <td className="px-3 py-3 text-right">{item.piece_labor_cost ? `¥${item.piece_labor_cost}/件` : '-'}</td>
                              <td className="px-3 py-3 text-right text-green-600">¥{item.total_cost.toFixed(2)}</td>
                              <td className="px-3 py-3 text-gray-600">{item.supplier || '-'}</td>
                              <td className="px-3 py-3">
                                <span className="text-xs text-gray-500">{item.order_no}</span>
                              </td>
                              <td className="px-3 py-3 text-gray-500">{item.inbound_time || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                        {/* 汇总行 */}
                        <tfoot className="bg-gray-100 font-medium">
                          <tr>
                            <td className="px-3 py-3 text-gray-700">合计</td>
                            <td className="px-3 py-3 text-gray-500">{barcodeInventory.length} 件</td>
                            <td className="px-3 py-3 text-right font-semibold text-blue-600">
                              {barcodeInventory.reduce((sum, item) => sum + item.weight, 0).toFixed(2)}g
                            </td>
                            <td className="px-3 py-3"></td>
                            <td className="px-3 py-3"></td>
                            <td className="px-3 py-3 text-right font-semibold text-green-600">
                              ¥{barcodeInventory.reduce((sum, item) => sum + item.total_cost, 0).toFixed(2)}
                            </td>
                            <td colSpan={3} className="px-3 py-3"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </>
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



