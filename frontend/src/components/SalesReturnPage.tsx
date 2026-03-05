import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Clock, AlertCircle, RefreshCw, X, Package, User, Calendar,
  Search, Filter, RotateCcw, Plus, Trash2, Eye, ChevronRight, DollarSign,
  Undo2, ArrowLeft
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchWithCacheJson } from '../utils/fetchCache';

// ============= 类型定义 =============

interface SalesReturnItem {
  id?: number;
  product_name: string;
  weight: number;
  labor_cost_per_gram: number;
  quantity: number;
  labor_cost_per_piece: number;
  line_total: number;
}

interface SalesReturnOrder {
  id: number;
  return_no: string;
  return_date: string;
  customer_id: number;
  customer_name: string;
  return_to: string;
  return_reason: string;
  salesperson: string;
  total_weight: number;
  total_labor_cost: number;
  item_count: number;
  remark: string | null;
  status: string;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  items: SalesReturnItem[];
}

interface SalesReturnSettlement {
  id: number;
  settlement_no: string;
  return_order_id: number;
  return_order_no: string;
  customer_name: string;
  payment_method: string;
  gold_price: number | null;
  gold_payment_weight: number | null;
  cash_payment_weight: number | null;
  total_weight: number;
  material_amount: number | null;
  labor_amount: number;
  total_amount: number;
  status: string;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  remark: string | null;
  return_order: SalesReturnOrder | null;
}

interface OrderLog {
  id: number;
  action: string;
  operator: string;
  action_time: string;
  old_status: string | null;
  new_status: string;
  remark: string | null;
}

interface Customer {
  id: number;
  name: string;
  phone: string | null;
}

interface ProductCode {
  id: number;
  code: string;
  name: string;
}

interface InventoryItem {
  product_name: string;
  product_code: string;
  total_purchased_weight: number;
  total_returned_weight: number;
  available_weight: number;
  total_labor_cost: number;
  piece_count: number;
}

interface CreateItem {
  product_code: string;
  product_name: string;
  weight: string;
  labor_cost_per_gram: string;
  quantity: string;
  labor_cost_per_piece: string;
}

// ============= 辅助组件 =============

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '未确认' },
    confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', label: '已确认' },
    '待结算': { bg: 'bg-orange-100', text: 'text-orange-700', label: '待结算' },
    '已结算': { bg: 'bg-green-100', text: 'text-green-700', label: '已结算' },
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待确认' },
  };
  const { bg, text, label } = config[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>{label}</span>;
};

const TabButton: React.FC<{
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number;
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
        }`}>{count}</span>
    )}
  </button>
);

// ============= 主组件 =============

interface SalesReturnPageProps {
  userRole?: string;
}

const returnToLabel = (val: string | undefined | null): string => {
  if (!val) return '-';
  if (val === 'showroom') return '展厅';
  if (val === 'warehouse') return '商品部';
  return val;
};

const SalesReturnPage: React.FC<SalesReturnPageProps> = (props) => {
  const userRole = props.userRole || 'settlement';
  const API_BASE = API_ENDPOINTS.API_BASE_URL;

  type TabType = 'orders' | 'settlements';
  const [activeTab, setActiveTab] = useState<TabType>('orders');
  const [loading, setLoading] = useState(false);
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const [confirmingReturnSettlement, setConfirmingReturnSettlement] = useState(false);

  // 销退单数据
  const [returnOrders, setReturnOrders] = useState<SalesReturnOrder[]>([]);
  const [orderFilters, setOrderFilters] = useState({
    status: '',
    keyword: '',
    start_date: '',
    end_date: '',
  });
  const [orderCurrentPage, setOrderCurrentPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  const orderPageSize = 20;

  // 销退结算数据
  const [pendingReturns, setPendingReturns] = useState<SalesReturnOrder[]>([]);
  const [settlements, setSettlements] = useState<SalesReturnSettlement[]>([]);
  const [settlementFilters, setSettlementFilters] = useState({
    status: '',
    keyword: '',
  });

  // 结算子 Tab
  type SettlementSubTab = 'pending' | 'list';
  const [settlementSubTab, setSettlementSubTab] = useState<SettlementSubTab>('pending');

  // 创建销退单
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    customer_id: 0,
    customer_name: '',
    return_to: '展厅',
    return_reason: '客户退货',
    salesperson: '',
    remark: '',
  });
  const [createItems, setCreateItems] = useState<CreateItem[]>([
    { product_code: '', product_name: '', weight: '', labor_cost_per_gram: '', quantity: '1', labor_cost_per_piece: '' },
  ]);

  // 业务员列表
  const [salespersonList, setSalespersonList] = useState<{ id: number; name: string }[]>([]);

  // 商品编码
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [codeDropdownIndex, setCodeDropdownIndex] = useState<number | null>(null);
  const [codeSearchResults, setCodeSearchResults] = useState<ProductCode[]>([]);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 客户可退库存
  const [customerInventory, setCustomerInventory] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryDropdownIndex, setInventoryDropdownIndex] = useState<number | null>(null);
  const [inventoryDropdownPos, setInventoryDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 详情弹窗
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailOrder, setDetailOrder] = useState<SalesReturnOrder | null>(null);
  const [detailLogs, setDetailLogs] = useState<OrderLog[]>([]);

  // 创建销退结算弹窗
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [selectedReturnForSettlement, setSelectedReturnForSettlement] = useState<SalesReturnOrder | null>(null);
  const [settlementForm, setSettlementForm] = useState({
    payment_method: 'cash_price',
    gold_price: '',
    gold_payment_weight: '',
    cash_payment_weight: '',
    remark: '',
  });

  // 搜索面板
  const [showOrderSearchPanel, setShowOrderSearchPanel] = useState(false);
  const [showSettlementSearchPanel, setShowSettlementSearchPanel] = useState(false);

  // ============= 数据加载 =============

  const loadReturnOrders = useCallback(async (page = orderCurrentPage) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (orderFilters.status) params.append('status', orderFilters.status);
      if (orderFilters.keyword) params.append('keyword', orderFilters.keyword);
      if (orderFilters.start_date) params.append('start_date', orderFilters.start_date);
      if (orderFilters.end_date) params.append('end_date', orderFilters.end_date);
      params.append('page', String(page));
      params.append('page_size', String(orderPageSize));

      const processData = (result: any) => {
        const data = result.data || result;
        if (data && data.orders) {
          setReturnOrders(Array.isArray(data.orders) ? data.orders : []);
          setOrderTotal(data.total || 0);
          setOrderTotalPages(data.total_pages || 0);
          setOrderCurrentPage(data.page || page);
        } else {
          setReturnOrders(Array.isArray(data) ? data : []);
        }
      };

      const data = await fetchWithCacheJson(`${API_BASE}/api/sales-returns/orders?${params.toString()}`, {}, (cachedData) => {
        processData(cachedData);
        setLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载销退单失败:', error);
      setReturnOrders([]);
    } finally {
      setLoading(false);
    }
  }, [orderFilters, orderCurrentPage, API_BASE]);

  const loadPendingReturns = useCallback(async () => {
    try {
      const processData = (result: any) => {
        const data = result.data || result;
        setPendingReturns(Array.isArray(data) ? data : []);
      };

      const data = await fetchWithCacheJson(`${API_BASE}/api/sales-returns/pending-returns`, {}, processData);
      processData(data);
    } catch (error) {
      console.error('加载待结算销退单失败:', error);
      setPendingReturns([]);
    }
  }, [API_BASE]);

  const loadSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (settlementFilters.status) params.append('status', settlementFilters.status);
      if (settlementFilters.keyword) params.append('keyword', settlementFilters.keyword);

      const processData = (result: any) => {
        const data = result.data || result;
        setSettlements(Array.isArray(data) ? data : []);
      };

      const data = await fetchWithCacheJson(`${API_BASE}/api/sales-returns/settlements?${params.toString()}`, {}, (cachedData) => {
        processData(cachedData);
        setLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载销退结算单失败:', error);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [settlementFilters, API_BASE]);

  useEffect(() => {
    loadReturnOrders();
  }, [loadReturnOrders]);

  useEffect(() => {
    if (activeTab === 'settlements') {
      loadPendingReturns();
      loadSettlements();
    }
  }, [activeTab, loadPendingReturns, loadSettlements]);

  // ============= 加载业务员列表 =============

  const fetchSalespersonList = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/salespersons`);
      const data = await response.json();
      if (data.success) {
        setSalespersonList(data.salespersons || []);
      }
    } catch (error) {
      console.error('获取业务员列表失败:', error);
    }
  };

  // ============= 客户搜索 =============

  useEffect(() => {
    const timer = setTimeout(() => {
      searchCustomers(customerSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const searchCustomers = async (keyword: string) => {
    setCustomerSearchLoading(true);
    try {
      const params = keyword ? `search=${encodeURIComponent(keyword)}&page_size=50` : 'page_size=50';
      const response = await fetch(`${API_BASE}/api/customers?${params}`);
      if (response.ok) {
        const result = await response.json();
        const customers = result.data?.customers || result.data || result;
        setCustomerResults(Array.isArray(customers) ? customers : []);
        setShowCustomerDropdown(true);
      }
    } catch (error) {
      console.error('搜索客户失败:', error);
    } finally {
      setCustomerSearchLoading(false);
    }
  };

  const handleSelectCustomer = async (customer: Customer) => {
    setCreateForm({ ...createForm, customer_id: customer.id, customer_name: customer.name });
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
    // 重置商品行
    setCreateItems([{ product_code: '', product_name: '', weight: '', labor_cost_per_gram: '', quantity: '1', labor_cost_per_piece: '' }]);

    // 自动推荐业务员（基于客户历史销售记录）
    try {
      const response = await fetch(
        `${API_BASE}/api/customers/suggest-salesperson?customer_name=${encodeURIComponent(customer.name)}`
      );
      const data = await response.json();
      if (data.success && data.data?.salesperson) {
        setCreateForm(prev => ({ ...prev, customer_id: customer.id, customer_name: customer.name, salesperson: data.data.salesperson }));
      }
    } catch (error) {
      console.error('获取推荐业务员失败:', error);
    }

    // 加载客户可退库存
    await loadCustomerInventory(customer.id);
  };

  const loadCustomerInventory = async (customerId: number) => {
    setInventoryLoading(true);
    setCustomerInventory([]);
    try {
      const response = await fetch(
        `${API_BASE}/api/sales-returns/customer-inventory/${customerId}?user_role=${userRole}`
      );
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data?.items) {
          setCustomerInventory(result.data.items);
        }
      }
    } catch (error) {
      console.error('获取客户可退库存失败:', error);
    } finally {
      setInventoryLoading(false);
    }
  };

  // ============= 商品编码搜索 =============

  const fetchProductCodes = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/product-codes?limit=1000`);
      if (response.ok) {
        const data = await response.json();
        const codeList = Array.isArray(data) ? data : (data.codes || []);
        setProductCodes(codeList);
      }
    } catch (error) {
      console.error('获取商品编码列表失败:', error);
    }
  };

  // 计算某商品在当前表单中已分配的克重（排除指定行）
  const getUsedWeight = (productName: string, excludeIndex: number): number => {
    return createItems.reduce((sum, item, i) => {
      if (i === excludeIndex) return sum;
      if (item.product_name === productName) return sum + (parseFloat(item.weight) || 0);
      return sum;
    }, 0);
  };

  // 获取指定行可退的剩余克重
  const getAvailableForRow = (index: number): number | null => {
    const item = createItems[index];
    if (!item.product_name) return null;
    const inv = customerInventory.find(i => i.product_name === item.product_name);
    if (!inv) return null;
    return Math.max(0, round3(inv.available_weight - getUsedWeight(item.product_name, index)));
  };

  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  const selectInventoryItem = (index: number, inv: InventoryItem) => {
    const newItems = [...createItems];
    newItems[index] = { ...newItems[index], product_code: inv.product_code, product_name: inv.product_name };
    setCreateItems(newItems);
    setInventoryDropdownIndex(null);
  };

  const searchCode = (index: number, query: string) => {
    if (!query.trim()) {
      setCodeSearchResults([]);
      setCodeDropdownIndex(null);
      return;
    }
    const q = query.toLowerCase();
    const results = productCodes.filter(
      pc => pc.code.toLowerCase().includes(q) || pc.name.toLowerCase().includes(q)
    ).slice(0, 8);
    setCodeSearchResults(results);
    setCodeDropdownIndex(results.length > 0 ? index : null);
  };

  const handleProductCodeChange = (index: number, value: string) => {
    const newItems = [...createItems];
    // 如果有客户库存，从库存中匹配
    if (customerInventory.length > 0) {
      const matched = customerInventory.find(i => i.product_code.toLowerCase() === value.trim().toLowerCase());
      newItems[index] = {
        ...newItems[index],
        product_code: value,
        product_name: matched ? matched.product_name : newItems[index].product_name
      };
    } else {
      const matched = productCodes.find(pc => pc.code.toLowerCase() === value.trim().toLowerCase());
      newItems[index] = {
        ...newItems[index],
        product_code: value,
        product_name: matched ? matched.name : newItems[index].product_name
      };
    }
    setCreateItems(newItems);
    searchCode(index, value);
  };

  const selectProductCode = (index: number, pc: ProductCode) => {
    const newItems = [...createItems];
    newItems[index] = { ...newItems[index], product_code: pc.code, product_name: pc.name };
    setCreateItems(newItems);
    setCodeDropdownIndex(null);
    setCodeSearchResults([]);
  };

  const handleProductNameChange = (index: number, name: string) => {
    const matched = productCodes.find(pc => pc.name === name);
    const newItems = [...createItems];
    newItems[index] = {
      ...newItems[index],
      product_name: name,
      product_code: matched ? matched.code : newItems[index].product_code
    };
    setCreateItems(newItems);
  };

  // ============= 多商品行操作 =============

  const addItem = () => {
    setCreateItems([...createItems, { product_code: '', product_name: '', weight: '', labor_cost_per_gram: '', quantity: '1', labor_cost_per_piece: '' }]);
  };

  const removeItem = (index: number) => {
    if (createItems.length <= 1) return;
    setCreateItems(createItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof CreateItem, value: string) => {
    const newItems = [...createItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setCreateItems(newItems);
  };

  const calcLineTotal = (item: CreateItem): number => {
    const weight = parseFloat(item.weight) || 0;
    const laborPerGram = parseFloat(item.labor_cost_per_gram) || 0;
    const qty = parseInt(item.quantity) || 0;
    const laborPerPiece = parseFloat(item.labor_cost_per_piece) || 0;
    return weight * laborPerGram + qty * laborPerPiece;
  };

  const calcTotalWeight = (): number => {
    return createItems.reduce((sum, item) => sum + (parseFloat(item.weight) || 0), 0);
  };

  const calcTotalLaborCost = (): number => {
    return createItems.reduce((sum, item) => sum + calcLineTotal(item), 0);
  };

  // ============= 创建销退单 =============

  const handleCreateReturnOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createForm.customer_id) {
      toast.error('请选择客户');
      return;
    }

    const validItems = createItems.filter(item => item.product_name && item.weight);
    if (validItems.length === 0) {
      toast.error('请添加至少一个退货商品');
      return;
    }

    // 前端库存校验
    if (customerInventory.length > 0) {
      // 按品名汇总本次退货克重
      const returnByName: Record<string, number> = {};
      for (const item of validItems) {
        returnByName[item.product_name] = (returnByName[item.product_name] || 0) + (parseFloat(item.weight) || 0);
      }
      const errors: string[] = [];
      for (const [name, weight] of Object.entries(returnByName)) {
        const inv = customerInventory.find(i => i.product_name === name);
        if (!inv) {
          errors.push(`「${name}」不在客户已购记录中`);
          continue;
        }
        if (weight > inv.available_weight + 0.001) {
          errors.push(`「${name}」可退 ${inv.available_weight}g，本次申请 ${weight}g`);
        }
      }
      if (errors.length > 0) {
        toast.error('库存校验失败：' + errors.join('；'));
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE}/api/sales-returns/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: createForm.customer_id,
          customer_name: createForm.customer_name,
          return_to: createForm.return_to === '展厅' ? 'showroom' : 'warehouse',
          return_reason: createForm.return_reason,
          salesperson: createForm.salesperson || null,
          remark: createForm.remark || null,
          items: validItems.map(item => ({
            product_code: item.product_code || null,
            product_name: item.product_name,
            weight: parseFloat(item.weight),
            labor_cost: parseFloat(item.labor_cost_per_gram) || 0,
            piece_count: parseInt(item.quantity) || 1,
            piece_labor_cost: parseFloat(item.labor_cost_per_piece) || 0,
          })),
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success === false) {
          toast.error(result.message || '创建失败');
          return;
        }
        toast.success('销退单创建成功');
        resetCreateForm();
        loadReturnOrders();
      } else {
        const error = await response.json();
        toast.error(error.message || error.detail || '创建失败');
      }
    } catch (error) {
      console.error('创建销退单失败:', error);
      toast.error('创建销退单失败');
    }
  };

  const resetCreateForm = () => {
    setShowCreateModal(false);
    setCreateForm({ customer_id: 0, customer_name: '', return_to: '展厅', return_reason: '客户退货', salesperson: '', remark: '' });
    setCreateItems([{ product_code: '', product_name: '', weight: '', labor_cost_per_gram: '', quantity: '1', labor_cost_per_piece: '' }]);
    setCodeDropdownIndex(null);
    setCodeSearchResults([]);
    setCustomerSearch('');
    setShowCustomerDropdown(false);
    setCustomerInventory([]);
    setInventoryDropdownIndex(null);
  };

  // ============= 确认/反确认销退单 =============

  const handleConfirmOrder = async (order: SalesReturnOrder) => {
    if (confirmingReturn) return;
    if (!confirm(`确定要确认销退单 ${order.return_no} 吗？`)) return;

    setConfirmingReturn(true);
    try {
      const params = new URLSearchParams({ user_role: userRole, created_by: userRole });
      const response = await fetch(`${API_BASE}/api/sales-returns/orders/${order.id}/confirm?${params}`, {
        method: 'POST',
      });

      if (response.ok) {
        toast.success('销退单已确认');
        loadReturnOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    } finally {
      setConfirmingReturn(false);
    }
  };

  const handleUnconfirmOrder = async (order: SalesReturnOrder) => {
    if (!confirm(`确定要反确认销退单 ${order.return_no} 吗？`)) return;

    try {
      const params = new URLSearchParams({ user_role: userRole, created_by: userRole });
      const response = await fetch(`${API_BASE}/api/sales-returns/orders/${order.id}/unconfirm?${params}`, {
        method: 'POST',
      });

      if (response.ok) {
        toast.success('销退单已反确认');
        loadReturnOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '反确认失败');
      }
    } catch (error) {
      toast.error('反确认失败');
    }
  };

  // ============= 查看详情 =============

  const handleViewDetail = async (order: SalesReturnOrder) => {
    try {
      const [orderRes, logsRes] = await Promise.all([
        fetch(`${API_BASE}/api/sales-returns/orders/${order.id}`),
        fetch(`${API_BASE}/api/order-logs/sales_return/${order.id}`),
      ]);

      if (orderRes.ok) {
        const orderResult = await orderRes.json();
        const orderData = orderResult.data || orderResult;
        setDetailOrder(orderData);
      } else {
        setDetailOrder(order);
      }

      if (logsRes.ok) {
        const logsResult = await logsRes.json();
        const logsData = logsResult.data || logsResult;
        setDetailLogs(Array.isArray(logsData) ? logsData : []);
      } else {
        setDetailLogs([]);
      }

      setShowDetailModal(true);
    } catch (error) {
      console.error('加载详情失败:', error);
      setDetailOrder(order);
      setDetailLogs([]);
      setShowDetailModal(true);
    }
  };

  // ============= 创建销退结算 =============

  const openSettlementModal = (returnOrder: SalesReturnOrder) => {
    setSelectedReturnForSettlement(returnOrder);
    setSettlementForm({ payment_method: 'cash_price', gold_price: '', gold_payment_weight: '', cash_payment_weight: '', remark: '' });
    setShowSettlementModal(true);
  };

  const calcSettlementAmounts = () => {
    if (!selectedReturnForSettlement) return { materialAmount: 0, laborAmount: 0, totalAmount: 0, goldReturned: 0 };

    const totalWeight = selectedReturnForSettlement.total_weight || 0;
    const laborAmount = selectedReturnForSettlement.total_labor_cost || 0;
    const goldPrice = parseFloat(settlementForm.gold_price) || 0;

    if (settlementForm.payment_method === 'cash_price') {
      const materialAmount = goldPrice * totalWeight;
      return { materialAmount, laborAmount, totalAmount: materialAmount + laborAmount, goldReturned: 0 };
    } else if (settlementForm.payment_method === 'physical_gold') {
      return { materialAmount: 0, laborAmount, totalAmount: laborAmount, goldReturned: totalWeight };
    } else {
      // mixed
      const goldPaymentWeight = parseFloat(settlementForm.gold_payment_weight) || 0;
      const cashPaymentWeight = parseFloat(settlementForm.cash_payment_weight) || 0;
      const materialAmount = goldPrice * cashPaymentWeight;
      return { materialAmount, laborAmount, totalAmount: materialAmount + laborAmount, goldReturned: goldPaymentWeight };
    }
  };

  const handleCreateSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturnForSettlement) return;

    if (settlementForm.payment_method === 'cash_price' && !settlementForm.gold_price) {
      toast.error('请输入当日金价');
      return;
    }

    if (settlementForm.payment_method === 'mixed') {
      if (!settlementForm.gold_price) {
        toast.error('混合退款需要填写当日金价');
        return;
      }
      const goldWeight = parseFloat(settlementForm.gold_payment_weight) || 0;
      const cashWeight = parseFloat(settlementForm.cash_payment_weight) || 0;
      const totalInput = goldWeight + cashWeight;
      const totalWeight = selectedReturnForSettlement.total_weight || 0;
      if (Math.abs(totalInput - totalWeight) > 0.01) {
        toast.error(`退料克重(${goldWeight})与退价克重(${cashWeight})之和(${totalInput.toFixed(3)})必须等于总重量(${totalWeight.toFixed(3)})`);
        return;
      }
    }

    try {
      const data: any = {
        sales_return_order_id: selectedReturnForSettlement.id,
        payment_method: settlementForm.payment_method,
        remark: settlementForm.remark || null,
      };

      if (settlementForm.payment_method === 'cash_price' || settlementForm.payment_method === 'mixed') {
        data.gold_price = parseFloat(settlementForm.gold_price);
      }
      if (settlementForm.payment_method === 'mixed') {
        data.gold_payment_weight = parseFloat(settlementForm.gold_payment_weight) || 0;
        data.cash_payment_weight = parseFloat(settlementForm.cash_payment_weight) || 0;
      }

      const response = await fetch(`${API_BASE}/api/sales-returns/settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        toast.success('销退结算单创建成功');
        setShowSettlementModal(false);
        setSelectedReturnForSettlement(null);
        loadPendingReturns();
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建销退结算单失败');
      }
    } catch (error) {
      toast.error('创建销退结算单失败');
    }
  };

  // ============= 确认/反确认结算单 =============

  const handleConfirmSettlement = async (settlement: SalesReturnSettlement) => {
    if (confirmingReturnSettlement) return;
    if (!confirm(`确定要确认销退结算单 ${settlement.settlement_no} 吗？`)) return;

    setConfirmingReturnSettlement(true);
    try {
      const params = new URLSearchParams({ user_role: userRole, created_by: userRole });
      const response = await fetch(`${API_BASE}/api/sales-returns/settlements/${settlement.id}/confirm?${params}`, {
        method: 'POST',
      });

      if (response.ok) {
        toast.success('销退结算单已确认');
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    } finally {
      setConfirmingReturnSettlement(false);
    }
  };

  const handleRevertSettlement = async (settlement: SalesReturnSettlement) => {
    if (!confirm(`确定要反确认销退结算单 ${settlement.settlement_no} 吗？`)) return;

    try {
      const params = new URLSearchParams({ user_role: userRole, created_by: userRole });
      const response = await fetch(`${API_BASE}/api/sales-returns/settlements/${settlement.id}/revert?${params}`, {
        method: 'POST',
      });

      if (response.ok) {
        toast.success('销退结算单已反确认');
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '反确认失败');
      }
    } catch (error) {
      toast.error('反确认失败');
    }
  };

  // ============= 搜索操作 =============

  const handleResetOrderFilters = () => {
    setOrderFilters({ status: '', keyword: '', start_date: '', end_date: '' });
    setOrderCurrentPage(1);
  };

  const handleResetSettlementFilters = () => {
    setSettlementFilters({ status: '', keyword: '' });
  };

  // ============= 统计计算 =============

  const safeOrders = Array.isArray(returnOrders) ? returnOrders : [];
  const totalOrders = orderTotal || safeOrders.length;
  const draftOrders = safeOrders.filter(o => o.status === 'draft').length;
  const confirmedOrders = safeOrders.filter(o => o.status === 'confirmed' || o.status === '待结算').length;
  const totalWeight = safeOrders.reduce((sum, o) => sum + (o.total_weight || 0), 0);

  const safePendingReturns = Array.isArray(pendingReturns) ? pendingReturns : [];
  const safeSettlements = Array.isArray(settlements) ? settlements : [];

  const paymentMethodLabel = (method: string): string => {
    const map: Record<string, string> = {
      cash_price: '退价',
      physical_gold: '退料',
      mixed: '混合退款',
    };
    return map[method] || method;
  };

  // ============= 渲染 =============

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-xl shadow-lg shadow-amber-200/50">
              <RotateCcw className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">销退管理</h1>
              <p className="text-gray-500 text-sm">管理销售退货单据与销退结算</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {activeTab === 'orders' && (
              <button
                onClick={() => { setShowCreateModal(true); fetchProductCodes(); searchCustomers(''); fetchSalespersonList(); }}
                className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white
                  rounded-xl shadow-lg shadow-amber-200/50 hover:from-amber-600 hover:to-yellow-600
                  transition-all font-medium"
              >
                <Plus className="w-4 h-4" />
                <span>新建销退单</span>
              </button>
            )}
            <button
              onClick={() => {
                loadReturnOrders();
                if (activeTab === 'settlements') {
                  loadPendingReturns();
                  loadSettlements();
                }
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white
                rounded-xl shadow-lg shadow-gray-200/50 hover:from-gray-600 hover:to-gray-700
                transition-all font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {/* 统计栏 + Tab */}
        <div className="bg-white rounded-xl shadow-sm mb-4">
          {activeTab === 'orders' && (
            <div className="px-4 py-3 flex flex-wrap gap-4 text-sm border-b">
              <span className="text-gray-600">总销退单 <strong className="text-gray-900">{totalOrders}</strong></span>
              <span className="text-yellow-600">未确认 <strong>{draftOrders}</strong></span>
              <span className="text-blue-600">已确认 <strong>{confirmedOrders}</strong></span>
              <span className="text-amber-600">总重量 <strong>{totalWeight.toFixed(3)}g</strong></span>
            </div>
          )}

          {/* Tab 切换 */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex space-x-3">
              <TabButton
                active={activeTab === 'orders'}
                onClick={() => setActiveTab('orders')}
                icon={<FileText className="w-4 h-4" />}
                label="销退单"
                count={totalOrders}
              />
              <TabButton
                active={activeTab === 'settlements'}
                onClick={() => setActiveTab('settlements')}
                icon={<DollarSign className="w-4 h-4" />}
                label="销退结算"
                count={safePendingReturns.length}
              />
            </div>
          </div>

          {/* 销退单 - 筛选面板 */}
          {activeTab === 'orders' && (
            <>
              <div className="border-t">
                <button
                  onClick={() => setShowOrderSearchPanel(!showOrderSearchPanel)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Filter className="w-4 h-4" />
                    筛选查询
                  </span>
                  {showOrderSearchPanel ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
              {showOrderSearchPanel && (
                <div className="px-4 pb-4 border-t pt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">状态</label>
                      <select
                        value={orderFilters.status}
                        onChange={(e) => setOrderFilters({ ...orderFilters, status: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      >
                        <option value="">全部</option>
                        <option value="draft">未确认</option>
                        <option value="confirmed">已确认</option>
                        <option value="待结算">待结算</option>
                        <option value="已结算">已结算</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">关键词</label>
                      <input
                        type="text"
                        value={orderFilters.keyword}
                        onChange={(e) => setOrderFilters({ ...orderFilters, keyword: e.target.value })}
                        placeholder="单号/客户"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">开始日期</label>
                      <input
                        type="date"
                        value={orderFilters.start_date}
                        onChange={(e) => setOrderFilters({ ...orderFilters, start_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">结束日期</label>
                      <input
                        type="date"
                        value={orderFilters.end_date}
                        onChange={(e) => setOrderFilters({ ...orderFilters, end_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        onClick={() => { setOrderCurrentPage(1); loadReturnOrders(1); }}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 flex items-center gap-1"
                      >
                        <Search className="w-4 h-4" />
                        搜索
                      </button>
                      <button
                        onClick={handleResetOrderFilters}
                        className="px-4 py-2 border text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                      >
                        重置
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ==================== Tab 1: 销退单 ==================== */}
        {activeTab === 'orders' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                <span className="ml-2 text-gray-500">加载中...</span>
              </div>
            ) : safeOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg">暂无销退单</p>
                <p className="text-sm text-gray-400 mt-2">点击"新建销退单"创建退货记录</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">销退单号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">日期</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">客户</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">退回地点</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">退货商品</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">总重量(g)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">总工费(元)</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">原因</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {safeOrders.map(order => (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-amber-600 font-mono text-xs">{order.return_no}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {order.return_date ? new Date(order.return_date).toLocaleDateString('zh-CN') : order.created_at ? new Date(order.created_at).toLocaleDateString('zh-CN') : '-'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">{order.customer_name || '-'}</td>
                        <td className="px-4 py-3 text-center text-xs">
                          <span className={`px-2 py-0.5 rounded-full ${returnToLabel(order.return_to) === '展厅' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                            }`}>
                            {returnToLabel(order.return_to)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">{order.item_count || (Array.isArray(order.items) ? order.items.length : 0)}</td>
                        <td className="px-4 py-3 text-right font-medium">{(order.total_weight || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-medium text-amber-600">¥{(order.total_labor_cost || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-center text-xs text-gray-600">{order.return_reason || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1.5 justify-center">
                            <button
                              onClick={() => handleViewDetail(order)}
                              className="px-2.5 py-1 text-xs font-medium bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors border border-gray-200"
                            >
                              详情
                            </button>
                            {order.status === 'draft' && (
                              <button
                                onClick={() => handleConfirmOrder(order)}
                                disabled={confirmingReturn}
                                className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {confirmingReturn ? '确认中...' : '确认'}
                              </button>
                            )}
                            {order.status === 'confirmed' && (
                              <button
                                onClick={() => handleUnconfirmOrder(order)}
                                className="px-2.5 py-1 text-xs font-medium bg-orange-50 text-orange-700 rounded-md hover:bg-orange-100 transition-colors border border-orange-200"
                              >
                                反确认
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 分页控件 */}
            {orderTotalPages > 1 && (
              <div className="px-4 py-3 flex items-center justify-between border-t bg-gray-50/50">
                <span className="text-sm text-gray-500">
                  共 {orderTotal} 条，第 {orderCurrentPage}/{orderTotalPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setOrderCurrentPage(1); loadReturnOrders(1); }}
                    disabled={orderCurrentPage <= 1}
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >首页</button>
                  <button
                    onClick={() => { const p = orderCurrentPage - 1; setOrderCurrentPage(p); loadReturnOrders(p); }}
                    disabled={orderCurrentPage <= 1}
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >上一页</button>
                  {Array.from({ length: Math.min(5, orderTotalPages) }, (_, i) => {
                    let pageNum: number;
                    if (orderTotalPages <= 5) {
                      pageNum = i + 1;
                    } else if (orderCurrentPage <= 3) {
                      pageNum = i + 1;
                    } else if (orderCurrentPage >= orderTotalPages - 2) {
                      pageNum = orderTotalPages - 4 + i;
                    } else {
                      pageNum = orderCurrentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => { setOrderCurrentPage(pageNum); loadReturnOrders(pageNum); }}
                        className={`px-2.5 py-1 text-xs rounded border ${pageNum === orderCurrentPage
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white hover:bg-gray-50'
                          }`}
                      >{pageNum}</button>
                    );
                  })}
                  <button
                    onClick={() => { const p = orderCurrentPage + 1; setOrderCurrentPage(p); loadReturnOrders(p); }}
                    disabled={orderCurrentPage >= orderTotalPages}
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >下一页</button>
                  <button
                    onClick={() => { setOrderCurrentPage(orderTotalPages); loadReturnOrders(orderTotalPages); }}
                    disabled={orderCurrentPage >= orderTotalPages}
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >末页</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== Tab 2: 销退结算 ==================== */}
        {activeTab === 'settlements' && (
          <div className="space-y-4">
            {/* 子 Tab 切换 */}
            <div className="flex space-x-2">
              <button
                onClick={() => setSettlementSubTab('pending')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${settlementSubTab === 'pending'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
              >
                待开销退结算 ({safePendingReturns.length})
              </button>
              <button
                onClick={() => setSettlementSubTab('list')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${settlementSubTab === 'list'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
              >
                销退结算单一览 ({safeSettlements.length})
              </button>
            </div>

            {/* 待开销退结算 */}
            {settlementSubTab === 'pending' && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {safePendingReturns.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg">暂无待结算销退单</p>
                    <p className="text-sm text-gray-400 mt-2">确认的销退单会显示在这里等待开具结算单</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">销退单号</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">客户</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">退回地点</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">重量(g)</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">工费(元)</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">原因</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {safePendingReturns.map(order => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <span className="font-medium text-amber-600 font-mono text-xs">{order.return_no}</span>
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-800">{order.customer_name || '-'}</td>
                            <td className="px-4 py-3 text-center text-xs">
                              <span className={`px-2 py-0.5 rounded-full ${returnToLabel(order.return_to) === '展厅' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                                }`}>
                                {returnToLabel(order.return_to)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-medium">{(order.total_weight || 0).toFixed(3)}</td>
                            <td className="px-4 py-3 text-right font-medium text-amber-600">¥{(order.total_labor_cost || 0).toFixed(2)}</td>
                            <td className="px-4 py-3 text-center text-xs text-gray-600">{order.return_reason || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge status={order.status} />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => openSettlementModal(order)}
                                className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-200"
                              >
                                开销退结算
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 销退结算单一览 */}
            {settlementSubTab === 'list' && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* 筛选面板 */}
                <div className="border-b">
                  <button
                    onClick={() => setShowSettlementSearchPanel(!showSettlementSearchPanel)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Filter className="w-4 h-4" />
                      筛选查询
                    </span>
                    {showSettlementSearchPanel ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
                {showSettlementSearchPanel && (
                  <div className="px-4 pb-4 border-b pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">状态</label>
                        <select
                          value={settlementFilters.status}
                          onChange={(e) => setSettlementFilters({ ...settlementFilters, status: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                        >
                          <option value="">全部</option>
                          <option value="draft">未确认</option>
                          <option value="confirmed">已确认</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">关键词</label>
                        <input
                          type="text"
                          value={settlementFilters.keyword}
                          onChange={(e) => setSettlementFilters({ ...settlementFilters, keyword: e.target.value })}
                          placeholder="结算单号/客户"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          onClick={() => loadSettlements()}
                          className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 flex items-center gap-1"
                        >
                          <Search className="w-4 h-4" />
                          搜索
                        </button>
                        <button
                          onClick={handleResetSettlementFilters}
                          className="px-4 py-2 border text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                        >
                          重置
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                    <span className="ml-2 text-gray-500">加载中...</span>
                  </div>
                ) : safeSettlements.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <FileText className="w-12 h-12 mb-3 opacity-50" />
                    <p>暂无销退结算单</p>
                    <p className="text-sm mt-1">从"待开销退结算"创建结算单</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">结算单号</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">销退单号</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">客户</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">退款方式</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">退款总额(元)</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">创建时间</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {safeSettlements.map(settlement => (
                          <tr key={settlement.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <span className="font-medium text-amber-600 font-mono text-xs">{settlement.settlement_no}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-gray-600 font-mono text-xs">{settlement.return_order_no || settlement.return_order?.return_no || '-'}</span>
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-800">{settlement.customer_name || settlement.return_order?.customer_name || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs ${settlement.payment_method === 'cash_price' ? 'bg-green-50 text-green-600' :
                                  settlement.payment_method === 'physical_gold' ? 'bg-yellow-50 text-yellow-600' :
                                    'bg-purple-50 text-purple-600'
                                }`}>
                                {paymentMethodLabel(settlement.payment_method)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-amber-600">
                              ¥{(settlement.total_amount || 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge status={settlement.status} />
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {settlement.created_at ? new Date(settlement.created_at).toLocaleString('zh-CN') : '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex gap-1.5 justify-center">
                                {settlement.status === 'draft' && (
                                  <button
                                    onClick={() => handleConfirmSettlement(settlement)}
                                    disabled={confirmingReturnSettlement}
                                    className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {confirmingReturnSettlement ? '确认中...' : '确认'}
                                  </button>
                                )}
                                {settlement.status === 'confirmed' && (
                                  <button
                                    onClick={() => handleRevertSettlement(settlement)}
                                    className="px-2.5 py-1 text-xs font-medium bg-orange-50 text-orange-700 rounded-md hover:bg-orange-100 transition-colors border border-orange-200"
                                  >
                                    反确认
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================== 创建销退单弹窗 ==================== */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">新建销退单</h3>
                <button onClick={resetCreateForm} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateReturnOrder} className="space-y-4">
                {/* 客户搜索 */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">客户 *</label>
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCreateForm(prev => ({ ...prev, customer_id: 0, customer_name: '' }));
                      if (!showCustomerDropdown) setShowCustomerDropdown(true);
                    }}
                    onFocus={() => {
                      setShowCustomerDropdown(true);
                      if (customerResults.length === 0) searchCustomers(customerSearch.trim());
                    }}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                    placeholder="输入客户名称搜索或点击选择..."
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {createForm.customer_name && (
                    <div className="mt-1 text-sm text-green-600">已选择: {createForm.customer_name}</div>
                  )}
                  {showCustomerDropdown && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {customerSearchLoading ? (
                        <div className="p-3 text-center text-sm text-gray-400">搜索中...</div>
                      ) : customerResults.length > 0 ? (
                        customerResults.map(c => (
                          <div
                            key={c.id}
                            onClick={() => handleSelectCustomer(c)}
                            className="px-4 py-2 hover:bg-amber-50 cursor-pointer text-sm"
                          >
                            <span className="font-medium">{c.name}</span>
                            {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
                          </div>
                        ))
                      ) : (
                        <div className="p-3 text-center text-sm text-gray-400">
                          {customerSearch ? '未找到匹配客户' : '暂无客户数据'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 客户可退库存提示 */}
                {createForm.customer_id > 0 && (
                  <div className="text-xs">
                    {inventoryLoading ? (
                      <div className="flex items-center gap-1 text-gray-400">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        正在加载客户库存...
                      </div>
                    ) : customerInventory.length > 0 ? (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="font-medium text-blue-700 mb-1.5">客户可退库存</div>
                        <div className="flex flex-wrap gap-2">
                          {customerInventory.map((inv, i) => (
                            <span key={i} className="inline-flex items-center gap-1 bg-white px-2 py-1 rounded border border-blue-100 text-blue-600">
                              {inv.product_code && <span className="font-mono text-blue-500">{inv.product_code}</span>}
                              <span>{inv.product_name}</span>
                              <span className="font-semibold">{inv.available_weight}g</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : createForm.customer_id > 0 ? (
                      <div className="text-orange-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        该客户暂无已结算的购买记录，无法开具销退单
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 退货商品表格 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">退货商品 *</label>
                    <button
                      type="button"
                      onClick={addItem}
                      disabled={customerInventory.length === 0 && createForm.customer_id > 0}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3 h-3" />
                      添加商品
                    </button>
                  </div>
                  <div className="overflow-visible border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 w-44">商品（编码 + 品名）</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 w-28">克重(g)</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 w-24">工费(元/g)</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 w-16">件数</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 w-28">件工费(元/件)</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600 w-24">行合计</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {createItems.map((item, index) => {
                          const availableWeight = getAvailableForRow(index);
                          const weightExceeded = availableWeight !== null && (parseFloat(item.weight) || 0) > availableWeight + 0.001;
                          return (
                            <tr key={index}>
                              <td className="px-3 py-2">
                                {customerInventory.length > 0 ? (
                                  /* 从客户库存中选择商品 */
                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setInventoryDropdownPos({ top: rect.bottom + 2, left: rect.left });
                                        setInventoryDropdownIndex(inventoryDropdownIndex === index ? null : index);
                                      }}
                                      className={`w-full px-2 py-1 border rounded text-sm text-left truncate ${item.product_name
                                          ? 'border-gray-200 text-gray-900'
                                          : 'border-dashed border-gray-300 text-gray-400'
                                        } focus:ring-1 focus:ring-amber-500 focus:outline-none`}
                                    >
                                      {item.product_name ? (
                                        <span>
                                          {item.product_code && <span className="font-mono text-amber-600 mr-1">{item.product_code}</span>}
                                          {item.product_name}
                                        </span>
                                      ) : '点击选择商品'}
                                    </button>
                                  </div>
                                ) : (
                                  /* 无库存时使用原来的手动输入 */
                                  <div className="flex gap-1">
                                    <input
                                      type="text"
                                      value={item.product_code}
                                      onChange={(e) => handleProductCodeChange(index, e.target.value)}
                                      onFocus={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setDropdownPos({ top: rect.bottom + 2, left: rect.left });
                                        if (item.product_code) searchCode(index, item.product_code);
                                      }}
                                      onBlur={() => setTimeout(() => { if (codeDropdownIndex === index) setCodeDropdownIndex(null); }, 200)}
                                      placeholder="编码"
                                      className="w-20 px-2 py-1 border border-gray-200 rounded text-sm font-mono focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                    />
                                    <input
                                      type="text"
                                      value={item.product_name}
                                      onChange={(e) => handleProductNameChange(index, e.target.value)}
                                      placeholder="品名"
                                      className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div>
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={item.weight}
                                    onChange={(e) => updateItem(index, 'weight', e.target.value)}
                                    placeholder="0.000"
                                    className={`w-full px-2 py-1 border rounded text-sm text-center focus:ring-1 focus:ring-amber-500 focus:outline-none ${weightExceeded ? 'border-red-400 bg-red-50' : 'border-gray-200'
                                      }`}
                                  />
                                  {availableWeight !== null && (
                                    <div className={`text-[10px] mt-0.5 text-center ${weightExceeded ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                                      可退: {availableWeight}g
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.labor_cost_per_gram}
                                  onChange={(e) => updateItem(index, 'labor_cost_per_gram', e.target.value)}
                                  placeholder="0.00"
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-center focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  step="1"
                                  value={item.quantity}
                                  onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                                  placeholder="1"
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-center focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.labor_cost_per_piece}
                                  onChange={(e) => updateItem(index, 'labor_cost_per_piece', e.target.value)}
                                  placeholder="0.00"
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-center focus:ring-1 focus:ring-amber-500 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-amber-600">
                                ¥{calcLineTotal(item).toFixed(2)}
                              </td>
                              <td className="px-3 py-2">
                                {createItems.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeItem(index)}
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 退回地点 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">退回地点 *</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="return_to"
                        value="展厅"
                        checked={createForm.return_to === '展厅'}
                        onChange={(e) => setCreateForm({ ...createForm, return_to: e.target.value })}
                        className="mr-2"
                      />
                      <span>展厅</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="return_to"
                        value="商品部"
                        checked={createForm.return_to === '商品部'}
                        onChange={(e) => setCreateForm({ ...createForm, return_to: e.target.value })}
                        className="mr-2"
                      />
                      <span>商品部</span>
                    </label>
                  </div>
                </div>

                {/* 退货原因 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">退货原因 *</label>
                  <select
                    value={createForm.return_reason}
                    onChange={(e) => setCreateForm({ ...createForm, return_reason: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="客户退货">客户退货</option>
                    <option value="质量问题">质量问题</option>
                    <option value="款式不符">款式不符</option>
                    <option value="尺寸不合">尺寸不合</option>
                    <option value="其他">其他</option>
                  </select>
                </div>

                {/* 业务员 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">业务员</label>
                  <select
                    value={createForm.salesperson}
                    onChange={(e) => setCreateForm({ ...createForm, salesperson: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">请选择业务员</option>
                    {salespersonList.map(sp => (
                      <option key={sp.id} value={sp.name}>{sp.name}</option>
                    ))}
                  </select>
                  {createForm.salesperson && (
                    <div className="mt-1 text-xs text-green-600">已选择: {createForm.salesperson}</div>
                  )}
                </div>

                {/* 备注 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={createForm.remark}
                    onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })}
                    rows={2}
                    placeholder="可选备注信息"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* 合计 */}
                <div className="bg-amber-50 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <span className="text-sm text-gray-600">总重量: </span>
                    <span className="font-bold text-gray-900">{calcTotalWeight().toFixed(3)}g</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">总工费: </span>
                    <span className="font-bold text-amber-600">¥{calcTotalLaborCost().toFixed(2)}</span>
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl hover:from-amber-600 hover:to-yellow-600 transition-all font-medium shadow-lg shadow-amber-200/50"
                  >
                    提交销退单
                  </button>
                </div>
              </form>

              {/* 商品编码下拉列表 - fixed定位绕过overflow裁剪 */}
              {codeDropdownIndex !== null && codeSearchResults.length > 0 && (
                <div
                  className="fixed z-[60] w-64 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                  style={{ top: dropdownPos.top, left: dropdownPos.left }}
                >
                  {codeSearchResults.map(pc => (
                    <div
                      key={pc.id}
                      onMouseDown={() => selectProductCode(codeDropdownIndex, pc)}
                      className="px-3 py-2 hover:bg-amber-50 cursor-pointer flex items-center justify-between text-sm"
                    >
                      <span className="font-mono text-amber-600">{pc.code}</span>
                      <span className="text-gray-600 ml-2 truncate">{pc.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 客户库存商品选择下拉列表 */}
              {inventoryDropdownIndex !== null && customerInventory.length > 0 && (
                <>
                  <div className="fixed inset-0 z-[59]" onClick={() => setInventoryDropdownIndex(null)} />
                  <div
                    className="fixed z-[60] w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto"
                    style={{ top: inventoryDropdownPos.top, left: inventoryDropdownPos.left }}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider bg-gray-50 border-b">
                      可退商品
                    </div>
                    {customerInventory.map((inv, i) => {
                      const used = getUsedWeight(inv.product_name, inventoryDropdownIndex);
                      const remaining = round3(inv.available_weight - used);
                      const alreadySelected = createItems[inventoryDropdownIndex]?.product_name === inv.product_name;
                      return (
                        <div
                          key={i}
                          onMouseDown={() => {
                            if (remaining > 0 || alreadySelected) {
                              selectInventoryItem(inventoryDropdownIndex, inv);
                            }
                          }}
                          className={`px-3 py-2 flex items-center justify-between text-sm border-b border-gray-50 last:border-0 ${remaining <= 0 && !alreadySelected
                              ? 'opacity-40 cursor-not-allowed bg-gray-50'
                              : 'hover:bg-amber-50 cursor-pointer'
                            } ${alreadySelected ? 'bg-amber-50' : ''}`}
                        >
                          <div className="flex items-center gap-1.5">
                            {inv.product_code && <span className="font-mono text-amber-600 text-xs">{inv.product_code}</span>}
                            <span className="text-gray-800">{inv.product_name}</span>
                          </div>
                          <span className={`text-xs font-medium ${remaining <= 0 && !alreadySelected ? 'text-red-400' : 'text-green-600'}`}>
                            {remaining > 0 ? `${remaining}g` : '已退完'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ==================== 详情弹窗 ==================== */}
        {showDetailModal && detailOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">销退单详情</h3>
                <button onClick={() => { setShowDetailModal(false); setDetailOrder(null); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 基本信息 */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">销退单号</span>
                  <span className="font-mono font-medium">{detailOrder.return_no}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">客户</span>
                  <span className="font-medium">{detailOrder.customer_name || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">退回地点</span>
                  <span>{returnToLabel(detailOrder.return_to)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">退货原因</span>
                  <span>{detailOrder.return_reason || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">业务员</span>
                  <span>{detailOrder.salesperson || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">状态</span>
                  <StatusBadge status={detailOrder.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">总重量</span>
                  <span className="font-medium">{(detailOrder.total_weight || 0).toFixed(3)}g</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">总工费</span>
                  <span className="font-medium text-amber-600">¥{(detailOrder.total_labor_cost || 0).toFixed(2)}</span>
                </div>
                {detailOrder.remark && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">备注</span>
                    <span className="text-sm">{detailOrder.remark}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">创建时间</span>
                  <span className="text-xs text-gray-500">
                    {detailOrder.created_at ? new Date(detailOrder.created_at).toLocaleString('zh-CN') : '-'}
                  </span>
                </div>
              </div>

              {/* 商品明细 */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">退货商品明细</h4>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">品名</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">克重(g)</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">工费(元/g)</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-600">件数</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">件工费(元/件)</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">行合计</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(Array.isArray(detailOrder.items) ? detailOrder.items : []).map((item, idx) => (
                        <tr key={item.id || idx}>
                          <td className="px-3 py-2">{item.product_name}</td>
                          <td className="px-3 py-2 text-right">{(item.weight || 0).toFixed(3)}</td>
                          <td className="px-3 py-2 text-right">{(item.labor_cost_per_gram || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">{item.quantity || 0}</td>
                          <td className="px-3 py-2 text-right">{(item.labor_cost_per_piece || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium text-amber-600">¥{(item.line_total || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 状态日志 */}
              {detailLogs.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">操作日志</h4>
                  <div className="space-y-2">
                    {detailLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium text-gray-800">
                            {log.action} - {log.operator}
                          </div>
                          <div className="text-xs text-gray-500">
                            {log.old_status && <span>{log.old_status} → </span>}{log.new_status}
                            {' · '}
                            {log.action_time ? new Date(log.action_time).toLocaleString('zh-CN') : '-'}
                          </div>
                          {log.remark && <div className="text-xs text-gray-400 mt-0.5">{log.remark}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 关闭按钮 */}
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => { setShowDetailModal(false); setDetailOrder(null); }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 创建销退结算弹窗 ==================== */}
        {showSettlementModal && selectedReturnForSettlement && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">创建销退结算单</h3>
                <button onClick={() => setShowSettlementModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 销退单信息（只读） */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">销退单号</span>
                  <span className="font-mono">{selectedReturnForSettlement.return_no}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">客户</span>
                  <span className="font-medium">{selectedReturnForSettlement.customer_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">退回地点</span>
                  <span>{returnToLabel(selectedReturnForSettlement.return_to)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">总克重</span>
                  <span className="font-medium">{(selectedReturnForSettlement.total_weight || 0).toFixed(3)}g</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">总工费</span>
                  <span className="font-medium text-amber-600">¥{(selectedReturnForSettlement.total_labor_cost || 0).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">退货原因</span>
                  <span>{selectedReturnForSettlement.return_reason || '-'}</span>
                </div>
              </div>

              <form onSubmit={handleCreateSettlement} className="space-y-4">
                {/* 退款方式 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">退款方式</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="payment_method"
                        value="cash_price"
                        checked={settlementForm.payment_method === 'cash_price'}
                        onChange={(e) => setSettlementForm({ ...settlementForm, payment_method: e.target.value })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <DollarSign className="w-4 h-4 mr-1 text-green-500" />
                        退价
                      </span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="payment_method"
                        value="physical_gold"
                        checked={settlementForm.payment_method === 'physical_gold'}
                        onChange={(e) => setSettlementForm({ ...settlementForm, payment_method: e.target.value })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <Package className="w-4 h-4 mr-1 text-yellow-500" />
                        退料
                      </span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="payment_method"
                        value="mixed"
                        checked={settlementForm.payment_method === 'mixed'}
                        onChange={(e) => setSettlementForm({ ...settlementForm, payment_method: e.target.value })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <DollarSign className="w-4 h-4 mr-1 text-purple-500" />
                        混合退款
                      </span>
                    </label>
                  </div>
                </div>

                {/* 退价：金价输入 */}
                {settlementForm.payment_method === 'cash_price' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">当日金价 (元/克)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={settlementForm.gold_price}
                      onChange={(e) => setSettlementForm({ ...settlementForm, gold_price: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="例如: 580.00"
                      required
                    />
                    {settlementForm.gold_price && (
                      <p className="mt-1 text-sm text-gray-500">
                        料费: ¥{(parseFloat(settlementForm.gold_price) * (selectedReturnForSettlement.total_weight || 0)).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}

                {/* 退料：无需金价 */}
                {settlementForm.payment_method === 'physical_gold' && (
                  <div className="bg-yellow-50 rounded-lg p-4 text-sm text-yellow-700">
                    <p>退料方式：仅退还工费，黄金按原重量 ({(selectedReturnForSettlement.total_weight || 0).toFixed(3)}g) 退还给客户。</p>
                  </div>
                )}

                {/* 混合退款 */}
                {settlementForm.payment_method === 'mixed' && (
                  <div className="space-y-4 bg-purple-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-purple-800">混合退款设置</h4>
                    <p className="text-xs text-purple-600">
                      总重量：{(selectedReturnForSettlement.total_weight || 0).toFixed(3)}克，请分配退料和退价部分的克重
                    </p>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">当日金价 (元/克)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={settlementForm.gold_price}
                        onChange={(e) => setSettlementForm({ ...settlementForm, gold_price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="例如: 580.00"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">退料克重</label>
                        <input
                          type="number"
                          step="0.001"
                          value={settlementForm.gold_payment_weight}
                          onChange={(e) => setSettlementForm({ ...settlementForm, gold_payment_weight: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                          placeholder="退还黄金克重"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">退价克重</label>
                        <input
                          type="number"
                          step="0.001"
                          value={settlementForm.cash_payment_weight}
                          onChange={(e) => setSettlementForm({ ...settlementForm, cash_payment_weight: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="现金退款克重"
                        />
                      </div>
                    </div>

                    {/* 克重合计提示 */}
                    {(() => {
                      const goldW = parseFloat(settlementForm.gold_payment_weight) || 0;
                      const cashW = parseFloat(settlementForm.cash_payment_weight) || 0;
                      const totalW = selectedReturnForSettlement.total_weight || 0;
                      const inputSum = goldW + cashW;
                      const diff = Math.abs(inputSum - totalW);
                      return (
                        <div className={`text-xs ${diff > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                          退料({goldW.toFixed(3)}) + 退价({cashW.toFixed(3)}) = {inputSum.toFixed(3)}克
                          {diff > 0.01 ? ` ≠ 总重量 ${totalW.toFixed(3)}克` : ` = 总重量 ✓`}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 计算金额展示 */}
                {(() => {
                  const { materialAmount, laborAmount, totalAmount, goldReturned } = calcSettlementAmounts();
                  return (
                    <div className="bg-amber-50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">料费</span>
                        <span className="font-medium">¥{materialAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">工费</span>
                        <span className="font-medium">¥{laborAmount.toFixed(2)}</span>
                      </div>
                      {goldReturned > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">退还黄金</span>
                          <span className="font-medium text-yellow-600">{goldReturned.toFixed(3)}g</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm border-t pt-2">
                        <span className="font-medium text-gray-800">退款总额</span>
                        <span className="font-bold text-amber-600 text-lg">¥{totalAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* 备注 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={settlementForm.remark}
                    onChange={(e) => setSettlementForm({ ...settlementForm, remark: e.target.value })}
                    rows={2}
                    placeholder="可选备注信息"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* 按钮 */}
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSettlementModal(false)}
                    className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl hover:from-amber-600 hover:to-yellow-600 transition-all font-medium shadow-lg shadow-amber-200/50"
                  >
                    提交结算单
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesReturnPage;
