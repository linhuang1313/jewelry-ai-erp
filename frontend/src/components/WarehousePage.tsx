import React, { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  Package, MapPin, ArrowRight, ArrowLeft, Check, X, Clock, RefreshCw,
  Plus, Send, Inbox, AlertTriangle, ChevronDown, Search, Filter, FileText,
  AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

// 带超时的 fetch 封装（默认 10 秒超时）
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 10000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }
    throw error;
  }
};

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

// 转移单类型
interface TransferItem {
  id: number;
  product_name: string;
  weight: number;
  actual_weight: number | null;
  weight_diff: number | null;
  diff_reason: string | null;
}

interface TransferOrder {
  id: number;
  transfer_no: string;
  from_location_id: number;
  to_location_id: number;
  from_location_name: string | null;
  to_location_name: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  remark: string | null;
  received_by: string | null;
  received_at: string | null;
  items: TransferItem[];
  total_weight: number | null;
  total_actual_weight: number | null;
  // 关联信息
  source_order_id: number | null;  // 来源转移单ID
  source_transfer_no: string | null;  // 来源转移单号
  related_order_id: number | null;  // 关联的新转移单ID
  related_transfer_no: string | null;  // 关联的新转移单号
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
    pending_confirm: { bg: 'bg-orange-100', text: 'text-orange-700', label: '待确认' },
    received: { bg: 'bg-green-100', text: 'text-green-700', label: '已接收' },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '已拒收' },
    returned: { bg: 'bg-purple-100', text: 'text-purple-700', label: '已退回' },
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
  const [activeTab, setActiveTab] = useState<'inventory' | 'transfer' | 'batch' | 'receive' | 'confirm'>('inventory');
  const hasAutoSwitched = useRef(false);  // 跟踪是否已自动切换标签页
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);
  
  // 转移单状态（支持多商品）
  const [transferOrders, setTransferOrders] = useState<TransferOrder[]>([]);
  const [pendingTransferOrders, setPendingTransferOrders] = useState<TransferOrder[]>([]);
  const [pendingConfirmTransferOrders, setPendingConfirmTransferOrders] = useState<TransferOrder[]>([]);
  const [loading, setLoading] = useState(false);
  // 独立的加载状态和错误状态（渐进式加载）
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [transfersLoading, setTransfersLoading] = useState(true);
  const [transfersError, setTransfersError] = useState<string | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [inboundLoading, setInboundLoading] = useState(true);
  const [inboundError, setInboundError] = useState<string | null>(null);
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
  
  // 批量转移商品列表
  const [transferItems, setTransferItems] = useState<Array<{ product_name: string; weight: number }>>([]);

  // 接收表单状态
  const [receivingOrder, setReceivingOrder] = useState<TransferOrder | null>(null);
  const [receiveItemForms, setReceiveItemForms] = useState<Record<number, { actual_weight: string; diff_reason: string }>>({});

  // 待确认编辑模式
  const [editOrderId, setEditOrderId] = useState<number | null>(null);
  const [editItemForms, setEditItemForms] = useState<Record<number, { actual_weight: string; diff_reason: string }>>({});

  // 批量转移相关状态
  const [batchOrderNo, setBatchOrderNo] = useState('');
  const [batchItems, setBatchItems] = useState<Array<{
    id: number;
    product_name: string;
    weight: number;
    transfer_weight: number;
    selected: boolean;
    order_no: string;  // 来源入库单号
  }>>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());  // 已选择的入库单ID
  const [batchLoading, setBatchLoading] = useState(false);
  const [recentInboundOrders, setRecentInboundOrders] = useState<Array<{
    id: number;
    order_no: string;
    create_time: string;
    item_count: number;
    total_weight: number;
    suppliers: string[];
    transferred_weight: number;  // 已转移重量
    details: Array<{
      product_name: string;
      weight: number;
      fineness?: string;
      craft?: string;
    }>;
  }>>([]);
  
  // 日期筛选
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('all');
  // 隐藏已转移入库单
  const [hideTransferred, setHideTransferred] = useState(false);
  // 确认弹窗
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'quick' | 'batch' | null>(null);

  // 加载数据 - 使用 Promise.all 并行加载提升性能
  useEffect(() => {
    const loadAllData = async () => {
      await Promise.all([
        loadLocations(),
        loadInventorySummary(),
        loadTransfers(),
        loadRecentInboundOrders()
      ]);
    };
    loadAllData();
  }, []);

  const loadLocations = async () => {
    setLocationsLoading(true);
    setLocationsError(null);
    try {
      const response = await fetchWithTimeout(API_ENDPOINTS.LOCATIONS, {}, 10000);
      if (response.ok) {
        const data = await response.json();
        setLocations(data);
        
        // 根据角色设置默认的发出位置和目标位置
        const productLoc = data.find((l: Location) => l.name === '商品部仓库');
        const showroomLoc = data.find((l: Location) => l.name === '展厅');
        
        if (userRole === 'product' && productLoc && showroomLoc) {
          // 商品专员：发出位置默认商品部，目标位置默认展厅
          setTransferForm(prev => ({
            ...prev,
            from_location_id: productLoc.id.toString(),
            to_location_id: showroomLoc.id.toString()
          }));
        } else if (userRole === 'counter' && productLoc && showroomLoc) {
          // 柜台：发出位置默认展厅，目标位置默认商品部
          setTransferForm(prev => ({
            ...prev,
            from_location_id: showroomLoc.id.toString(),
            to_location_id: productLoc.id.toString()
          }));
        }
      } else {
        setLocationsError('加载仓库位置失败');
      }
    } catch (error: any) {
      console.error('加载位置失败:', error);
      setLocationsError(error.message || '加载仓库位置失败，请重试');
    } finally {
      setLocationsLoading(false);
    }
  };

  const loadInventorySummary = async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const response = await fetchWithTimeout(API_ENDPOINTS.INVENTORY_SUMMARY, {}, 15000);
      if (response.ok) {
        const data = await response.json();
        setInventorySummary(data);
      } else {
        setInventoryError('加载库存数据失败，请重试');
      }
    } catch (error: any) {
      console.error('加载库存汇总失败:', error);
      setInventoryError(error.message || '加载库存数据失败，请重试');
    } finally {
      setInventoryLoading(false);
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
    setTransfersLoading(true);
    setTransfersError(null);
    try {
      const response = await fetchWithTimeout(API_ENDPOINTS.TRANSFER_ORDERS, {}, 15000);
      if (response.ok) {
        const data = await response.json();
        setTransferOrders(data);
        
        // 根据角色过滤待接收的转移单
        const myResponsibleLocation = ROLE_LOCATION_MAP[userRole];
        if (myResponsibleLocation) {
          setPendingTransferOrders(
            data.filter((t: TransferOrder) => 
              t.status === 'pending' && t.to_location_name === myResponsibleLocation
            )
          );
        } else {
          setPendingTransferOrders(data.filter((t: TransferOrder) => t.status === 'pending'));
        }
        
        // 待确认转移单
        if (userRole === 'product' || userRole === 'manager') {
          setPendingConfirmTransferOrders(
            data.filter((t: TransferOrder) => t.status === 'pending_confirm')
          );
        } else {
          setPendingConfirmTransferOrders([]);
        }
      } else {
        setTransfersError('加载转移单失败，请重试');
      }
    } catch (error: any) {
      console.error('加载转移单失败:', error);
      setTransfersError(error.message || '加载转移单失败，请重试');
    } finally {
      setTransfersLoading(false);
    }
  };

  // 自动切换到有待处理数据的标签页（仅首次加载时）
  useEffect(() => {
    if (hasAutoSwitched.current) return;
    
    // 柜台用户：如果有待接收的转移单，自动切换到"待接收"标签页
    if ((userRole === 'counter' || userRole === 'manager') && pendingTransferOrders.length > 0) {
      setActiveTab('receive');
      hasAutoSwitched.current = true;
    }
    // 商品专员：如果有待确认的转移单，自动切换到"待确认"标签页
    else if ((userRole === 'product' || userRole === 'manager') && pendingConfirmTransferOrders.length > 0) {
      setActiveTab('confirm');
      hasAutoSwitched.current = true;
    }
  }, [pendingTransferOrders, pendingConfirmTransferOrders, userRole]);

  // 加载最近入库单（供批量转移选择）
  const loadRecentInboundOrders = async () => {
    setInboundLoading(true);
    setInboundError(null);
    try {
      const response = await fetchWithTimeout(`${API_ENDPOINTS.API_BASE_URL}/api/inbound-orders?limit=30`, {}, 15000);
      const data = await response.json();
      if (data.success && data.data) {
        setRecentInboundOrders(data.data.map((order: any) => ({
          id: order.id,
          order_no: order.order_no,
          create_time: order.create_time,
          item_count: order.item_count,
          total_weight: order.total_weight,
          suppliers: order.suppliers || [],
          transferred_weight: order.transferred_weight || 0,  // 已转移重量
          details: (order.details || []).map((d: any) => ({
            product_name: d.product_name,
            weight: d.weight,
            fineness: d.fineness,
            craft: d.craft
          }))
        })));
      } else {
        setInboundError('加载入库单数据失败');
      }
    } catch (error: any) {
      console.error('加载入库单失败:', error);
      setInboundError(error.message || '加载入库单失败，请重试');
    } finally {
      setInboundLoading(false);
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

  // 根据入库单号查询商品（单个入库单）
  const handleSearchByOrderNo = async (orderNoOverride?: string) => {
    const orderNoToSearch = orderNoOverride || batchOrderNo.trim();
    if (!orderNoToSearch) {
      toast.error('请输入入库单号');
      return;
    }
    
    if (orderNoOverride) {
      setBatchOrderNo(orderNoOverride);
    }
    
    setBatchLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/inbound-orders?order_no=${encodeURIComponent(orderNoToSearch)}&limit=1`);
      const data = await response.json();
      
      if (data.success && data.data && data.data.length > 0) {
        const order = data.data[0];
        const items = order.details.map((d: any, idx: number) => ({
          id: idx,
          product_name: d.product_name,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no
        }));
        setBatchItems(items);
        setSelectedOrderIds(new Set());  // 清除多选状态
        toast.success(`找到 ${items.length} 个商品`);
      } else {
        toast.error('未找到该入库单');
        setBatchItems([]);
      }
    } catch (error) {
      toast.error('查询失败');
      setBatchItems([]);
    } finally {
      setBatchLoading(false);
    }
  };

  // 加载已选择的多个入库单商品
  const handleLoadSelectedOrders = () => {
    if (selectedOrderIds.size === 0) {
      toast.error('请先选择入库单');
      return;
    }
    
    const selectedOrders = recentInboundOrders.filter(o => selectedOrderIds.has(o.id));
    let itemId = 0;
    const allItems: typeof batchItems = [];
    
    selectedOrders.forEach(order => {
      order.details.forEach(d => {
        allItems.push({
          id: itemId++,
          product_name: d.product_name,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no
        });
      });
    });
    
    setBatchItems(allItems);
    toast.success(`已加载 ${selectedOrders.length} 个入库单，共 ${allItems.length} 个商品`);
  };

  // 一键全量转移
  const handleQuickTransferAll = async () => {
    if (selectedOrderIds.size === 0) {
      toast.error('请先选择入库单');
      return;
    }
    
    const selectedOrders = recentInboundOrders.filter(o => selectedOrderIds.has(o.id));
    let itemId = 0;
    const allItems: typeof batchItems = [];
    
    selectedOrders.forEach(order => {
      order.details.forEach(d => {
        allItems.push({
          id: itemId++,
          product_name: d.product_name,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no
        });
      });
    });
    
    if (allItems.length === 0) {
      toast.error('选中的入库单没有商品');
      return;
    }
    
    // 获取默认位置
    const productLoc = locations.find(l => l.name === '商品部仓库');
    const showroomLoc = locations.find(l => l.name === '展厅');
    
    let fromLocationId = productLoc?.id;
    let toLocationId = showroomLoc?.id;
    
    if (userRole === 'counter') {
      fromLocationId = showroomLoc?.id;
      toLocationId = productLoc?.id;
    }
    
    if (!fromLocationId || !toLocationId) {
      toast.error('位置配置错误');
      return;
    }
    
    // 构建备注（包含所有入库单号）
    const orderNos = selectedOrders.map(o => o.order_no).join('、');
    
    setBatchLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFERS_BATCH}?user_role=${userRole}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: allItems.map(item => ({
            product_name: item.product_name,
            weight: item.transfer_weight
          })),
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          remark: `来自入库单 ${orderNos}`
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        setSelectedOrderIds(new Set());
        setBatchItems([]);
        loadTransfers();
        loadInventorySummary();
        loadRecentInboundOrders();
      } else {
        toast.error(result.detail || '批量转移失败');
      }
    } catch (error) {
      toast.error('批量转移失败');
    } finally {
      setBatchLoading(false);
    }
  };

  // 切换入库单选择
  const toggleOrderSelection = (orderId: number) => {
    const newSet = new Set(selectedOrderIds);
    if (newSet.has(orderId)) {
      newSet.delete(orderId);
    } else {
      newSet.add(orderId);
    }
    setSelectedOrderIds(newSet);
  };

  // 筛选后的入库单列表
  const filteredInboundOrders = recentInboundOrders.filter(order => {
    // 日期筛选
    if (dateFilter !== 'all' && order.create_time) {
      const orderDate = new Date(order.create_time);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      if (dateFilter === 'today') {
        if (orderDate < todayStart) return false;
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(todayStart);
        weekAgo.setDate(weekAgo.getDate() - 7);
        if (orderDate < weekAgo) return false;
      } else if (dateFilter === 'month') {
        const monthAgo = new Date(todayStart);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        if (orderDate < monthAgo) return false;
      }
    }
    
    // 隐藏已转移
    if (hideTransferred && order.transferred_weight >= order.total_weight) {
      return false;
    }
    
    return true;
  });

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedOrderIds.size === filteredInboundOrders.length) {
      // 已全选，取消全选
      setSelectedOrderIds(new Set());
    } else {
      // 全选
      setSelectedOrderIds(new Set(filteredInboundOrders.map(o => o.id)));
    }
  };

  // 打开确认弹窗
  const openConfirmModal = (action: 'quick' | 'batch') => {
    setConfirmAction(action);
    setShowConfirmModal(true);
  };

  // 确认转移
  const handleConfirmTransfer = () => {
    setShowConfirmModal(false);
    if (confirmAction === 'quick') {
      handleQuickTransferAll();
    } else if (confirmAction === 'batch') {
      handleBatchTransfer();
    }
  };

  // 批量创建转移单
  const handleBatchTransfer = async () => {
    const selectedItems = batchItems.filter(item => item.selected && item.transfer_weight > 0);
    
    if (selectedItems.length === 0) {
      toast.error('请选择要转移的商品');
      return;
    }
    
    // 获取默认位置
    const productLoc = locations.find(l => l.name === '商品部仓库');
    const showroomLoc = locations.find(l => l.name === '展厅');
    
    let fromLocationId = productLoc?.id;
    let toLocationId = showroomLoc?.id;
    
    if (userRole === 'counter') {
      fromLocationId = showroomLoc?.id;
      toLocationId = productLoc?.id;
    }
    
    if (!fromLocationId || !toLocationId) {
      toast.error('位置配置错误');
      return;
    }
    
    // 构建备注（收集所有不同的入库单号）
    const orderNos = [...new Set(selectedItems.map(item => item.order_no).filter(Boolean))];
    const remarkText = orderNos.length > 0 
      ? `来自入库单 ${orderNos.join('、')}`
      : (batchOrderNo ? `来自入库单 ${batchOrderNo}` : '批量转移');
    
    setBatchLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFERS_BATCH}?user_role=${userRole}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItems.map(item => ({
            product_name: item.product_name,
            weight: item.transfer_weight
          })),
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          remark: remarkText
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        setBatchOrderNo('');
        setBatchItems([]);
        setSelectedOrderIds(new Set());
        loadTransfers();
        loadInventorySummary();
        loadRecentInboundOrders();
      } else {
        toast.error(result.detail || '批量转移失败');
      }
    } catch (error) {
      toast.error('批量转移失败');
    } finally {
      setBatchLoading(false);
    }
  };

  // 创建转移单
  // 添加商品到批量转移列表
  const handleAddToTransferList = () => {
    if (!transferForm.product_name || !transferForm.weight) {
      toast.error('请选择商品并输入重量');
      return;
    }
    
    const weight = parseFloat(transferForm.weight);
    if (weight <= 0) {
      toast.error('重量必须大于0');
      return;
    }
    
    // 检查是否超出可转移重量
    const fromLocationName = locations.find(l => l.id.toString() === transferForm.from_location_id)?.name;
    const item = inventorySummary.find(i => i.product_name === transferForm.product_name);
    const locInventory = item?.locations.find(loc => loc.location_name === fromLocationName);
    const availableWeight = locInventory?.weight || 0;
    
    // 计算已添加到列表中的同商品重量
    const alreadyAdded = transferItems
      .filter(i => i.product_name === transferForm.product_name)
      .reduce((sum, i) => sum + i.weight, 0);
    
    if (weight + alreadyAdded > availableWeight) {
      toast.error(`超出可转移重量！${fromLocationName}仅有 ${availableWeight.toFixed(2)}g，已添加 ${alreadyAdded.toFixed(2)}g`);
      return;
    }
    
    // 添加到列表
    setTransferItems([...transferItems, { product_name: transferForm.product_name, weight }]);
    
    // 清空当前选择但保留位置
    setTransferForm({ ...transferForm, product_name: '', weight: '' });
    toast.success(`已添加 ${transferForm.product_name} ${weight}g 到转移列表`);
  };
  
  // 从批量转移列表移除商品
  const handleRemoveFromTransferList = (index: number) => {
    const newItems = [...transferItems];
    newItems.splice(index, 1);
    setTransferItems(newItems);
  };
  
  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!transferForm.from_location_id || !transferForm.to_location_id) {
      toast.error('请选择转移位置');
      return;
    }
    
    // 如果列表为空但表单有数据，先添加到列表
    let itemsToTransfer = [...transferItems];
    if (transferForm.product_name && transferForm.weight) {
      const weight = parseFloat(transferForm.weight);
      if (weight > 0) {
        itemsToTransfer.push({ product_name: transferForm.product_name, weight });
      }
    }
    
    if (itemsToTransfer.length === 0) {
      toast.error('请添加至少一个商品');
      return;
    }

    try {
      // 使用新版转移单 API（支持多商品）
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDERS}?user_role=${userRole}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location_id: parseInt(transferForm.from_location_id),
          to_location_id: parseInt(transferForm.to_location_id),
          items: itemsToTransfer,
          remark: transferForm.remark || null
        })
      });

      if (response.ok) {
        const result = await response.json();
        const totalWeight = result.total_weight || itemsToTransfer.reduce((sum: number, item: { weight: number }) => sum + item.weight, 0);
        toast.success(`成功创建转移单 ${result.transfer_no}，共 ${result.items.length} 个商品，${totalWeight.toFixed(2)}g`);
        setShowTransferForm(false);
        setTransferItems([]);
        // 重置表单但保留默认位置
        const productLoc = locations.find(l => l.name === '商品部仓库');
        const showroomLoc = locations.find(l => l.name === '展厅');
        let defaultFrom = '';
        let defaultTo = '';
        if (userRole === 'product' && productLoc && showroomLoc) {
          defaultFrom = productLoc.id.toString();
          defaultTo = showroomLoc.id.toString();
        } else if (userRole === 'counter' && productLoc && showroomLoc) {
          defaultFrom = showroomLoc.id.toString();
          defaultTo = productLoc.id.toString();
        }
        setTransferForm({ product_name: '', weight: '', from_location_id: defaultFrom, to_location_id: defaultTo, remark: '' });
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

  // ============= 转移单操作函数 =============
  
  // 打开新版接收弹窗
  const openReceiveOrderModal = (order: TransferOrder) => {
    setReceivingOrder(order);
    // 初始化每个商品的接收表单
    const forms: Record<number, { actual_weight: string; diff_reason: string }> = {};
    order.items.forEach(item => {
      forms[item.id] = { actual_weight: item.weight.toString(), diff_reason: '' };
    });
    setReceiveItemForms(forms);
  };
  
  // 接收转移单（新版多商品）
  const handleReceiveTransferOrder = async () => {
    if (!receivingOrder) return;
    
    // 验证所有商品都填写了实际重量
    const items = receivingOrder.items.map(item => {
      const form = receiveItemForms[item.id];
      const actualWeight = parseFloat(form?.actual_weight || '0');
      const hasDiff = Math.abs(actualWeight - item.weight) >= 0.01;
      return {
        item_id: item.id,
        actual_weight: actualWeight,
        diff_reason: hasDiff ? (form?.diff_reason || '') : null
      };
    });
    
    // 检查有差异的商品是否填写了原因
    for (const item of items) {
      const originalItem = receivingOrder.items.find(i => i.id === item.item_id);
      if (originalItem) {
        const hasDiff = Math.abs(item.actual_weight - originalItem.weight) >= 0.01;
        if (hasDiff && !item.diff_reason) {
          toast.error(`商品 ${originalItem.product_name} 重量不符，请填写差异原因`);
          return;
        }
      }
    }
    
    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDER_RECEIVE(receivingOrder.id)}?user_role=${userRole}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.status === 'pending_confirm') {
          toast.success('转移单已退回商品部待审核');
        } else {
          toast.success('接收成功');
        }
        
        setReceivingOrder(null);
        setReceiveItemForms({});
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
  
  // 拒收转移单（新版）
  const handleRejectTransferOrder = async (order: TransferOrder) => {
    const reason = prompt('请输入拒收原因:');
    if (!reason) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDER_REJECT(order.id)}?reason=${encodeURIComponent(reason)}&user_role=${userRole}`, {
        method: 'POST'
      });

      if (response.ok) {
        toast.success('已拒收，库存已恢复');
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
  
  const startEditConfirmOrder = (order: TransferOrder) => {
    const forms: Record<number, { actual_weight: string; diff_reason: string }> = {};
    order.items.forEach(item => {
      forms[item.id] = {
        actual_weight: String(item.actual_weight ?? item.weight ?? ''),
        diff_reason: item.diff_reason || ''
      };
    });
    setEditItemForms(forms);
    setEditOrderId(order.id);
  };

  const cancelEditConfirmOrder = () => {
    setEditOrderId(null);
    setEditItemForms({});
  };

  const handleSaveConfirmOrder = async (order: TransferOrder) => {
    const payloadItems = order.items.map(item => {
      const form = editItemForms[item.id];
      const actualWeight = parseFloat(form?.actual_weight || '');
      return {
        item_id: item.id,
        actual_weight: actualWeight,
        diff_reason: form?.diff_reason || ''
      };
    });

    for (const item of order.items) {
      const form = editItemForms[item.id];
      const actualWeight = parseFloat(form?.actual_weight || '');
      if (Number.isNaN(actualWeight) || actualWeight <= 0) {
        toast.error(`商品 ${item.product_name} 实际重量必须大于 0`);
        return;
      }
      const diff = actualWeight - item.weight;
      if (Math.abs(diff) >= 0.01 && !form?.diff_reason?.trim()) {
        toast.error(`商品 ${item.product_name} 重量不符，请填写原因`);
        return;
      }
    }

    try {
      const response = await fetch(
        `${API_ENDPOINTS.TRANSFER_ORDER_UPDATE_ACTUAL(order.id)}?user_role=${userRole}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: payloadItems })
        }
      );

      if (response.ok) {
        toast.success('已保存实际重量');
        cancelEditConfirmOrder();
        loadTransfers();
      } else {
        const error = await response.json();
        toast.error(error.detail || '保存失败');
      }
    } catch (error) {
      toast.error('保存失败');
    }
  };

  // 商品部确认转移单（同意）
  const handleConfirmTransferOrder = async (order: TransferOrder) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDER_CONFIRM(order.id)}?user_role=${userRole}`, {
        method: 'POST'
      });

      if (response.ok) {
        const totalActual = order.items.reduce((sum, item) => sum + (item.actual_weight || 0), 0);
        toast.success(`已确认，${totalActual.toFixed(2)}g 已入库`);
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    }
  };
  
  // 商品部拒绝确认转移单（库存退回商品部仓库）
  const handleRejectConfirmTransferOrder = async (order: TransferOrder) => {
    const reason = prompt('请输入拒绝原因（库存将退回商品部仓库）:');
    if (!reason) return;

    try {
      const response = await fetch(
        `${API_ENDPOINTS.TRANSFER_ORDER_REJECT_CONFIRM(order.id)}?reason=${encodeURIComponent(reason)}&user_role=${userRole}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const totalWeight = order.items.reduce((sum, item) => sum + item.weight, 0);
        toast.success(`已拒绝，${totalWeight.toFixed(2)}g 已退回商品部仓库`);
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '拒绝失败');
      }
    } catch (error) {
      toast.error('拒绝失败');
    }
  };
  
  // 重新发起退回的转移单
  const handleResubmitTransferOrder = async (order: TransferOrder) => {
    if (!confirm(`确定要重新发起转移单 ${order.transfer_no} 吗？\n\n将基于原单创建新的转移单，原单记录保留用于审计追溯。`)) {
      return;
    }

    try {
      const response = await fetch(
        `${API_ENDPOINTS.TRANSFER_ORDER_RESUBMIT(order.id)}?user_role=${userRole}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const result = await response.json();
        toast.success(`已重新发起，新单号: ${result.transfer_no}`);
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '重新发起失败');
      }
    } catch (error) {
      toast.error('重新发起失败');
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
          {/* 发起转移 - 仅商品专员和管理员可见 */}
          {(userRole === 'product' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'transfer'}
              onClick={() => setActiveTab('transfer')}
              icon={<Send className="w-4 h-4" />}
              label="发起转移"
            />
          )}
          {/* 按单号转移 - 仅商品专员和管理员可见 */}
          {(userRole === 'product' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'batch'}
              onClick={() => setActiveTab('batch')}
              icon={<FileText className="w-4 h-4" />}
              label="按单号转移"
            />
          )}
          {/* 待接收 - 仅柜台和管理员可见 */}
          {(userRole === 'counter' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'receive'}
              onClick={() => setActiveTab('receive')}
              icon={<Inbox className="w-4 h-4" />}
              label="待接收"
              count={pendingTransferOrders.length}
            />
          )}
          {/* 待确认标签页 - 仅商品专员和管理员可见 */}
          {(userRole === 'product' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'confirm'}
              onClick={() => setActiveTab('confirm')}
              icon={<Check className="w-4 h-4" />}
              label="待确认"
              count={pendingConfirmTransferOrders.length}
            />
          )}
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
                    {locations
                      .filter(loc => userRole !== 'counter' || loc.location_type === 'showroom')
                      .map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                  </select>
                )}
              </div>

              {/* 按品名视图 */}
              {inventoryViewMode === 'byName' && (
                <>
                  {/* 位置卡片 - 柜台只显示展厅 */}
                  {!selectedLocation && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      {locations
                        .filter(loc => userRole !== 'counter' || loc.location_type === 'showroom')
                        .map(loc => {
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
                  {inventoryLoading ? (
                    <div className="text-center py-12 text-gray-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                      加载中...
                    </div>
                  ) : inventoryError ? (
                    <div className="text-center py-12">
                      <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
                      <p className="text-red-500 mb-4">{inventoryError}</p>
                      <button
                        onClick={loadInventorySummary}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                      >
                        点击重试
                      </button>
                    </div>
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
                            {userRole !== 'counter' && (
                              <th className="px-4 py-3 text-right font-medium text-gray-600">库存金额</th>
                            )}
                            <th className="px-4 py-3 text-left font-medium text-gray-600">仓库分布</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                      {(selectedLocation 
                        ? getInventoryByLocation(selectedLocation) 
                        : filteredInventory
                      )
                      .filter(item => {
                        // 柜台用户：只显示展厅有库存的商品
                        if (userRole === 'counter') {
                          const showroomWeight = item.locations
                            .filter(l => l.location_name === '展厅')
                            .reduce((s, l) => s + l.weight, 0);
                          return showroomWeight > 0;
                        }
                        // 其他角色：显示总库存大于0的商品
                        return item.total_weight > 0;
                      })
                      .map(item => (
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
                            <td className="px-4 py-3 text-right font-semibold text-blue-600">
                              {(userRole === 'counter'
                                ? item.locations.filter(l => l.location_name === '展厅').reduce((s, l) => s + l.weight, 0)
                                : item.total_weight
                              ).toFixed(2)}g
                            </td>
                            {userRole !== 'counter' && (
                              <td className="px-4 py-3 text-right text-green-600">¥{(item.total_amount || 0).toFixed(2)}</td>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {item.locations
                                  .filter(loc => userRole !== 'counter' || loc.location_name === '展厅')
                                  .map(loc => (
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
                  
                  {/* 根据角色显示固定的位置信息 */}
                  {(userRole === 'product' || userRole === 'counter') && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-blue-700">
                          {userRole === 'product' ? '商品部仓库' : '展厅'}
                        </span>
                        <ArrowRight className="w-4 h-4 text-blue-500" />
                        <span className="text-blue-700">
                          {userRole === 'product' ? '展厅' : '商品部仓库'}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">商品名称</label>
                    <select
                      value={transferForm.product_name}
                      onChange={(e) => setTransferForm({ ...transferForm, product_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">选择商品</option>
                      {(() => {
                        // 获取当前发出位置名称
                        const fromLocationName = locations.find(l => l.id.toString() === transferForm.from_location_id)?.name;
                        
                        // 根据角色过滤：只显示发出位置有库存的商品
                        return inventorySummary
                          .filter(item => {
                            if (!fromLocationName) return true;
                            // 查找该位置的库存
                            const locInventory = item.locations.find(loc => loc.location_name === fromLocationName);
                            return locInventory && locInventory.weight > 0;
                          })
                          .map(item => {
                            // 获取发出位置的库存
                            const locInventory = item.locations.find(loc => loc.location_name === fromLocationName);
                            const availableWeight = locInventory?.weight || 0;
                            
                            return (
                              <option key={item.product_name} value={item.product_name}>
                                {item.product_name} ({fromLocationName || '总库存'}: {availableWeight.toFixed(1)}g)
                              </option>
                            );
                          });
                      })()}
                    </select>
                  </div>

                  {/* 显示可转移重量提示 */}
                  {transferForm.product_name && transferForm.from_location_id && (() => {
                    const fromLocationName = locations.find(l => l.id.toString() === transferForm.from_location_id)?.name;
                    const item = inventorySummary.find(i => i.product_name === transferForm.product_name);
                    const locInventory = item?.locations.find(loc => loc.location_name === fromLocationName);
                    const availableWeight = locInventory?.weight || 0;
                    const inputWeight = parseFloat(transferForm.weight) || 0;
                    const isOverLimit = inputWeight > availableWeight;
                    
                    return (
                      <div className={`text-sm px-3 py-2 rounded-lg ${isOverLimit ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                        {isOverLimit ? (
                          <span className="flex items-center">
                            <AlertTriangle className="w-4 h-4 mr-1" />
                            超出可转移重量！{fromLocationName}仅有 {availableWeight.toFixed(2)}g
                          </span>
                        ) : (
                          <span>可转移重量：{availableWeight.toFixed(2)}g</span>
                        )}
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">转移重量 (g)</label>
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        step="0.01"
                        value={transferForm.weight}
                        onChange={(e) => setTransferForm({ ...transferForm, weight: e.target.value })}
                        className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="输入转移重量"
                      />
                      <button
                        type="button"
                        onClick={handleAddToTransferList}
                        disabled={!transferForm.product_name || !transferForm.weight}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4 inline mr-1" />
                        添加
                      </button>
                    </div>
                  </div>
                  
                  {/* 已添加的商品列表 */}
                  {transferItems.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-700">
                          待转移商品 ({transferItems.length} 项，共 {transferItems.reduce((sum, i) => sum + i.weight, 0).toFixed(2)}g)
                        </span>
                      </div>
                      <div className="space-y-1">
                        {transferItems.map((item, index) => (
                          <div key={index} className="flex items-center justify-between bg-white rounded px-2 py-1 text-sm">
                            <span>{item.product_name}</span>
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">{item.weight}g</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveFromTransferList(index)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 位置选择 - 根据角色决定是否可编辑 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        发出位置
                        {(userRole === 'product' || userRole === 'counter') && (
                          <span className="text-xs text-gray-400 ml-1">(已锁定)</span>
                        )}
                      </label>
                      {userRole === 'product' || userRole === 'counter' ? (
                        <div className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-gray-700">
                          {locations.find(l => l.id.toString() === transferForm.from_location_id)?.name || '未设置'}
                        </div>
                      ) : (
                        <select
                          value={transferForm.from_location_id}
                          onChange={(e) => setTransferForm({ ...transferForm, from_location_id: e.target.value, product_name: '' })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required
                        >
                          <option value="">选择发出位置</option>
                          {locations.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        目标位置
                        {(userRole === 'product' || userRole === 'counter') && (
                          <span className="text-xs text-gray-400 ml-1">(已锁定)</span>
                        )}
                      </label>
                      {userRole === 'product' || userRole === 'counter' ? (
                        <div className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-gray-700">
                          {locations.find(l => l.id.toString() === transferForm.to_location_id)?.name || '未设置'}
                        </div>
                      ) : (
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
                      )}
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
                      onClick={() => { setShowTransferForm(false); setTransferItems([]); }}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={transferItems.length === 0 && (!transferForm.product_name || !transferForm.weight)}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {transferItems.length > 0 
                        ? `确认转移 (${transferItems.length} 项，${transferItems.reduce((sum, i) => sum + i.weight, 0).toFixed(1)}g)`
                        : '确认转移'
                      }
                    </button>
                  </div>
                </form>
              )}

              {/* 转移记录（新版：多商品） */}
              {transferOrders.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold mb-4">转移记录</h3>
                  <div className="space-y-3">
                    {transferOrders.slice(0, 10).map(order => (
                      <div key={order.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        {/* 转移单主信息 */}
                        <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <span className="font-mono text-sm font-medium">{order.transfer_no}</span>
                            <span className="text-sm text-gray-600">
                              {order.from_location_name}
                              <ArrowRight className="w-4 h-4 inline mx-2 text-gray-400" />
                              {order.to_location_name}
                            </span>
                            <StatusBadge status={order.status} />
                            {/* 关联信息 */}
                            {order.source_transfer_no && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                                来源: {order.source_transfer_no}
                              </span>
                            )}
                            {order.related_transfer_no && (
                              <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                                已重新发起: {order.related_transfer_no}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span>{order.items.length} 个商品</span>
                            <span className="font-semibold">{order.total_weight?.toFixed(2) || 0}g</span>
                            <span>{new Date(order.created_at).toLocaleString('zh-CN')}</span>
                            {/* 重新发起按钮 - 仅已退回状态且未重新发起过的转移单 */}
                            {order.status === 'returned' && !order.related_transfer_no && (userRole === 'product' || userRole === 'manager') && (
                              <button
                                onClick={() => handleResubmitTransferOrder(order)}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                              >
                                重新发起
                              </button>
                            )}
                          </div>
                        </div>
                        {/* 商品明细列表 */}
                        <div className="divide-y divide-gray-100">
                          {order.items.map(item => (
                            <div key={item.id} className="px-4 py-2 flex items-center justify-between text-sm">
                              <span className="text-gray-800">{item.product_name}</span>
                              <div className="flex items-center space-x-4">
                                <span className="font-medium">{item.weight}g</span>
                                {item.actual_weight !== null && item.actual_weight !== item.weight && (
                                  <span className={`text-xs ${item.weight_diff && item.weight_diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    实际: {item.actual_weight}g ({item.weight_diff && item.weight_diff > 0 ? '+' : ''}{item.weight_diff?.toFixed(2)}g)
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
            </div>
          )}

          {/* 按单号转移 */}
          {activeTab === 'batch' && (
            <div className="space-y-6">
              {/* 入库单号输入 */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">根据入库单号批量转移</h3>
                <div className="flex items-center space-x-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={batchOrderNo}
                      onChange={(e) => setBatchOrderNo(e.target.value)}
                      placeholder="输入入库单号（如 RK20260119...）"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => handleSearchByOrderNo()}
                    disabled={batchLoading}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 flex items-center space-x-2"
                  >
                    <Search className="w-4 h-4" />
                    <span>{batchLoading ? '查询中...' : '查询'}</span>
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  输入入库单号后，系统会自动获取该入库单的所有商品，您可以选择需要转移的商品
                </p>
              </div>

              {/* 最近入库单快速选择（支持多选） */}
              {batchItems.length === 0 && inboundLoading && (
                <div className="text-center py-12 text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  加载入库单中...
                </div>
              )}
              {batchItems.length === 0 && !inboundLoading && inboundError && (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
                  <p className="text-red-500 mb-4">{inboundError}</p>
                  <button
                    onClick={loadRecentInboundOrders}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    点击重试
                  </button>
                </div>
              )}
              {batchItems.length === 0 && !inboundLoading && !inboundError && recentInboundOrders.length === 0 && (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无入库单数据</p>
                </div>
              )}
              {batchItems.length === 0 && !inboundLoading && !inboundError && recentInboundOrders.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  {/* 筛选栏 */}
                  <div className="px-6 py-3 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">日期：</span>
                      <div className="flex rounded-lg overflow-hidden border border-gray-300">
                        {[
                          { value: 'today', label: '今天' },
                          { value: 'week', label: '近一周' },
                          { value: 'month', label: '近一月' },
                          { value: 'all', label: '全部' }
                        ].map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setDateFilter(opt.value as typeof dateFilter)}
                            className={`px-3 py-1 text-sm ${dateFilter === opt.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center space-x-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideTransferred}
                        onChange={(e) => setHideTransferred(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-gray-600">隐藏已全部转移</span>
                    </label>
                  </div>
                  
                  {/* 操作栏 */}
                  <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={handleSelectAll}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        {selectedOrderIds.size === filteredInboundOrders.length && filteredInboundOrders.length > 0 ? '取消全选' : '全选'}
                      </button>
                      <span className="text-sm text-gray-500">
                        已选 <span className="font-semibold text-blue-600">{selectedOrderIds.size}</span> 个入库单，
                        共 <span className="font-semibold">{recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.item_count, 0)}</span> 件商品，
                        <span className="font-semibold text-orange-600">{recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.total_weight, 0).toFixed(2)}</span> 克
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleLoadSelectedOrders}
                        disabled={selectedOrderIds.size === 0 || batchLoading}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                      >
                        加载并编辑
                      </button>
                      <button
                        onClick={() => openConfirmModal('quick')}
                        disabled={selectedOrderIds.size === 0 || batchLoading}
                        className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 flex items-center space-x-1"
                      >
                        <Send className="w-4 h-4" />
                        <span>{batchLoading ? '转移中...' : '一键全量转移'}</span>
                      </button>
                    </div>
                  </div>
                  
                  {/* 入库单列表 */}
                  <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                    {filteredInboundOrders.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        没有符合条件的入库单
                      </div>
                    ) : filteredInboundOrders.map((order) => {
                      // 获取商品名称预览（最多显示3个）
                      const productNames = order.details.slice(0, 3).map(d => d.product_name);
                      const hasMore = order.details.length > 3;
                      
                      // 获取唯一的成色和工艺标签
                      const tags = new Set<string>();
                      order.details.forEach(d => {
                        if (d.fineness) tags.add(d.fineness);
                        if (d.craft) tags.add(d.craft);
                      });
                      const tagList = Array.from(tags).slice(0, 4);
                      
                      const isSelected = selectedOrderIds.has(order.id);
                      
                      return (
                        <div 
                          key={order.id}
                          className={`px-6 py-4 hover:bg-blue-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center space-x-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleOrderSelection(order.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-5 h-5 text-blue-600 rounded"
                              />
                              <div 
                                className="flex items-center space-x-3 flex-1"
                                onClick={() => handleSearchByOrderNo(order.order_no)}
                              >
                                <div className="p-2 bg-orange-100 rounded-lg">
                                  <FileText className="w-4 h-4 text-orange-600" />
                                </div>
                                <div>
                                  <div className="font-mono text-sm font-medium">{order.order_no}</div>
                                  <div className="text-xs text-gray-500">
                                    {order.create_time ? new Date(order.create_time).toLocaleDateString('zh-CN', {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    }) : ''}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium text-gray-900">{order.item_count} 个商品</div>
                              <div className="text-xs text-orange-600 font-semibold">{order.total_weight} 克</div>
                              {order.transferred_weight > 0 && (
                                <div className={`text-xs mt-1 ${order.transferred_weight >= order.total_weight ? 'text-green-600' : 'text-blue-600'}`}>
                                  {order.transferred_weight >= order.total_weight ? '✓ 已全部转移' : `已转移 ${order.transferred_weight.toFixed(2)}克`}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="ml-8">
                            {/* 供应商信息 */}
                            {order.suppliers && order.suppliers.length > 0 && (
                              <div className="mb-2 text-sm">
                                <span className="text-gray-500">供应商：</span>
                                <span className="text-blue-600 font-medium">{order.suppliers.join('、')}</span>
                              </div>
                            )}
                            
                            {/* 商品预览 */}
                            {productNames.length > 0 && (
                              <div className="mb-2 text-sm text-gray-600">
                                <span className="text-gray-500">商品：</span>
                                {productNames.join('、')}{hasMore ? '...' : ''}
                              </div>
                            )}
                            
                            {/* 成色/工艺标签 */}
                            {tagList.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {tagList.map((tag, idx) => (
                                  <span 
                                    key={idx} 
                                    className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 商品列表 */}
              {batchItems.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <h4 className="font-medium">商品列表（共 {batchItems.length} 个）</h4>
                    <div className="flex items-center space-x-4">
                      <label className="flex items-center space-x-2 text-sm">
                        <input
                          type="checkbox"
                          checked={batchItems.every(item => item.selected)}
                          onChange={(e) => {
                            setBatchItems(batchItems.map(item => ({ ...item, selected: e.target.checked })));
                          }}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span>全选</span>
                      </label>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                    {batchItems.map((item, index) => (
                      <div key={item.id} className={`px-6 py-4 flex items-center space-x-4 ${item.selected ? 'bg-blue-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => {
                            const newItems = [...batchItems];
                            newItems[index].selected = e.target.checked;
                            setBatchItems(newItems);
                          }}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{item.product_name}</span>
                            <span className="text-gray-500">（入库重量：{item.weight}克）</span>
                          </div>
                          {item.order_no && (
                            <div className="text-xs text-gray-400 mt-1">
                              来源：{item.order_no}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-500">转移重量：</span>
                          <input
                            type="number"
                            step="0.01"
                            value={item.transfer_weight}
                            onChange={(e) => {
                              const newItems = [...batchItems];
                              newItems[index].transfer_weight = parseFloat(e.target.value) || 0;
                              setBatchItems(newItems);
                            }}
                            className="w-24 px-3 py-1 border border-gray-300 rounded text-right"
                          />
                          <span className="text-sm text-gray-500">克</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      已选择 {batchItems.filter(i => i.selected).length} 个商品，
                      总重量 {batchItems.filter(i => i.selected).reduce((sum, i) => sum + i.transfer_weight, 0).toFixed(2)} 克
                    </div>
                    <button
                      onClick={handleBatchTransfer}
                      disabled={batchLoading || batchItems.filter(i => i.selected).length === 0}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400"
                    >
                      {batchLoading ? '转移中...' : '确认批量转移'}
                    </button>
                  </div>
                </div>
              )}

              {/* 空状态 */}
              {batchItems.length === 0 && !batchLoading && (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>输入入库单号并点击查询，即可批量转移商品</p>
                </div>
              )}
            </div>
          )}

          {/* 待接收 */}
          {activeTab === 'receive' && (
            <div>
              {transfersLoading ? (
                <div className="text-center py-12 text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  加载中...
                </div>
              ) : transfersError ? (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
                  <p className="text-red-500 mb-4">{transfersError}</p>
                  <button
                    onClick={loadTransfers}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    点击重试
                  </button>
                </div>
              ) : pendingTransferOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无待接收的货品</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 新版转移单（多商品） */}
                  {pendingTransferOrders.map(order => (
                    <div key={order.id} className="border border-yellow-200 bg-yellow-50 rounded-lg overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="font-mono text-sm text-gray-500">{order.transfer_no}</span>
                              <StatusBadge status={order.status} />
                              <span className="text-sm bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                {order.items.length} 个商品
                              </span>
                            </div>
                            <div className="flex items-center text-gray-600 mb-2">
                              <MapPin className="w-4 h-4 mr-1" />
                              <span>{order.from_location_name}</span>
                              <ArrowRight className="w-4 h-4 mx-2" />
                              <span className="font-semibold">{order.to_location_name}</span>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <span>总重量: <strong className="text-gray-900">{order.total_weight?.toFixed(2) || 0}g</strong></span>
                              <span>发起人: {order.created_by}</span>
                              <span>时间: {new Date(order.created_at).toLocaleString('zh-CN')}</span>
                            </div>
                            {order.remark && (
                              <p className="mt-2 text-sm text-gray-600">备注: {order.remark}</p>
                            )}
                          </div>
                          <div className="flex space-x-2 ml-4">
                            <button
                              onClick={() => openReceiveOrderModal(order)}
                              className="flex items-center space-x-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                            >
                              <Check className="w-4 h-4" />
                              <span>确认接收</span>
                            </button>
                            <button
                              onClick={() => handleRejectTransferOrder(order)}
                              className="flex items-center space-x-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                            >
                              <X className="w-4 h-4" />
                              <span>拒收</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      {/* 商品明细 */}
                      <div className="border-t border-yellow-200 bg-white/50">
                        <table className="w-full text-sm">
                          <thead className="bg-yellow-100/50">
                            <tr>
                              <th className="px-4 py-2 text-left text-gray-600">商品名称</th>
                              <th className="px-4 py-2 text-right text-gray-600">预期重量</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-yellow-100">
                            {order.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-2">{item.product_name}</td>
                                <td className="px-4 py-2 text-right font-medium">{item.weight}g</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  
                </div>
              )}
            </div>
          )}

          {/* 待确认（商品专员审批） */}
          {activeTab === 'confirm' && (
            <div>
              {transfersLoading ? (
                <div className="text-center py-12 text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  加载中...
                </div>
              ) : transfersError ? (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
                  <p className="text-red-500 mb-4">{transfersError}</p>
                  <button
                    onClick={loadTransfers}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    点击重试
                  </button>
                </div>
              ) : pendingConfirmTransferOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Check className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无待确认的转移单</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center text-orange-700">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      <span className="font-medium">以下转移单的实际接收重量与预期不符，请审核后确认或拒绝</span>
                    </div>
                  </div>
                  
                  {/* 新版转移单（多商品） */}
                  {pendingConfirmTransferOrders.map(order => (
                    <div key={order.id} className="border border-orange-200 bg-orange-50 rounded-lg overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="font-mono text-sm text-gray-500">{order.transfer_no}</span>
                              <StatusBadge status={order.status} />
                              <span className="text-sm bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                {order.items.length} 个商品
                              </span>
                            </div>
                            <div className="flex items-center text-gray-600 mb-2">
                              <MapPin className="w-4 h-4 mr-1" />
                              <span>{order.from_location_name}</span>
                              <ArrowRight className="w-4 h-4 mx-2" />
                              <span className="font-semibold">{order.to_location_name}</span>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-500 mt-3">
                              <span>接收人: {order.received_by}</span>
                              <span>接收时间: {order.received_at ? new Date(order.received_at).toLocaleString('zh-CN') : '-'}</span>
                            </div>
                          </div>
                          <div className="flex flex-col space-y-2 ml-4">
                            {userRole === 'product' ? (
                              editOrderId === order.id ? (
                                <>
                                  <button
                                    onClick={() => handleSaveConfirmOrder(order)}
                                    className="flex items-center justify-center space-x-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                  >
                                    <Check className="w-4 h-4" />
                                    <span>保存</span>
                                  </button>
                                  <button
                                    onClick={cancelEditConfirmOrder}
                                    className="flex items-center justify-center space-x-1 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                    <span>取消</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => startEditConfirmOrder(order)}
                                  className="flex items-center justify-center space-x-1 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                >
                                  <FileText className="w-4 h-4" />
                                  <span>编辑</span>
                                </button>
                              )
                            ) : (
                              <>
                                <button
                                  onClick={() => handleConfirmTransferOrder(order)}
                                  className="flex items-center justify-center space-x-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                                >
                                  <Check className="w-4 h-4" />
                                  <span>同意</span>
                                </button>
                                <button
                                  onClick={() => handleRejectConfirmTransferOrder(order)}
                                  className="flex items-center justify-center space-x-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                  <span>拒绝</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* 商品明细及重量差异 */}
                      <div className="border-t border-orange-200 bg-white/50">
                        <table className="w-full text-sm">
                          <thead className="bg-orange-100/50">
                            <tr>
                              <th className="px-4 py-2 text-left text-gray-600">商品名称</th>
                              <th className="px-4 py-2 text-right text-gray-600">预期重量</th>
                              <th className="px-4 py-2 text-right text-gray-600">实际重量</th>
                              <th className="px-4 py-2 text-right text-gray-600">差异</th>
                              <th className="px-4 py-2 text-left text-gray-600">原因</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-orange-100">
                            {order.items.map(item => {
                              const editForm = editItemForms[item.id] || { actual_weight: String(item.actual_weight ?? ''), diff_reason: item.diff_reason || '' };
                              const editing = editOrderId === order.id;
                              const actualWeightValue = editing ? editForm.actual_weight : String(item.actual_weight ?? '');
                              const actualWeightNum = parseFloat(actualWeightValue || '0');
                              const diff = (editing ? actualWeightNum : (item.actual_weight || 0)) - item.weight;
                              const hasDiff = Math.abs(diff) >= 0.01;
                              return (
                                <tr key={item.id} className={hasDiff ? 'bg-orange-50' : ''}>
                                  <td className="px-4 py-2">{item.product_name}</td>
                                  <td className="px-4 py-2 text-right">{item.weight}g</td>
                                  <td className="px-4 py-2 text-right">
                                    {editing ? (
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={editForm.actual_weight}
                                        onChange={(e) => setEditItemForms(prev => ({
                                          ...prev,
                                          [item.id]: { ...editForm, actual_weight: e.target.value }
                                        }))}
                                        className={`w-24 px-2 py-1 border rounded text-right ${
                                          Number.isNaN(actualWeightNum) || actualWeightNum <= 0
                                            ? 'border-red-400'
                                            : 'border-gray-200'
                                        }`}
                                      />
                                    ) : (
                                      <span className="font-medium text-blue-600">{item.actual_weight ?? '-'}g</span>
                                    )}
                                  </td>
                                  <td className={`px-4 py-2 text-right font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : ''}`}>
                                    {hasDiff ? `${diff > 0 ? '+' : ''}${diff.toFixed(2)}g` : '-'}
                                  </td>
                                  <td className="px-4 py-2 text-gray-600">
                                    {editing ? (
                                      <input
                                        type="text"
                                        value={editForm.diff_reason}
                                        onChange={(e) => setEditItemForms(prev => ({
                                          ...prev,
                                          [item.id]: { ...editForm, diff_reason: e.target.value }
                                        }))}
                                        className={`w-full px-2 py-1 border rounded ${
                                          hasDiff && !editForm.diff_reason?.trim()
                                            ? 'border-red-400'
                                            : 'border-gray-200'
                                        }`}
                                        placeholder={hasDiff ? '差异原因（必填）' : '可选'}
                                      />
                                    ) : (
                                      item.diff_reason || '-'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  
                </div>
              )}
            </div>
          )}
        </div>

        {/* 接收确认弹窗（多商品） */}
        {receivingOrder && (() => {
          // 计算是否有任何商品存在差异
          const hasAnyDiff = receivingOrder.items.some(item => {
            const form = receiveItemForms[item.id];
            const actualWeight = parseFloat(form?.actual_weight || '0');
            return Math.abs(actualWeight - item.weight) >= 0.01;
          });
          
          // 检查所有有差异的商品是否都填写了原因
          const allDiffReasonsProvided = receivingOrder.items.every(item => {
            const form = receiveItemForms[item.id];
            const actualWeight = parseFloat(form?.actual_weight || '0');
            const hasDiff = Math.abs(actualWeight - item.weight) >= 0.01;
            return !hasDiff || (form?.diff_reason?.trim() || '');
          });
          
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">确认接收货品</h3>
                
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <p className="text-sm text-gray-600 mb-1">转移单号: {receivingOrder.transfer_no}</p>
                  <p className="text-sm text-gray-600">
                    {receivingOrder.from_location_name} → {receivingOrder.to_location_name}
                  </p>
                  <p className="font-semibold mt-1">{receivingOrder.items.length} 个商品，共 {receivingOrder.total_weight?.toFixed(2) || 0}g</p>
                </div>

                {/* 商品明细列表 */}
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {receivingOrder.items.map(item => {
                    const form = receiveItemForms[item.id] || { actual_weight: item.weight.toString(), diff_reason: '' };
                    const actualWeight = parseFloat(form.actual_weight) || 0;
                    const hasDiff = Math.abs(actualWeight - item.weight) >= 0.01;
                    const diffValue = actualWeight - item.weight;
                    
                    return (
                      <div key={item.id} className={`border rounded-lg p-4 ${hasDiff ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{item.product_name}</span>
                          <span className="text-sm text-gray-500">预期: {item.weight}g</span>
                        </div>
                        
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <input
                              type="number"
                              step="0.01"
                              value={form.actual_weight}
                              onChange={(e) => setReceiveItemForms({
                                ...receiveItemForms,
                                [item.id]: { ...form, actual_weight: e.target.value }
                              })}
                              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                                hasDiff ? 'border-orange-300 focus:ring-orange-500' : 'border-gray-200 focus:ring-blue-500'
                              }`}
                              placeholder="实际重量 (g)"
                            />
                          </div>
                          {hasDiff && (
                            <span className={`text-sm font-medium ${diffValue > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {diffValue > 0 ? '+' : ''}{diffValue.toFixed(2)}g
                            </span>
                          )}
                        </div>
                        
                        {hasDiff && (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={form.diff_reason}
                              onChange={(e) => setReceiveItemForms({
                                ...receiveItemForms,
                                [item.id]: { ...form, diff_reason: e.target.value }
                              })}
                              className="w-full px-3 py-2 border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                              placeholder="差异原因（必填）"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hasAnyDiff && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-4">
                    <div className="flex items-center text-orange-700">
                      <AlertTriangle className="w-5 h-5 mr-2" />
                      <span className="font-medium">存在重量差异，提交后需商品部确认</span>
                    </div>
                  </div>
                )}

                <div className="flex space-x-3 mt-6">
                  <button
                    onClick={() => {
                      setReceivingOrder(null);
                      setReceiveItemForms({});
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReceiveTransferOrder}
                    disabled={hasAnyDiff && !allDiffReasonsProvided}
                    className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors ${
                      hasAnyDiff 
                        ? 'bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400' 
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {hasAnyDiff ? '提交待商品部确认' : '确认接收'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 转移确认弹窗 */}
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
              <div className="px-6 py-4 bg-gradient-to-r from-green-600 to-green-700 text-white">
                <h3 className="text-lg font-semibold">确认转移</h3>
              </div>
              <div className="p-6">
                <div className="mb-4">
                  <p className="text-gray-700 mb-4">
                    确定要将以下入库单的商品全部转移到{userRole === 'counter' ? '商品部仓库' : '展厅'}吗？
                  </p>
                  
                  <div className="bg-gray-50 rounded-lg p-4 max-h-[300px] overflow-y-auto">
                    <div className="space-y-2">
                      {recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).map(order => (
                        <div key={order.id} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0">
                          <div>
                            <div className="font-mono text-sm">{order.order_no}</div>
                            <div className="text-xs text-gray-500">{order.item_count} 个商品</div>
                          </div>
                          <div className="text-orange-600 font-semibold">{order.total_weight} 克</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">入库单数量：</span>
                      <span className="font-semibold">{selectedOrderIds.size} 个</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">商品总数：</span>
                      <span className="font-semibold">
                        {recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.item_count, 0)} 件
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">总重量：</span>
                      <span className="font-semibold text-orange-600">
                        {recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.total_weight, 0).toFixed(2)} 克
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmTransfer}
                    disabled={batchLoading}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 flex items-center justify-center space-x-2"
                  >
                    {batchLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>转移中...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>确认转移</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WarehousePage;



