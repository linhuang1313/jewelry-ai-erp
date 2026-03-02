import React, { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  Package, MapPin, ArrowRight, ArrowLeft, Check, X, Clock, RefreshCw,
  Plus, Send, Inbox, AlertTriangle, ChevronDown, Search, Filter, FileText,
  AlertCircle, Printer, Tag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { printJewelryLabel, printJewelryLabels } from '../utils/lodopPrint';

import { fetchWithCacheJson } from '../utils/fetchCache';

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
  product_code?: string;
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
  source?: string;
}

// 转移单类型
interface TransferItem {
  id: number;
  product_name: string;
  product_code?: string;
  weight: number;
  actual_weight: number | null;
  weight_diff: number | null;
  diff_reason: string | null;
  barcode?: string;
  labor_cost?: number | null;
  piece_count?: number | null;
  piece_labor_cost?: number | null;
  main_stone_weight?: number | null;
  main_stone_count?: number | null;
  sub_stone_weight?: number | null;
  sub_stone_count?: number | null;
  main_stone_mark?: string | null;
  sub_stone_mark?: string | null;
  pearl_weight?: number | null;
  bearing_weight?: number | null;
  sale_labor_cost?: number | null;
  sale_piece_labor_cost?: number | null;
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
    className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${active
      ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
      : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
      }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${active ? 'bg-white/20' : 'bg-red-500 text-white'
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
  const [activeTab, setActiveTab] = useState<'inventory' | 'transfer' | 'batch' | 'receive' | 'confirm' | 'confirmed' | 'received'>('inventory');
  const hasAutoSwitched = useRef(false);  // 跟踪是否已自动切换标签页
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);

  // 转移单状态（支持多商品）
  const [transferOrders, setTransferOrders] = useState<TransferOrder[]>([]);
  const [pendingTransferOrders, setPendingTransferOrders] = useState<TransferOrder[]>([]);
  const [pendingConfirmTransferOrders, setPendingConfirmTransferOrders] = useState<TransferOrder[]>([]);
  const [confirmedTransferOrders, setConfirmedTransferOrders] = useState<TransferOrder[]>([]);  // 已确认的转移单（商品专员）
  const [receivedTransferOrders, setReceivedTransferOrders] = useState<TransferOrder[]>([]);  // 已接收的转移单（柜台）
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
  // 按商品名称缓存的入库明细
  const [productDetailsCache, setProductDetailsCache] = useState<Map<string, BarcodeInventoryItem[]>>(new Map());
  const [productDetailLoading, setProductDetailLoading] = useState<string | null>(null);

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

  // 转移商品搜索状态
  const [transferSearchKeyword, setTransferSearchKeyword] = useState('');
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const transferDropdownRef = useRef<HTMLDivElement>(null);

  // 接收表单状态
  // receivingOrder 和 receiveItemForms 已移除（简化接收流程，不再需要填写实际重量的模态框）

  // 待确认编辑模式
  const [editOrderId, setEditOrderId] = useState<number | null>(null);
  const [editItemForms, setEditItemForms] = useState<Record<number, { actual_weight: string; diff_reason: string }>>({});

  // 批量转移相关状态
  const [batchOrderNo, setBatchOrderNo] = useState('');
  const [batchItems, setBatchItems] = useState<Array<{
    id: number;
    product_name: string;
    product_code?: string;
    weight: number;
    transfer_weight: number;
    selected: boolean;
    order_no: string;
    barcode?: string;
    labor_cost?: number;
    piece_count?: number;
    piece_labor_cost?: number;
    main_stone_weight?: number;
    main_stone_count?: number;
    sub_stone_weight?: number;
    sub_stone_count?: number;
    main_stone_mark?: string;
    sub_stone_mark?: string;
    pearl_weight?: number;
    bearing_weight?: number;
    sale_labor_cost?: number;
    sale_piece_labor_cost?: number;
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
      product_code?: string;
      weight: number;
      fineness?: string;
      craft?: string;
      barcode?: string;
      labor_cost?: number;
      piece_count?: number;
      piece_labor_cost?: number;
      main_stone_weight?: number;
      main_stone_count?: number;
      sub_stone_weight?: number;
      sub_stone_count?: number;
      main_stone_mark?: string;
      sub_stone_mark?: string;
      pearl_weight?: number;
      bearing_weight?: number;
      sale_labor_cost?: number;
      sale_piece_labor_cost?: number;
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

  // 点击外部关闭转移商品搜索下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (transferDropdownRef.current && !transferDropdownRef.current.contains(e.target as Node)) {
        setShowTransferDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadLocations = async () => {
    setLocationsLoading(true);
    setLocationsError(null);
    try {
      const processData = (data: any) => {
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
      };

      const data = await fetchWithCacheJson(API_ENDPOINTS.LOCATIONS, {}, (cachedData) => {
        processData(cachedData);
        setLocationsLoading(false);
      });
      processData(data);
    } catch (error: any) {
      setLocationsError(error.message || '加载仓库位置失败，请重试');
    } finally {
      setLocationsLoading(false);
    }
  };

  const loadInventorySummary = async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const data = await fetchWithCacheJson(API_ENDPOINTS.INVENTORY_SUMMARY, {}, (cachedData) => {
        setInventorySummary(cachedData);
        setInventoryLoading(false);
      });
      setInventorySummary(data);
    } catch (error: any) {
      setInventoryError(error.message || '加载库存数据失败，请重试');
    } finally {
      setInventoryLoading(false);
      setLoading(false);
    }
  };

  // 切换商品展开状态（按需加载该商品的入库明细）
  const toggleProductExpand = async (productName: string) => {
    const newSet = new Set(expandedProducts);
    if (newSet.has(productName)) {
      newSet.delete(productName);
      setExpandedProducts(newSet);
    } else {
      newSet.add(productName);
      setExpandedProducts(newSet);
      if (!productDetailsCache.has(productName)) {
        setProductDetailLoading(productName);
        try {
          const url = `${API_ENDPOINTS.API_BASE_URL}/api/inventory/by-product-name?product_name=${encodeURIComponent(productName)}&limit=500`;
          const response = await fetch(url);
          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              setProductDetailsCache(prev => new Map(prev).set(productName, result.data || []));
            }
          }
        } catch (error) {
          // silently fail, UI will show "暂无条码明细数据"
        } finally {
          setProductDetailLoading(null);
        }
      }
    }
  };

  // 获取某个商品名称下的所有条码明细（优先从按需缓存中取）
  const getProductBarcodes = (productName: string) => {
    if (productDetailsCache.has(productName)) {
      return productDetailsCache.get(productName) || [];
    }
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
    } finally {
      setBarcodeLoading(false);
    }
  };

  const loadTransfers = async () => {
    setTransfersLoading(true);
    setTransfersError(null);
    try {
      const processData = (data: any) => {
        setTransferOrders(data);

        // 根据角色过滤待接收的转移单（柜台看到的"待接收"）
        // 只显示 pending_confirm 且尚未被接收过的单据（received_at 为空）
        const myResponsibleLocation = ROLE_LOCATION_MAP[userRole];
        if (myResponsibleLocation) {
          setPendingTransferOrders(
            data.filter((t: TransferOrder) =>
              t.status === 'pending_confirm' && t.to_location_name === myResponsibleLocation && !t.received_at
            )
          );
        } else {
          setPendingTransferOrders(data.filter((t: TransferOrder) => t.status === 'pending_confirm' && !t.received_at));
        }

        // 待确认转移单（商品专员和管理员）- 包含 pending_confirm 和 rejected 状态
        if (userRole === 'product' || userRole === 'manager') {
          setPendingConfirmTransferOrders(
            data.filter((t: TransferOrder) => t.status === 'pending_confirm' || t.status === 'rejected')
          );
          // 已确认的转移单（状态为 received）
          setConfirmedTransferOrders(
            data.filter((t: TransferOrder) => t.status === 'received')
          );
        } else {
          setPendingConfirmTransferOrders([]);
          setConfirmedTransferOrders([]);
        }

        // 已接收的转移单（柜台和管理员）
        if (userRole === 'counter' || userRole === 'manager') {
          // 柜台只看目标是展厅的已接收单
          const myLoc = userRole === 'counter' ? '展厅' : null;
          if (myLoc) {
            setReceivedTransferOrders(
              data.filter((t: TransferOrder) =>
                t.status === 'received' && t.to_location_name === myLoc
              )
            );
          } else {
            setReceivedTransferOrders(
              data.filter((t: TransferOrder) => t.status === 'received')
            );
          }
        } else {
          setReceivedTransferOrders([]);
        }
      };

      const data = await fetchWithCacheJson(API_ENDPOINTS.TRANSFER_ORDERS, {}, (cachedData) => {
        processData(cachedData);
        setTransfersLoading(false);
      });
      processData(data);
    } catch (error: any) {
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
      const processData = (data: any) => {
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
              product_code: d.product_code,
              weight: d.weight,
              fineness: d.fineness,
              craft: d.craft
            }))
          })));
        } else {
          setInboundError('加载入库单数据失败');
        }
      };

      const data = await fetchWithCacheJson(`${API_ENDPOINTS.API_BASE_URL}/api/inbound-orders?limit=30`, {}, (cachedData) => {
        processData(cachedData);
        setInboundLoading(false);
      });
      processData(data);
    } catch (error: any) {
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
          product_code: d.product_code,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no,
          barcode: d.barcode,
          labor_cost: d.labor_cost,
          piece_count: d.piece_count,
          piece_labor_cost: d.piece_labor_cost,
          main_stone_weight: d.main_stone_weight,
          main_stone_count: d.main_stone_count,
          sub_stone_weight: d.sub_stone_weight,
          sub_stone_count: d.sub_stone_count,
          main_stone_mark: d.main_stone_mark,
          sub_stone_mark: d.sub_stone_mark,
          pearl_weight: d.pearl_weight,
          bearing_weight: d.bearing_weight,
          sale_labor_cost: d.sale_labor_cost,
          sale_piece_labor_cost: d.sale_piece_labor_cost,
        }));
        setBatchItems(items);
        setSelectedOrderIds(new Set());
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
    // 过滤掉已全部转移的入库单
    const transferableOrders = selectedOrders.filter(o => o.transferred_weight < o.total_weight);
    if (transferableOrders.length === 0) {
      toast.error('选中的入库单已全部转移，无需再次转移');
      return;
    }
    if (transferableOrders.length < selectedOrders.length) {
      const skipped = selectedOrders.length - transferableOrders.length;
      toast(`已自动跳过 ${skipped} 个已全部转移的入库单`, { icon: 'ℹ️' });
    }

    let itemId = 0;
    const allItems: typeof batchItems = [];

    transferableOrders.forEach(order => {
      order.details.forEach(d => {
        allItems.push({
          id: itemId++,
          product_name: d.product_name,
          product_code: d.product_code,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no,
          barcode: d.barcode,
          labor_cost: d.labor_cost,
          piece_count: d.piece_count,
          piece_labor_cost: d.piece_labor_cost,
          main_stone_weight: d.main_stone_weight,
          main_stone_count: d.main_stone_count,
          sub_stone_weight: d.sub_stone_weight,
          sub_stone_count: d.sub_stone_count,
          main_stone_mark: d.main_stone_mark,
          sub_stone_mark: d.sub_stone_mark,
          pearl_weight: d.pearl_weight,
          bearing_weight: d.bearing_weight,
          sale_labor_cost: d.sale_labor_cost,
          sale_piece_labor_cost: d.sale_piece_labor_cost,
        });
      });
    });

    setBatchItems(allItems);
    toast.success(`已加载 ${transferableOrders.length} 个入库单，共 ${allItems.length} 个商品`);
  };

  // 一键全量转移
  const handleQuickTransferAll = async () => {
    if (selectedOrderIds.size === 0) {
      toast.error('请先选择入库单');
      return;
    }

    const selectedOrders = recentInboundOrders.filter(o => selectedOrderIds.has(o.id));
    // 过滤掉已全部转移的入库单
    const transferableOrders = selectedOrders.filter(o => o.transferred_weight < o.total_weight);
    if (transferableOrders.length === 0) {
      toast.error('选中的入库单已全部转移，无需再次转移');
      return;
    }
    if (transferableOrders.length < selectedOrders.length) {
      const skipped = selectedOrders.length - transferableOrders.length;
      toast(`已自动跳过 ${skipped} 个已全部转移的入库单`, { icon: 'ℹ️' });
    }

    let itemId = 0;
    const allItems: typeof batchItems = [];

    transferableOrders.forEach(order => {
      order.details.forEach(d => {
        allItems.push({
          id: itemId++,
          product_name: d.product_name,
          product_code: d.product_code,
          weight: d.weight,
          transfer_weight: d.weight,
          selected: true,
          order_no: order.order_no,
          barcode: d.barcode,
          labor_cost: d.labor_cost,
          piece_count: d.piece_count,
          piece_labor_cost: d.piece_labor_cost,
          main_stone_weight: d.main_stone_weight,
          main_stone_count: d.main_stone_count,
          sub_stone_weight: d.sub_stone_weight,
          sub_stone_count: d.sub_stone_count,
          main_stone_mark: d.main_stone_mark,
          sub_stone_mark: d.sub_stone_mark,
          pearl_weight: d.pearl_weight,
          bearing_weight: d.bearing_weight,
          sale_labor_cost: d.sale_labor_cost,
          sale_piece_labor_cost: d.sale_piece_labor_cost,
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

    // 构建备注（包含实际参与转移的入库单号）
    const orderNos = transferableOrders.map(o => o.order_no).join('、');

    setBatchLoading(true);
    try {
      // 使用 /transfer-orders 端点，initial_status=pending_confirm 使转移单直接进入"待确认"状态
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDERS}?user_role=${userRole}&created_by=${userRole}&initial_status=pending_confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: allItems.map(item => ({
            product_name: item.product_name,
            product_code: item.product_code || undefined,
            weight: item.transfer_weight,
            barcode: item.barcode || undefined,
            labor_cost: item.labor_cost ?? undefined,
            piece_count: item.piece_count ?? undefined,
            piece_labor_cost: item.piece_labor_cost ?? undefined,
            main_stone_weight: item.main_stone_weight ?? undefined,
            main_stone_count: item.main_stone_count ?? undefined,
            sub_stone_weight: item.sub_stone_weight ?? undefined,
            sub_stone_count: item.sub_stone_count ?? undefined,
            main_stone_mark: item.main_stone_mark || undefined,
            sub_stone_mark: item.sub_stone_mark || undefined,
            pearl_weight: item.pearl_weight ?? undefined,
            bearing_weight: item.bearing_weight ?? undefined,
            sale_labor_cost: item.sale_labor_cost ?? undefined,
            sale_piece_labor_cost: item.sale_piece_labor_cost ?? undefined,
          })),
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          remark: `来自入库单 ${orderNos}`
        })
      });

      const result = await response.json();

      // 检查成功响应 - 支持多种返回格式
      const isSuccess = response.ok && (result.id || result.data?.id || result.success);
      const transferNo = result.transfer_no || result.data?.transfer_no;

      if (isSuccess && (result.id || result.data?.id)) {
        // 成功创建转移单
        toast.success(`批量转移成功，已创建转移单 ${transferNo}，请在"待确认"中查看`);
        setSelectedOrderIds(new Set());
        setBatchItems([]);
        loadTransfers();
        loadInventorySummary();
        loadRecentInboundOrders();
      } else {
        // 显示后端返回的具体错误信息 - 支持多种错误格式
        const errorMsg = result.message || result.detail || result.error || '批量转移失败';
        toast.error(errorMsg, { duration: 6000 });
        console.error('转移失败:', response.status, result);
      }
    } catch (error: any) {
      toast.error(`批量转移失败: ${error.message || '网络错误'}`);
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

  // 全选/取消全选（排除已全部转移的入库单）
  const handleSelectAll = () => {
    const selectableOrders = filteredInboundOrders.filter(o => o.transferred_weight < o.total_weight);
    if (selectedOrderIds.size === selectableOrders.length && selectableOrders.every(o => selectedOrderIds.has(o.id))) {
      // 已全选，取消全选
      setSelectedOrderIds(new Set());
    } else {
      // 全选（仅可转移的入库单）
      setSelectedOrderIds(new Set(selectableOrders.map(o => o.id)));
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
      // 使用 /transfer-orders 端点，initial_status=pending_confirm 使转移单直接进入"待确认"状态
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDERS}?user_role=${userRole}&created_by=${userRole}&initial_status=pending_confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItems.map(item => ({
            product_name: item.product_name,
            product_code: item.product_code || undefined,
            weight: item.transfer_weight,
            barcode: item.barcode || undefined,
            labor_cost: item.labor_cost ?? undefined,
            piece_count: item.piece_count ?? undefined,
            piece_labor_cost: item.piece_labor_cost ?? undefined,
            main_stone_weight: item.main_stone_weight ?? undefined,
            main_stone_count: item.main_stone_count ?? undefined,
            sub_stone_weight: item.sub_stone_weight ?? undefined,
            sub_stone_count: item.sub_stone_count ?? undefined,
            main_stone_mark: item.main_stone_mark || undefined,
            sub_stone_mark: item.sub_stone_mark || undefined,
            pearl_weight: item.pearl_weight ?? undefined,
            bearing_weight: item.bearing_weight ?? undefined,
            sale_labor_cost: item.sale_labor_cost ?? undefined,
            sale_piece_labor_cost: item.sale_piece_labor_cost ?? undefined,
          })),
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          remark: remarkText
        })
      });

      const result = await response.json();

      // 检查成功响应 - 支持多种返回格式
      const isSuccess = response.ok && (result.id || result.data?.id || result.success);
      const transferNo = result.transfer_no || result.data?.transfer_no;

      if (isSuccess && (result.id || result.data?.id)) {
        // 成功创建转移单
        toast.success(`批量转移成功，已创建转移单 ${transferNo}，请在"待确认"中查看`);
        setBatchOrderNo('');
        setBatchItems([]);
        setSelectedOrderIds(new Set());
        loadTransfers();
        loadInventorySummary();
        loadRecentInboundOrders();
      } else {
        // 显示后端返回的具体错误信息 - 支持多种错误格式
        const errorMsg = result.message || result.detail || result.error || '批量转移失败';
        toast.error(errorMsg, { duration: 6000 });
        console.error('转移失败:', response.status, result);
      }
    } catch (error: any) {
      toast.error(`批量转移失败: ${error.message || '网络错误'}`);
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
      toast.error(`超出可转移重量！${fromLocationName}仅有 ${availableWeight.toFixed(3)}g，已添加 ${alreadyAdded.toFixed(3)}g`);
      return;
    }

    // 添加到列表
    setTransferItems([...transferItems, { product_name: transferForm.product_name, weight }]);

    // 清空当前选择但保留位置
    setTransferForm({ ...transferForm, product_name: '', weight: '' });
    setTransferSearchKeyword('');
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
      // 使用新版转移单 API（支持多商品），商品专员创建的转移单进入"待确认"状态
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDERS}?user_role=${userRole}&created_by=${userRole}&initial_status=pending_confirm`, {
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
        toast.success(`成功创建转移单 ${result.transfer_no}，共 ${result.items.length} 个商品，${totalWeight.toFixed(3)}g，请在"待确认"中查看`);
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
        setTransferSearchKeyword('');
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
  // 直接确认接收转移单（简化流程：不需要填实际重量）
  const handleReceiveTransferOrder = async (order: TransferOrder) => {
    if (!confirm(`确认接收转移单 ${order.transfer_no}？\n共 ${order.items.length} 个商品，${order.total_weight?.toFixed(3) || 0}g`)) {
      return;
    }

    try {
      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDER_RECEIVE(order.id)}?user_role=${userRole}`, {
        method: 'POST'
      });

      if (response.ok) {
        toast.success('接收成功');
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
    if (reason === null) return; // 用户点了取消
    if (!reason.trim()) {
      toast.error('请填写拒收原因');
      return;
    }

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

  // 删除转移单（商品专员操作）
  const handleDeleteTransferOrder = async (order: TransferOrder) => {
    const reason = prompt(`确定要删除转移单 ${order.transfer_no} 吗？\n请输入删除原因（可选）:`);
    if (reason === null) return; // 用户点了取消

    try {
      const params = new URLSearchParams({ user_role: userRole });
      if (reason.trim()) params.append('reason', reason.trim());

      const response = await fetch(`${API_ENDPOINTS.TRANSFER_ORDER_DELETE(order.id)}?${params}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || '转移单已删除');
        loadTransfers();
        loadInventorySummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '删除失败');
      }
    } catch (error) {
      toast.error('删除失败');
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
        toast.error(`商品 ${item.product_name} 重量必须大于 0`);
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
        toast.success('重量已更新');
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
        toast.success(`已确认，${totalActual.toFixed(3)}g 已入库`);
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
    if (reason === null) return; // 用户点了取消
    if (!reason.trim()) {
      toast.error('请填写拒绝原因');
      return;
    }

    try {
      const response = await fetch(
        `${API_ENDPOINTS.TRANSFER_ORDER_REJECT_CONFIRM(order.id)}?reason=${encodeURIComponent(reason)}&user_role=${userRole}`,
        { method: 'POST' }
      );

      if (response.ok) {
        const totalWeight = order.items.reduce((sum, item) => sum + item.weight, 0);
        toast.success(`已拒绝，${totalWeight.toFixed(3)}g 已退回商品部仓库`);
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
          {/* 已接收 - 仅柜台和管理员可见 */}
          {(userRole === 'counter' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'received'}
              onClick={() => setActiveTab('received')}
              icon={<Check className="w-4 h-4" />}
              label="已接收"
              count={receivedTransferOrders.length}
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
          {/* 已确认标签页 - 仅商品专员和管理员可见 */}
          {(userRole === 'product' || userRole === 'manager') && (
            <TabButton
              active={activeTab === 'confirmed'}
              onClick={() => setActiveTab('confirmed')}
              icon={<FileText className="w-4 h-4" />}
              label="已确认"
              count={confirmedTransferOrders.length}
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
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${inventoryViewMode === 'byName'
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
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${inventoryViewMode === 'byBarcode'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    按条码
                  </button>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-500">
                    {inventoryViewMode === 'byName'
                      ? `${filteredInventory.length} 种商品`
                      : `${barcodeInventory.length} 条记录`
                    }
                  </span>
                  {/* 批量打印标签按钮 - 仅按条码视图可用 */}
                  {inventoryViewMode === 'byBarcode' && barcodeInventory.length > 0 && (
                    <button
                      onClick={async () => {
                        const products = barcodeInventory.map(item => ({
                          barcode: item.product_code || '',
                          productName: item.product_name,
                          goldWeight: item.weight,
                          laborCost: item.labor_cost,
                          pieceLaborCost: item.piece_labor_cost || 0,
                          mainStone: '',
                          sideStone: '',
                        }));
                        const count = await printJewelryLabels(products, { preview: true });
                        if (count) toast.success(`已添加 ${count} 个标签到打印队列`);
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                      title="批量打印所有显示的商品标签"
                    >
                      <Tag className="w-4 h-4" />
                      <span>批量打印标签</span>
                    </button>
                  )}
                </div>
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
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
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
                              className={`p-4 rounded-xl cursor-pointer transition-all hover:shadow-md ${loc.location_type === 'warehouse'
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
                                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedProducts.has(item.product_name) ? 'rotate-180' : ''
                                        }`}
                                    />
                                  </td>
                                  <td className="px-4 py-3 font-medium text-gray-900">{item.product_name}</td>
                                  <td className="px-4 py-3 text-right text-gray-700">{item.quantity || 0}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-blue-600">
                                    {(userRole === 'counter'
                                      ? item.locations.filter(l => l.location_name === '展厅').reduce((s, l) => s + l.weight, 0)
                                      : item.total_weight
                                    ).toFixed(3)}g
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
                                        {productDetailLoading === item.product_name ? (
                                          <div className="text-sm text-gray-400 py-2">加载中...</div>
                                        ) : getProductBarcodes(item.product_name).length === 0 ? (
                                          <div className="text-sm text-gray-400 py-2">暂无条码明细数据</div>
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
                                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">操作</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-gray-100">
                                                {getProductBarcodes(item.product_name).map((barcode, idx) => (
                                                  <tr key={barcode.id || idx} className="bg-white hover:bg-gray-50">
                                                    <td className="px-3 py-2">
                                                      <span className="font-mono text-blue-600">
                                                        {barcode.product_code || '-（无编码）'}
                                                      </span>
                                                      {barcode.source === 'product_codes' && (
                                                        <span className="ml-1 text-xs text-amber-500">（仅编码）</span>
                                                      )}
                                                    </td>
                                                    <td className="px-3 py-2 text-right">{barcode.source === 'product_codes' ? '-' : `${barcode.weight.toFixed(3)}g`}</td>
                                                    <td className="px-3 py-2 text-right">{barcode.source === 'product_codes' ? '-' : `¥${barcode.labor_cost}/g`}</td>
                                                    <td className="px-3 py-2 text-right">{barcode.source === 'product_codes' ? '-' : (barcode.piece_labor_cost ? `¥${barcode.piece_labor_cost}/件` : '-')}</td>
                                                    <td className="px-3 py-2 text-right text-green-600">{barcode.source === 'product_codes' ? '-' : `¥${barcode.total_cost.toFixed(2)}`}</td>
                                                    <td className="px-3 py-2 text-gray-600">{barcode.supplier || '-'}</td>
                                                    <td className="px-3 py-2 text-gray-500 text-xs">{barcode.inbound_time || '-'}</td>
                                                    <td className="px-3 py-2">
                                                      <button
                                                        onClick={() => printJewelryLabel({
                                                          barcode: barcode.product_code || '',
                                                          productName: item.product_name,
                                                          goldWeight: barcode.weight,
                                                          laborCost: barcode.labor_cost,
                                                          pieceLaborCost: barcode.piece_labor_cost || 0,
                                                          mainStone: '',
                                                          sideStone: '',
                                                        })}
                                                        className="flex items-center space-x-1 px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                                                        title="打印标签"
                                                      >
                                                        <Tag className="w-3 h-3" />
                                                        <span>打印</span>
                                                      </button>
                                                    </td>
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
                              ).reduce((sum, item) => sum + item.total_weight, 0).toFixed(3)}g
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
                            <th className="px-3 py-3 text-left font-medium text-gray-600">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {barcodeInventory.map(item => (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-3 py-3">
                                <span className="font-mono text-blue-600">{item.product_code}</span>
                              </td>
                              <td className="px-3 py-3 font-medium text-gray-900">{item.product_name}</td>
                              <td className="px-3 py-3 text-right">{item.weight.toFixed(3)}g</td>
                              <td className="px-3 py-3 text-right">¥{item.labor_cost}/g</td>
                              <td className="px-3 py-3 text-right">{item.piece_labor_cost ? `¥${item.piece_labor_cost}/件` : '-'}</td>
                              <td className="px-3 py-3 text-right text-green-600">¥{item.total_cost.toFixed(2)}</td>
                              <td className="px-3 py-3 text-gray-600">{item.supplier || '-'}</td>
                              <td className="px-3 py-3">
                                <span className="text-xs text-gray-500">{item.order_no}</span>
                              </td>
                              <td className="px-3 py-3 text-gray-500">{item.inbound_time || '-'}</td>
                              <td className="px-3 py-3">
                                <button
                                  onClick={() => printJewelryLabel({
                                    barcode: item.product_code || '',
                                    productName: item.product_name,
                                    goldWeight: item.weight,
                                    laborCost: item.labor_cost,
                                    pieceLaborCost: item.piece_labor_cost || 0,
                                    mainStone: '',
                                    sideStone: '',
                                  })}
                                  className="flex items-center space-x-1 px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                                  title="打印标签"
                                >
                                  <Tag className="w-3 h-3" />
                                  <span>打印标签</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {/* 汇总行 */}
                        <tfoot className="bg-gray-100 font-medium">
                          <tr>
                            <td className="px-3 py-3 text-gray-700">合计</td>
                            <td className="px-3 py-3 text-gray-500">{barcodeInventory.length} 件</td>
                            <td className="px-3 py-3 text-right font-semibold text-blue-600">
                              {barcodeInventory.reduce((sum, item) => sum + item.weight, 0).toFixed(3)}g
                            </td>
                            <td className="px-3 py-3"></td>
                            <td className="px-3 py-3"></td>
                            <td className="px-3 py-3 text-right font-semibold text-green-600">
                              ¥{barcodeInventory.reduce((sum, item) => sum + item.total_cost, 0).toFixed(2)}
                            </td>
                            <td colSpan={4} className="px-3 py-3"></td>
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

                  <div ref={transferDropdownRef} className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">商品名称</label>
                    {transferForm.product_name ? (
                      <div className="flex items-center w-full px-4 py-2 border border-blue-300 bg-blue-50 rounded-lg">
                        <span className="flex-1 text-gray-800">{transferForm.product_name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTransferForm({ ...transferForm, product_name: '' });
                            setTransferSearchKeyword('');
                          }}
                          className="ml-2 text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="text"
                          value={transferSearchKeyword}
                          onChange={(e) => {
                            setTransferSearchKeyword(e.target.value);
                            setShowTransferDropdown(true);
                          }}
                          onFocus={() => setShowTransferDropdown(true)}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="输入条码或商品名称搜索..."
                        />
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      </div>
                    )}
                    {showTransferDropdown && !transferForm.product_name && (() => {
                      const fromLocationName = locations.find(l => l.id.toString() === transferForm.from_location_id)?.name;
                      const keyword = transferSearchKeyword.trim().toLowerCase();
                      const filtered = inventorySummary
                        .filter(item => {
                          if (fromLocationName) {
                            const locInventory = item.locations.find(loc => loc.location_name === fromLocationName);
                            if (!locInventory || locInventory.weight <= 0) return false;
                          }
                          if (!keyword) return true;
                          return item.product_name.toLowerCase().includes(keyword)
                            || (item.product_code && item.product_code.toLowerCase().includes(keyword));
                        })
                        .slice(0, 20);

                      if (filtered.length === 0) return (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm text-gray-400">
                          无匹配商品
                        </div>
                      );

                      return (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {filtered.map(item => {
                            const locInventory = item.locations.find(loc => loc.location_name === fromLocationName);
                            const availableWeight = locInventory?.weight || 0;
                            return (
                              <div
                                key={item.product_name}
                                onClick={() => {
                                  setTransferForm({ ...transferForm, product_name: item.product_name });
                                  setTransferSearchKeyword('');
                                  setShowTransferDropdown(false);
                                }}
                                className="px-4 py-2.5 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-b-0"
                              >
                                <div className="flex items-center space-x-1.5">
                                  <span className="text-gray-800">{item.product_name}</span>
                                  {item.product_code && <span className="text-gray-400 text-xs">({item.product_code})</span>}
                                </div>
                                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                  {fromLocationName || '总库存'}: {availableWeight.toFixed(1)}g
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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
                            超出可转移重量！{fromLocationName}仅有 {availableWeight.toFixed(3)}g
                          </span>
                        ) : (
                          <span>可转移重量：{availableWeight.toFixed(3)}g</span>
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
                          待转移商品 ({transferItems.length} 项，共 {transferItems.reduce((sum, i) => sum + i.weight, 0).toFixed(3)}g)
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
                          onChange={(e) => { setTransferForm({ ...transferForm, from_location_id: e.target.value, product_name: '' }); setTransferSearchKeyword(''); }}
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
                            <span className="font-semibold">{order.total_weight?.toFixed(3) || 0}g</span>
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
                              <div className="flex items-center space-x-2">
                                <span className="text-gray-800">{item.product_name}</span>
                                {item.product_code && <span className="text-gray-400 font-mono text-xs">({item.product_code})</span>}
                              </div>
                              <div className="flex items-center space-x-4">
                                <span className="font-medium">{item.weight}g</span>
                                {item.actual_weight !== null && item.actual_weight !== item.weight && (
                                  <span className={`text-xs ${item.weight_diff && item.weight_diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    实际: {item.actual_weight}g ({item.weight_diff && item.weight_diff > 0 ? '+' : ''}{item.weight_diff?.toFixed(3)}g)
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
                        <span className="font-semibold text-orange-600">{recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.total_weight, 0).toFixed(3)}</span> 克
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
                      {/* 批量打印标签按钮 */}
                      <button
                        onClick={async () => {
                          const selectedOrders = recentInboundOrders.filter(o => selectedOrderIds.has(o.id));
                          const products: Array<{
                            barcode: string;
                            productName: string;
                            goldWeight: number;
                            laborCost: number;
                            pieceLaborCost: number;
                            mainStone: string;
                            sideStone: string;
                          }> = [];
                          selectedOrders.forEach(order => {
                            order.details.forEach(d => {
                              products.push({
                                barcode: '',
                                productName: d.product_name,
                                goldWeight: d.weight,
                                laborCost: 0,
                                pieceLaborCost: 0,
                                mainStone: '',
                                sideStone: '',
                              });
                            });
                          });
                          if (products.length === 0) {
                            toast.error('请先选择入库单');
                            return;
                          }
                          const count = await printJewelryLabels(products, { preview: true });
                          if (count) toast.success(`已添加 ${count} 个标签到打印队列`);
                        }}
                        disabled={selectedOrderIds.size === 0}
                        className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 flex items-center space-x-1"
                      >
                        <Tag className="w-4 h-4" />
                        <span>批量打印标签</span>
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
                      const isFullyTransferred = order.transferred_weight >= order.total_weight;

                      return (
                        <div
                          key={order.id}
                          className={`px-6 py-4 hover:bg-blue-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''} ${isFullyTransferred ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center space-x-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => !isFullyTransferred && toggleOrderSelection(order.id)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={isFullyTransferred}
                                className="w-5 h-5 text-blue-600 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                title={isFullyTransferred ? '该入库单已全部转移' : ''}
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
                                  {order.transferred_weight >= order.total_weight ? '✓ 已全部转移' : `已转移 ${order.transferred_weight.toFixed(3)}克`}
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
                            {item.product_code && <span className="text-blue-500 font-mono text-xs">[{item.product_code}]</span>}
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
                      总重量 {batchItems.filter(i => i.selected).reduce((sum, i) => sum + i.transfer_weight, 0).toFixed(3)} 克
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
                              <span>总重量: <strong className="text-gray-900">{order.total_weight?.toFixed(3) || 0}g</strong></span>
                              <span>发起人: {order.created_by}</span>
                              <span>时间: {new Date(order.created_at).toLocaleString('zh-CN')}</span>
                            </div>
                            {order.remark && (
                              <p className="mt-2 text-sm text-gray-600">备注: {order.remark}</p>
                            )}
                          </div>
                          <div className="flex space-x-2 ml-4">
                            <button
                              onClick={() => handleReceiveTransferOrder(order)}
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
                      <div className="border-t border-yellow-200 bg-white/50 overflow-x-auto">
                        <table className="w-full text-sm min-w-[300px]">
                          <thead className="bg-yellow-100/50">
                            <tr>
                              <th className="px-4 py-2 text-left text-gray-600">商品名称</th>
                              <th className="px-4 py-2 text-left text-gray-600">商品编码</th>
                              <th className="px-4 py-2 text-right text-gray-600">预期重量</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-yellow-100">
                            {order.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-2">{item.product_name}</td>
                                <td className="px-4 py-2 text-gray-500 font-mono text-xs">{item.product_code || '-'}</td>
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

          {/* 已接收（柜台查看已确认接收的进货单） */}
          {activeTab === 'received' && (
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
              ) : receivedTransferOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无已接收的进货单</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center text-green-700">
                      <Check className="w-5 h-5 mr-2" />
                      <span className="font-medium">以下进货单已确认接收</span>
                    </div>
                  </div>

                  {/* 已接收转移单列表 */}
                  {receivedTransferOrders.map(order => (
                    <div key={order.id} className="border border-green-200 bg-green-50 rounded-lg overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="font-mono text-sm text-gray-500">{order.transfer_no}</span>
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">已接收</span>
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
                              <span>发货人: {order.created_by || '-'}</span>
                              <span>创建时间: {order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : '-'}</span>
                              {order.received_by && <span>接收人: {order.received_by}</span>}
                              {order.received_at && <span>接收时间: {new Date(order.received_at).toLocaleString('zh-CN')}</span>}
                            </div>
                            {order.remark && (
                              <div className="text-sm text-gray-500 mt-2">
                                备注: {order.remark}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col space-y-2 ml-4">
                            <button
                              onClick={() => window.open(API_ENDPOINTS.TRANSFER_ORDER_DOWNLOAD(order.id, 'html'), '_blank')}
                              className="flex items-center justify-center space-x-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
                            >
                              <Printer className="w-4 h-4" />
                              <span>打印进货单</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      {/* 商品明细 */}
                      <div className="border-t border-green-200 bg-white/50 overflow-x-auto">
                        <table className="w-full text-sm min-w-[300px]">
                          <thead className="bg-green-100/50">
                            <tr>
                              <th className="px-4 py-2 text-left text-gray-600">商品名称</th>
                              <th className="px-4 py-2 text-left text-gray-600">商品编码</th>
                              <th className="px-4 py-2 text-right text-gray-600">预期重量</th>
                              <th className="px-4 py-2 text-right text-gray-600">实收重量</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-green-100">
                            {order.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-2">{item.product_name}</td>
                                <td className="px-4 py-2 text-gray-500 font-mono text-xs">{item.product_code || '-'}</td>
                                <td className="px-4 py-2 text-right">{item.weight}g</td>
                                <td className="px-4 py-2 text-right font-medium text-green-600">{item.actual_weight || item.weight}g</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-green-100/50">
                            <tr>
                              <td colSpan={2} className="px-4 py-2 text-right font-semibold">合计</td>
                              <td className="px-4 py-2 text-right font-semibold">
                                {order.total_weight || order.items.reduce((sum, item) => sum + item.weight, 0)}g
                              </td>
                              <td className="px-4 py-2 text-right font-semibold text-green-700">
                                {order.total_actual_weight || order.items.reduce((sum, item) => sum + (item.actual_weight || item.weight), 0)}g
                              </td>
                            </tr>
                          </tfoot>
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
                  {/* 待确认的转移单（pending_confirm） */}
                  {pendingConfirmTransferOrders.filter(o => o.status === 'pending_confirm').length > 0 && (
                    <>
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-2">
                        <div className="flex items-center text-orange-700">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          <span className="font-medium">以下转移单等待柜台接收，您可以编辑重量或删除</span>
                        </div>
                      </div>

                      {pendingConfirmTransferOrders.filter(o => o.status === 'pending_confirm').map(order => (
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
                                  <span>发起人: {order.created_by}</span>
                                  <span>时间: {new Date(order.created_at).toLocaleString('zh-CN')}</span>
                                </div>
                                {order.remark && (
                                  <p className="mt-2 text-sm text-gray-600">备注: {order.remark}</p>
                                )}
                              </div>
                              <div className="flex flex-col space-y-2 ml-4">
                                <button
                                  onClick={() => window.open(API_ENDPOINTS.TRANSFER_ORDER_DOWNLOAD(order.id, 'html'), '_blank')}
                                  className="flex items-center justify-center space-x-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
                                >
                                  <Printer className="w-4 h-4" />
                                  <span>打印进货单</span>
                                </button>
                                {editOrderId === order.id ? (
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
                                  <>
                                    <button
                                      onClick={() => startEditConfirmOrder(order)}
                                      className="flex items-center justify-center space-x-1 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                    >
                                      <FileText className="w-4 h-4" />
                                      <span>编辑</span>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransferOrder(order)}
                                      className="flex items-center justify-center space-x-1 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                                    >
                                      <X className="w-4 h-4" />
                                      <span>删除</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* 商品明细 */}
                          {(() => {
                            const items = order.items;
                            const hasBarcode = items.some((i: any) => i.barcode);
                            const hasLaborCost = items.some((i: any) => i.labor_cost != null);
                            const hasPieceCount = items.some((i: any) => i.piece_count != null);
                            const hasPieceLaborCost = items.some((i: any) => i.piece_labor_cost != null);
                            const hasMainStone = items.some((i: any) => i.main_stone_weight != null || i.main_stone_count != null);
                            const hasSubStone = items.some((i: any) => i.sub_stone_weight != null || i.sub_stone_count != null);
                            const hasMarks = items.some((i: any) => i.main_stone_mark || i.sub_stone_mark);
                            const hasPearl = items.some((i: any) => i.pearl_weight != null);
                            const hasBearing = items.some((i: any) => i.bearing_weight != null);
                            const hasSaleCost = items.some((i: any) => i.sale_labor_cost != null || i.sale_piece_labor_cost != null);
                            return (
                          <div className="border-t border-orange-200 bg-white/50 overflow-x-auto">
                            <table className="w-full text-sm min-w-[300px]">
                              <thead className="bg-orange-100/50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品名称</th>
                                  <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品编码</th>
                                  {hasBarcode && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">条码</th>}
                                  <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">重量(g)</th>
                                  {hasLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">克工费</th>}
                                  {hasPieceCount && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件数</th>}
                                  {hasPieceLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件工费</th>}
                                  {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石重</th>}
                                  {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石粒数</th>}
                                  {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石重</th>}
                                  {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石粒数</th>}
                                  {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">主石字印</th>}
                                  {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">副石字印</th>}
                                  {hasPearl && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">珍珠重</th>}
                                  {hasBearing && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">轴承重</th>}
                                  {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售克工费</th>}
                                  {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售件工费</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-orange-100">
                                {items.map((item: any) => {
                                  const editForm = editItemForms[item.id] || { actual_weight: String(item.weight ?? ''), diff_reason: '' };
                                  const editing = editOrderId === order.id;
                                  return (
                                    <tr key={item.id}>
                                      <td className="px-3 py-2">{item.product_name}</td>
                                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.product_code || '-'}</td>
                                      {hasBarcode && <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.barcode || '-'}</td>}
                                      <td className="px-3 py-2 text-right">
                                        {editing ? (
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.actual_weight}
                                            onChange={(e) => setEditItemForms(prev => ({
                                              ...prev,
                                              [item.id]: { ...editForm, actual_weight: e.target.value }
                                            }))}
                                            className="w-24 px-2 py-1 border border-gray-200 rounded text-right"
                                          />
                                        ) : (
                                          <span className="font-medium">{item.weight}g</span>
                                        )}
                                      </td>
                                      {hasLaborCost && <td className="px-3 py-2 text-right">{item.labor_cost ?? '-'}</td>}
                                      {hasPieceCount && <td className="px-3 py-2 text-right">{item.piece_count ?? '-'}</td>}
                                      {hasPieceLaborCost && <td className="px-3 py-2 text-right">{item.piece_labor_cost ?? '-'}</td>}
                                      {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_weight ?? '-'}</td>}
                                      {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_count ?? '-'}</td>}
                                      {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_weight ?? '-'}</td>}
                                      {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_count ?? '-'}</td>}
                                      {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.main_stone_mark || '-'}</td>}
                                      {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.sub_stone_mark || '-'}</td>}
                                      {hasPearl && <td className="px-3 py-2 text-right">{item.pearl_weight ?? '-'}</td>}
                                      {hasBearing && <td className="px-3 py-2 text-right">{item.bearing_weight ?? '-'}</td>}
                                      {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_labor_cost ?? '-'}</td>}
                                      {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_piece_labor_cost ?? '-'}</td>}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                            );
                          })()}
                        </div>
                      ))}
                    </>
                  )}

                  {/* 被柜台拒收的转移单（rejected） */}
                  {pendingConfirmTransferOrders.filter(o => o.status === 'rejected').length > 0 && (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-2 mt-6">
                        <div className="flex items-center text-red-700">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          <span className="font-medium">以下转移单已被柜台拒收，您可以编辑后重新提交或删除</span>
                        </div>
                      </div>

                      {pendingConfirmTransferOrders.filter(o => o.status === 'rejected').map(order => (
                        <div key={order.id} className="border border-red-200 bg-red-50 rounded-lg overflow-hidden">
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
                                  <span>发起人: {order.created_by}</span>
                                  <span>时间: {new Date(order.created_at).toLocaleString('zh-CN')}</span>
                                </div>
                                {order.remark && (
                                  <p className="mt-2 text-sm text-red-600 bg-red-100 px-3 py-1 rounded">{order.remark}</p>
                                )}
                              </div>
                              <div className="flex flex-col space-y-2 ml-4">
                                {editOrderId === order.id ? (
                                  <>
                                    <button
                                      onClick={() => handleSaveConfirmOrder(order)}
                                      className="flex items-center justify-center space-x-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                    >
                                      <Check className="w-4 h-4" />
                                      <span>保存并重新提交</span>
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
                                  <>
                                    <button
                                      onClick={() => startEditConfirmOrder(order)}
                                      className="flex items-center justify-center space-x-1 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                                    >
                                      <FileText className="w-4 h-4" />
                                      <span>编辑重新提交</span>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransferOrder(order)}
                                      className="flex items-center justify-center space-x-1 px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                                    >
                                      <X className="w-4 h-4" />
                                      <span>删除</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* 商品明细 */}
                          {(() => {
                            const items = order.items;
                            const hasBarcode = items.some((i: any) => i.barcode);
                            const hasLaborCost = items.some((i: any) => i.labor_cost != null);
                            const hasPieceCount = items.some((i: any) => i.piece_count != null);
                            const hasPieceLaborCost = items.some((i: any) => i.piece_labor_cost != null);
                            const hasMainStone = items.some((i: any) => i.main_stone_weight != null || i.main_stone_count != null);
                            const hasSubStone = items.some((i: any) => i.sub_stone_weight != null || i.sub_stone_count != null);
                            const hasMarks = items.some((i: any) => i.main_stone_mark || i.sub_stone_mark);
                            const hasPearl = items.some((i: any) => i.pearl_weight != null);
                            const hasBearing = items.some((i: any) => i.bearing_weight != null);
                            const hasSaleCost = items.some((i: any) => i.sale_labor_cost != null || i.sale_piece_labor_cost != null);
                            return (
                          <div className="border-t border-red-200 bg-white/50 overflow-x-auto">
                            <table className="w-full text-sm min-w-[300px]">
                              <thead className="bg-red-100/50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品名称</th>
                                  <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品编码</th>
                                  {hasBarcode && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">条码</th>}
                                  <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">重量(g)</th>
                                  {hasLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">克工费</th>}
                                  {hasPieceCount && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件数</th>}
                                  {hasPieceLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件工费</th>}
                                  {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石重</th>}
                                  {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石粒数</th>}
                                  {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石重</th>}
                                  {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石粒数</th>}
                                  {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">主石字印</th>}
                                  {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">副石字印</th>}
                                  {hasPearl && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">珍珠重</th>}
                                  {hasBearing && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">轴承重</th>}
                                  {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售克工费</th>}
                                  {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售件工费</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-red-100">
                                {items.map((item: any) => {
                                  const editForm = editItemForms[item.id] || { actual_weight: String(item.weight ?? ''), diff_reason: '' };
                                  const editing = editOrderId === order.id;
                                  return (
                                    <tr key={item.id}>
                                      <td className="px-3 py-2">{item.product_name}</td>
                                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.product_code || '-'}</td>
                                      {hasBarcode && <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.barcode || '-'}</td>}
                                      <td className="px-3 py-2 text-right">
                                        {editing ? (
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={editForm.actual_weight}
                                            onChange={(e) => setEditItemForms(prev => ({
                                              ...prev,
                                              [item.id]: { ...editForm, actual_weight: e.target.value }
                                            }))}
                                            className="w-24 px-2 py-1 border border-gray-200 rounded text-right"
                                          />
                                        ) : (
                                          <span className="font-medium">{item.weight}g</span>
                                        )}
                                      </td>
                                      {hasLaborCost && <td className="px-3 py-2 text-right">{item.labor_cost ?? '-'}</td>}
                                      {hasPieceCount && <td className="px-3 py-2 text-right">{item.piece_count ?? '-'}</td>}
                                      {hasPieceLaborCost && <td className="px-3 py-2 text-right">{item.piece_labor_cost ?? '-'}</td>}
                                      {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_weight ?? '-'}</td>}
                                      {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_count ?? '-'}</td>}
                                      {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_weight ?? '-'}</td>}
                                      {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_count ?? '-'}</td>}
                                      {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.main_stone_mark || '-'}</td>}
                                      {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.sub_stone_mark || '-'}</td>}
                                      {hasPearl && <td className="px-3 py-2 text-right">{item.pearl_weight ?? '-'}</td>}
                                      {hasBearing && <td className="px-3 py-2 text-right">{item.bearing_weight ?? '-'}</td>}
                                      {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_labor_cost ?? '-'}</td>}
                                      {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_piece_labor_cost ?? '-'}</td>}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                            );
                          })()}
                        </div>
                      ))}
                    </>
                  )}

                </div>
              )}
            </div>
          )}

          {/* 已确认（商品专员查看已接收的进货单） */}
          {activeTab === 'confirmed' && (
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
              ) : confirmedTransferOrders.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无已确认的进货单</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center text-green-700">
                      <Check className="w-5 h-5 mr-2" />
                      <span className="font-medium">以下进货单已被展厅确认接收</span>
                    </div>
                  </div>

                  {/* 已确认转移单列表 */}
                  {confirmedTransferOrders.map(order => (
                    <div key={order.id} className="border border-green-200 bg-green-50 rounded-lg overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <span className="font-mono text-sm text-gray-500">{order.transfer_no}</span>
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">已确认</span>
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
                              <span>创建人: {order.created_by || '-'}</span>
                              <span>创建时间: {order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : '-'}</span>
                              {order.received_by && <span>接收人: {order.received_by}</span>}
                            </div>
                            {order.remark && (
                              <div className="text-sm text-gray-500 mt-2">
                                备注: {order.remark}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col space-y-2 ml-4">
                            <button
                              onClick={() => window.open(API_ENDPOINTS.TRANSFER_ORDER_DOWNLOAD(order.id, 'html'), '_blank')}
                              className="flex items-center justify-center space-x-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
                            >
                              <Printer className="w-4 h-4" />
                              <span>打印进货单</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      {/* 商品明细 */}
                      {(() => {
                        const items = order.items;
                        const hasBarcode = items.some((i: any) => i.barcode);
                        const hasLaborCost = items.some((i: any) => i.labor_cost != null);
                        const hasPieceCount = items.some((i: any) => i.piece_count != null);
                        const hasPieceLaborCost = items.some((i: any) => i.piece_labor_cost != null);
                        const hasMainStone = items.some((i: any) => i.main_stone_weight != null || i.main_stone_count != null);
                        const hasSubStone = items.some((i: any) => i.sub_stone_weight != null || i.sub_stone_count != null);
                        const hasMarks = items.some((i: any) => i.main_stone_mark || i.sub_stone_mark);
                        const hasPearl = items.some((i: any) => i.pearl_weight != null);
                        const hasBearing = items.some((i: any) => i.bearing_weight != null);
                        const hasSaleCost = items.some((i: any) => i.sale_labor_cost != null || i.sale_piece_labor_cost != null);
                        const baseColCount = 3 + (hasBarcode ? 1 : 0) + (hasLaborCost ? 1 : 0) + (hasPieceCount ? 1 : 0) + (hasPieceLaborCost ? 1 : 0) + (hasMainStone ? 2 : 0) + (hasSubStone ? 2 : 0) + (hasMarks ? 2 : 0) + (hasPearl ? 1 : 0) + (hasBearing ? 1 : 0) + (hasSaleCost ? 2 : 0);
                        return (
                      <div className="border-t border-green-200 bg-white/50 overflow-x-auto">
                        <table className="w-full text-sm min-w-[300px]">
                          <thead className="bg-green-100/50">
                            <tr>
                              <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品名称</th>
                              <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">商品编码</th>
                              {hasBarcode && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">条码</th>}
                              <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">预期重量(g)</th>
                              {hasLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">克工费</th>}
                              {hasPieceCount && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件数</th>}
                              {hasPieceLaborCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">件工费</th>}
                              {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石重</th>}
                              {hasMainStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">主石粒数</th>}
                              {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石重</th>}
                              {hasSubStone && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">副石粒数</th>}
                              {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">主石字印</th>}
                              {hasMarks && <th className="px-3 py-2 text-left text-gray-600 whitespace-nowrap">副石字印</th>}
                              {hasPearl && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">珍珠重</th>}
                              {hasBearing && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">轴承重</th>}
                              {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售克工费</th>}
                              {hasSaleCost && <th className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">销售件工费</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-green-100">
                            {items.map((item: any) => (
                              <tr key={item.id}>
                                <td className="px-3 py-2">{item.product_name}</td>
                                <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.product_code || '-'}</td>
                                {hasBarcode && <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.barcode || '-'}</td>}
                                <td className="px-3 py-2 text-right font-medium">{item.weight}g</td>
                                {hasLaborCost && <td className="px-3 py-2 text-right">{item.labor_cost ?? '-'}</td>}
                                {hasPieceCount && <td className="px-3 py-2 text-right">{item.piece_count ?? '-'}</td>}
                                {hasPieceLaborCost && <td className="px-3 py-2 text-right">{item.piece_labor_cost ?? '-'}</td>}
                                {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_weight ?? '-'}</td>}
                                {hasMainStone && <td className="px-3 py-2 text-right">{item.main_stone_count ?? '-'}</td>}
                                {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_weight ?? '-'}</td>}
                                {hasSubStone && <td className="px-3 py-2 text-right">{item.sub_stone_count ?? '-'}</td>}
                                {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.main_stone_mark || '-'}</td>}
                                {hasMarks && <td className="px-3 py-2 text-gray-500 text-xs">{item.sub_stone_mark || '-'}</td>}
                                {hasPearl && <td className="px-3 py-2 text-right">{item.pearl_weight ?? '-'}</td>}
                                {hasBearing && <td className="px-3 py-2 text-right">{item.bearing_weight ?? '-'}</td>}
                                {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_labor_cost ?? '-'}</td>}
                                {hasSaleCost && <td className="px-3 py-2 text-right">{item.sale_piece_labor_cost ?? '-'}</td>}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-green-100/50">
                            <tr>
                              <td colSpan={baseColCount - 1} className="px-3 py-2 text-right font-semibold">合计</td>
                              <td className="px-3 py-2 text-right font-semibold text-green-700">
                                {order.total_actual_weight || order.total_weight || order.items.reduce((sum: number, item: any) => sum + (item.actual_weight || item.weight), 0)}g
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                        );
                      })()}
                    </div>
                  ))}

                </div>
              )}
            </div>
          )}
        </div>

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
                        {recentInboundOrders.filter(o => selectedOrderIds.has(o.id)).reduce((sum, o) => sum + o.total_weight, 0).toFixed(3)} 克
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



