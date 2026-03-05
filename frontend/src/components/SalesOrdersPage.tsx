import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search, Calendar, Filter, Edit2, Eye, X, ArrowLeft,
  ChevronDown, ChevronUp, Download, Printer, RefreshCw, RotateCcw,
  CheckCircle, XCircle, FileText, User, Package, Scale,
  Plus, Trash2, UserCheck
} from 'lucide-react';
import toast from 'react-hot-toast';

import { fetchWithCacheJson } from '../utils/fetchCache';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// 销售单状态映射（支持新旧状态值）
const SALES_STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: '未确认', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  confirmed: { label: '已确认', bg: 'bg-blue-100', text: 'text-blue-700' },
  '待结算': { label: '待结算', bg: 'bg-orange-100', text: 'text-orange-700' },
  '已结算': { label: '已结算', bg: 'bg-green-100', text: 'text-green-700' },
  cancelled: { label: '已取消', bg: 'bg-gray-100', text: 'text-gray-700' },
  '已取消': { label: '已取消', bg: 'bg-gray-100', text: 'text-gray-700' },
};

const getSalesStatusDisplay = (status: string) => {
  return SALES_STATUS_MAP[status] || { label: status, bg: 'bg-gray-100', text: 'text-gray-700' };
};

interface SalesDetail {
  id: number;
  product_code?: string;
  product_name: string;
  weight: number;
  labor_cost: number;
  piece_count: number;
  piece_labor_cost: number;
  total_labor_cost: number;
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
}

interface SalesOrder {
  id: number;
  order_no: string;
  order_date: string;
  customer_name: string;
  customer_id: number;
  salesperson: string;
  total_weight: number;
  total_labor_cost: number;
  status: string;
  remark: string;
  details: SalesDetail[];
}

interface SalesOrdersPageProps {
  userRole?: string;
  onClose?: () => void;
  editOrderId?: number;
}

export const SalesOrdersPage: React.FC<SalesOrdersPageProps> = ({ userRole = 'settlement', onClose, editOrderId }) => {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [confirmingOrder, setConfirmingOrder] = useState(false);

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const pageSize = 20;

  // 服务端统计
  const [serverStats, setServerStats] = useState({
    draft_count: 0, confirmed_count: 0, cancelled_count: 0,
    sum_weight: 0, sum_labor: 0
  });

  // 筛选条件
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    customerName: '',
    orderNo: '',
    status: '',
    minWeight: '',
    maxWeight: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // 客户列表（用于下拉）
  const [customers, setCustomers] = useState<{ id: number, name: string }[]>([]);

  // 加载客户列表
  const loadCustomers = async () => {
    try {
      const processData = (data: any) => {
        if (data.data?.customers) {
          setCustomers(data.data.customers);
        }
      };

      const data = await fetchWithCacheJson(`${API_BASE_URL}/api/customers?page_size=9999`, {}, processData);
      processData(data);
    } catch (error) {
      console.error('加载客户列表失败:', error);
    }
  };

  // 加载销售单列表
  const loadOrders = async (page = currentPage) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.customerName) params.append('customer_name', filters.customerName);
      if (filters.orderNo) params.append('order_no', filters.orderNo);
      if (filters.status) params.append('status', filters.status);
      if (filters.minWeight) params.append('min_weight', filters.minWeight);
      if (filters.maxWeight) params.append('max_weight', filters.maxWeight);
      params.append('page', String(page));
      params.append('page_size', String(pageSize));

      const processData = (data: any) => {
        if (data.success) {
          const d = data.data || {};
          setOrders(d.orders || []);
          setTotalOrders(d.total || 0);
          setTotalPages(d.total_pages || 0);
          setCurrentPage(d.page || page);
          setServerStats({
            draft_count: d.draft_count || 0,
            confirmed_count: d.confirmed_count || 0,
            cancelled_count: d.cancelled_count || 0,
            sum_weight: d.sum_weight || 0,
            sum_labor: d.sum_labor || 0,
          });
        }
      };

      const data = await fetchWithCacheJson(`${API_BASE_URL}/api/sales/orders?${params}`, {}, (cachedData) => {
        processData(cachedData);
        setLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载销售单失败:', error);
      toast.error('加载销售单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(1);
    loadCustomers();
  }, []);

  // 客户下拉选项
  const customerOptions = useMemo(() =>
    customers.map(c => ({ value: c.name, label: c.name })),
    [customers]
  );

  // 筛选栏搜索下拉选择组件
  const FilterSearchSelect = ({ options, value, onChange, placeholder, className = '' }: {
    options: { value: string; label: string; sub?: string }[];
    value: string;
    onChange: (val: string) => void;
    placeholder: string;
    className?: string;
  }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
      if (open) { setSearch(''); inputRef.current?.focus(); }
    }, [open]);

    const filtered = useMemo(() => {
      if (!search.trim()) return options;
      const kw = search.toLowerCase();
      return options.filter(o =>
        o.label.toLowerCase().includes(kw) ||
        (o.sub || '').toLowerCase().includes(kw)
      );
    }, [options, search]);

    const selectedLabel = value
      ? (options.find(o => o.value === value)?.label || value)
      : '';

    return (
      <div ref={containerRef} className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center gap-1 px-3 py-2 text-sm border rounded-lg bg-white text-left transition-all
            ${open ? 'ring-2 ring-orange-200 border-orange-300' : 'border-gray-200 hover:border-gray-300'}
            ${value ? 'text-gray-800' : 'text-gray-400'}`}
        >
          <span className="truncate flex-1">{selectedLabel || placeholder}</span>
          {value ? (
            <span
              onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
              className="text-gray-400 hover:text-gray-600 shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </span>
          ) : (
            <svg className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          )}
        </button>

        {open && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[220px]">
            <div className="p-1.5 border-b border-gray-100">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="输入搜索..."
                className="w-full px-2.5 py-1 text-sm border border-gray-100 rounded bg-gray-50 focus:outline-none focus:bg-white focus:border-orange-300"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-orange-50 transition-colors ${!value ? 'text-orange-600 bg-orange-50/50 font-medium' : 'text-gray-500'
                  }`}
              >
                全部（不筛选）
              </button>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-400">无匹配客户</div>
              ) : (
                filtered.slice(0, 200).map(o => (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-orange-50 transition-colors flex items-center justify-between gap-2 ${value === o.value ? 'text-orange-600 bg-orange-50/50 font-medium' : 'text-gray-700'
                      }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.sub && <span className="text-[11px] text-gray-400 shrink-0">{o.sub}</span>}
                  </button>
                ))
              )}
              {filtered.length > 200 && (
                <div className="px-3 py-2 text-center text-xs text-gray-400">
                  还有 {filtered.length - 200} 项，请输入关键词筛选...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 如果有 editOrderId，直接加载该订单进行编辑（不显示列表）
  useEffect(() => {
    if (editOrderId) {
      // 直接从 API 获取单个订单
      const fetchSingleOrder = async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/sales/orders?order_id=${editOrderId}&limit=1`);
          const data = await res.json();
          const ordersList = data.data?.orders || data.orders;
          if (data.success && ordersList?.length > 0) {
            setEditingOrder(ordersList[0]);
          } else {
            // 尝试从列表中找
            const orderToEdit = orders.find(o => o.id === editOrderId);
            if (orderToEdit) {
              setEditingOrder(orderToEdit);
            }
          }
        } catch (error) {
          console.error('加载订单失败:', error);
          const orderToEdit = orders.find(o => o.id === editOrderId);
          if (orderToEdit) {
            setEditingOrder(orderToEdit);
          }
        }
      };
      fetchSingleOrder();
    }
  }, [editOrderId, orders]);

  // 如果是编辑模式且用户关闭编辑弹窗，直接关闭整个页面
  const handleEditClose = () => {
    setEditingOrder(null);
    if (editOrderId && onClose) {
      onClose(); // 编辑模式下关闭弹窗等于关闭页面
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 打印销售单
  const printOrder = (order: SalesOrder) => {
    window.open(`${API_BASE_URL}/api/sales/orders/${order.id}/download?format=html`, '_blank');
  };

  // 下载销售单（Excel）
  const exportOrder = (order: SalesOrder) => {
    window.open(`${API_BASE_URL}/api/sales/orders/${order.id}/download?format=excel`, '_blank');
  };

  // 编辑销售单
  const handleEdit = (order: SalesOrder) => {
    setEditingOrder(order);
  };

  // 删除销售单（仅draft状态）
  const handleDeleteOrder = async (order: SalesOrder) => {
    if (!confirm(`确认删除销售单 ${order.order_no}？\n删除后不可恢复！`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '删除成功');
        setSelectedOrder(null);
        loadOrders(currentPage);
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (err) {
      toast.error('删除失败，请重试');
    }
  };

  // 销退销售单（取消并回滚库存）
  const handleSalesReturn = async (order: SalesOrder) => {
    if (order.status !== 'draft' && order.status !== '待结算') {
      toast.error('只有未确认状态的销售单可以销退');
      return;
    }

    if (!confirm(`确认销退销售单 ${order.order_no}？\n商品将退回库存，此操作不可撤销！`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}/cancel`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '销退成功');
        setSelectedOrder(null);
        loadOrders(currentPage);
      } else {
        toast.error(data.message || '销退失败');
      }
    } catch (error) {
      toast.error('销退操作失败');
    }
  };

  // 确认销售单
  const handleConfirmOrder = async (order: SalesOrder) => {
    if (confirmingOrder) return;
    if (!confirm(`确认销售单 ${order.order_no}？\n确认后将不可编辑。`)) {
      return;
    }
    setConfirmingOrder(true);
    try {
      const params = new URLSearchParams({
        confirmed_by: userRole === 'counter' ? '柜台' : '管理员',
        user_role: userRole || 'counter'
      });
      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}/confirm?${params}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        toast.success(data.message || '销售单已确认');
        // 更新当前选中的订单状态
        if (selectedOrder?.id === order.id) {
          setSelectedOrder({ ...order, status: '待结算' });
        }
        loadOrders(currentPage);
      } else {
        toast.error(data.detail || data.message || '确认失败');
      }
    } catch (error) {
      toast.error('确认操作失败');
    } finally {
      setConfirmingOrder(false);
    }
  };

  // 反确认销售单
  const handleUnconfirmOrder = async (order: SalesOrder) => {
    if (!confirm(`反确认销售单 ${order.order_no}？\n将恢复为未确认状态，可重新编辑。`)) {
      return;
    }
    try {
      const params = new URLSearchParams({
        operated_by: userRole === 'counter' ? '柜台' : '管理员',
        user_role: userRole || 'counter'
      });
      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}/unconfirm?${params}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        toast.success(data.message || '销售单已反确认');
        if (selectedOrder?.id === order.id) {
          setSelectedOrder({ ...order, status: 'draft' });
        }
        loadOrders(currentPage);
      } else {
        toast.error(data.message || data.detail || '反确认失败', { duration: 6000 });
      }
    } catch (error) {
      toast.error('反确认操作失败');
    }
  };

  // 重置筛选
  const resetFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      customerName: '',
      orderNo: '',
      status: '',
      minWeight: '',
      maxWeight: ''
    });
    setCurrentPage(1);
    setTimeout(() => loadOrders(1), 0);
  };

  // 统计信息（使用服务端聚合数据，覆盖全部筛选结果而非仅当前页）
  const stats = {
    total: totalOrders,
    draft: serverStats.draft_count,
    confirmed: serverStats.confirmed_count,
    cancelled: serverStats.cancelled_count,
    totalWeight: serverStats.sum_weight,
    totalAmount: serverStats.sum_labor
  };

  // ==================== 编辑模式（仅显示编辑弹窗）====================
  if (editOrderId && editingOrder) {
    return (
      <EditSalesOrderModal
        order={editingOrder}
        onClose={handleEditClose}
        onSuccess={() => {
          if (onClose) onClose();
        }}
      />
    );
  }

  // ==================== 详情视图 ====================
  if (selectedOrder) {
    const order = selectedOrder;
    const statusInfo = getSalesStatusDisplay(order.status);
    const isDraft = order.status === 'draft';
    const isConfirmed = order.status === 'confirmed' || order.status === '待结算';
    const isSettled = order.status === '已结算';

    return (
      <div className="min-h-screen bg-gray-50">
        {/* 顶部导航栏 */}
        <div className="bg-white border-b shadow-sm">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedOrder(null)}
                className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm font-medium">返回列表</span>
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <h2 className="text-lg font-bold text-gray-800">销售单详情</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => printOrder(order)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Printer className="w-4 h-4" />
                打印
              </button>
              <button
                onClick={() => exportOrder(order)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                下载
              </button>
              {isDraft && (
                <>
                  <button
                    onClick={() => handleEdit(order)}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    编辑
                  </button>
                  <button
                    onClick={() => handleConfirmOrder(order)}
                    disabled={confirmingOrder}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {confirmingOrder ? '确认中...' : '确认'}
                  </button>
                </>
              )}
              {isSettled && (
                <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                  已结算，需先对结算单反确认并撤单后方可反确认销售单
                </div>
              )}
              {isConfirmed && (
                <button
                  onClick={() => handleUnconfirmOrder(order)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  反确认
                </button>
              )}
              {userRole === 'counter' && isDraft && (
                <button
                  onClick={() => handleSalesReturn(order)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  销退
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 详情内容 */}
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
          {/* 基本信息卡片 */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange-500" />
                基本信息
              </h3>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                {statusInfo.label}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-5 gap-x-8">
              <div>
                <div className="text-xs text-gray-400 mb-1">销售单号</div>
                <div className="text-sm font-semibold text-orange-600">{order.order_no}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">开单日期</div>
                <div className="text-sm font-medium text-gray-800">{formatDate(order.order_date)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">客户</div>
                <div className="text-sm font-medium text-gray-800 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  {order.customer_name || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">业务员</div>
                <div className="text-sm font-medium text-gray-800">{order.salesperson || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">总重量</div>
                <div className="text-sm font-semibold text-gray-800 flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5 text-gray-400" />
                  {order.total_weight?.toFixed(3) || '0.000'} 克
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">总工费</div>
                <div className="text-sm font-semibold text-orange-600">¥{order.total_labor_cost?.toFixed(2) || '0.00'}</div>
              </div>
              {order.remark && (
                <div className="col-span-2 md:col-span-3">
                  <div className="text-xs text-gray-400 mb-1">备注</div>
                  <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{order.remark}</div>
                </div>
              )}
            </div>
          </div>

          {/* 商品明细表格 */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
              <Package className="w-5 h-5 text-orange-500" />
              商品明细
              <span className="text-xs font-normal text-gray-400 ml-1">共 {order.details?.length || 0} 件</span>
            </h3>
            {(() => {
              const hasFCode = order.details?.some(d => d.product_code?.startsWith('F'));
              const baseCols = 6;
              const extraCols = hasFCode ? 10 : 0;
              const totalCols = baseCols + extraCols;
              return (
                <div className="overflow-x-auto">
                  <table className={`${hasFCode ? 'min-w-max' : 'w-full'} text-sm`}>
                    <thead>
                      <tr className="bg-orange-50 text-gray-600">
                        <th className="px-4 py-3 text-left font-medium rounded-tl-lg" style={{ width: '50px' }}>序号</th>
                        <th className="px-4 py-3 text-left font-medium whitespace-nowrap">商品编码</th>
                        <th className="px-4 py-3 text-left font-medium">商品名称</th>
                        <th className="px-4 py-3 text-right font-medium">重量(克)</th>
                        <th className="px-4 py-3 text-right font-medium">工费单价</th>
                        <th className={`px-4 py-3 text-right font-medium ${hasFCode ? '' : 'rounded-tr-lg'}`}>工费小计(元)</th>
                        {hasFCode && (
                          <>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">主石重</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">主石粒数</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">副石重</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">副石粒数</th>
                            <th className="px-4 py-3 text-center font-medium whitespace-nowrap">主石字印</th>
                            <th className="px-4 py-3 text-center font-medium whitespace-nowrap">副石字印</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">珍珠重</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">轴承重</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap">销售克工费</th>
                            <th className="px-4 py-3 text-right font-medium whitespace-nowrap rounded-tr-lg">销售件工费</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {order.details?.map((detail, idx) => (
                        <tr key={detail.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                              {detail.product_code || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-800">{detail.product_name}</td>
                          <td className="px-4 py-3 text-right">{detail.weight?.toFixed(3)}</td>
                          <td className="px-4 py-3 text-right">
                            {detail.piece_count > 0 && detail.piece_labor_cost > 0
                              ? <span>¥{detail.piece_labor_cost?.toFixed(2)}/件 × {detail.piece_count}件</span>
                              : <span>¥{detail.labor_cost?.toFixed(2)}/克</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-orange-600">¥{detail.total_labor_cost?.toFixed(2)}</td>
                          {hasFCode && (
                            <>
                              <td className="px-4 py-3 text-right">{detail.main_stone_weight ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.main_stone_count ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.sub_stone_weight ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.sub_stone_count ?? '-'}</td>
                              <td className="px-4 py-3 text-center">{detail.main_stone_mark || '-'}</td>
                              <td className="px-4 py-3 text-center">{detail.sub_stone_mark || '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.pearl_weight ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.bearing_weight ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.sale_labor_cost ?? '-'}</td>
                              <td className="px-4 py-3 text-right">{detail.sale_piece_labor_cost ?? '-'}</td>
                            </>
                          )}
                        </tr>
                      ))}
                      {(!order.details || order.details.length === 0) && (
                        <tr>
                          <td colSpan={totalCols} className="px-4 py-8 text-center text-gray-400">暂无商品明细</td>
                        </tr>
                      )}
                    </tbody>
                    {order.details && order.details.length > 0 && (
                      <tfoot>
                        <tr className="bg-orange-50/70 font-semibold">
                          <td className="px-4 py-3 rounded-bl-lg" colSpan={3}>合计</td>
                          <td className="px-4 py-3 text-right">{order.total_weight?.toFixed(3)} 克</td>
                          <td className="px-4 py-3 text-right">-</td>
                          <td className={`px-4 py-3 text-right text-orange-600 ${hasFCode ? '' : 'rounded-br-lg'}`}>¥{order.total_labor_cost?.toFixed(2)}</td>
                          {hasFCode && <td colSpan={10} className="px-4 py-3 rounded-br-lg"></td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}
          </div>
        </div>

        {/* 编辑弹窗 */}
        {editingOrder && (
          <EditSalesOrderModal
            order={editingOrder}
            onClose={() => setEditingOrder(null)}
            onSuccess={() => {
              setEditingOrder(null);
              loadOrders(currentPage);
            }}
          />
        )}
      </div>
    );
  }

  // ==================== 列表视图 ====================
  return (
    <div className="bg-white rounded-xl shadow-lg max-w-6xl w-full mx-auto max-h-[90vh] overflow-hidden flex flex-col">
      {/* 头部 */}
      <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-orange-50 to-amber-50">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-2xl">📋</span>
            销售单据一览表
          </h2>
          <p className="text-sm text-gray-500 mt-1">查看、搜索、编辑销售单据</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadOrders(currentPage)}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* 高级查询 */}
      <div className="border-b">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Filter className="w-4 h-4" />
            高级查询
          </span>
          {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showFilters && (
          <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">开始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">结束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">客户名称</label>
              <FilterSearchSelect
                options={customerOptions}
                value={filters.customerName}
                onChange={(val) => setFilters({ ...filters, customerName: val })}
                placeholder="选择客户..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">单据状态</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              >
                <option value="">全部状态</option>
                <option value="draft">未确认</option>
                <option value="待结算">待结算</option>
                <option value="已结算">已结算</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">销售单号</label>
              <input
                type="text"
                placeholder="输入单号..."
                value={filters.orderNo}
                onChange={(e) => setFilters({ ...filters, orderNo: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">克重范围(g)</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.001"
                  placeholder="最小"
                  value={filters.minWeight}
                  onChange={(e) => setFilters({ ...filters, minWeight: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  step="0.001"
                  placeholder="最大"
                  value={filters.maxWeight}
                  onChange={(e) => setFilters({ ...filters, maxWeight: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="col-span-2 md:col-span-3 lg:col-span-6 flex gap-2 mt-2">
              <button
                onClick={() => { setCurrentPage(1); loadOrders(1); }}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 flex items-center gap-1"
              >
                <Search className="w-4 h-4" />
                搜索
              </button>
              <button
                onClick={resetFilters}
                className="px-4 py-2 border text-gray-600 rounded-lg text-sm hover:bg-gray-50"
              >
                重置
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 统计栏 */}
      <div className="px-4 py-3 bg-gray-50 border-b flex flex-wrap gap-4 text-sm">
        <span className="text-gray-600">共 <strong className="text-gray-900">{stats.total}</strong> 单</span>
        <span className="text-yellow-600">未确认 <strong>{stats.draft}</strong> 单</span>
        <span className="text-blue-600">已确认 <strong>{stats.confirmed}</strong> 单</span>
        <span className="text-gray-500">已取消 <strong>{stats.cancelled}</strong> 单</span>
        <span className="text-blue-600">总重量 <strong>{stats.totalWeight.toFixed(3)}</strong> 克</span>
        <span className="text-orange-600">总工费 <strong>¥{stats.totalAmount.toFixed(2)}</strong></span>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Search className="w-12 h-12 mb-3 opacity-50" />
            <p>暂无销售单据</p>
            <p className="text-sm mt-1">尝试调整筛选条件</p>
          </div>
        ) : (
          <div className="divide-y">
            {orders.map((order) => (
              <div
                key={order.id}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="px-4 py-3 flex items-center gap-4">
                  {/* 单号和时间 */}
                  <div className="min-w-[180px]">
                    <div className="font-medium text-orange-600">{order.order_no}</div>
                    <div className="text-xs text-gray-400">{formatDate(order.order_date)}</div>
                  </div>

                  {/* 客户 */}
                  <div className="min-w-[100px]">
                    <div className="text-sm font-medium text-gray-800">{order.customer_name || '-'}</div>
                    <div className="text-xs text-gray-400">客户</div>
                  </div>

                  {/* 商品数 */}
                  <div className="min-w-[60px] text-center">
                    <div className="text-sm font-medium">{order.details?.length || 0}</div>
                    <div className="text-xs text-gray-400">商品数</div>
                  </div>

                  {/* 总重量 */}
                  <div className="min-w-[80px] text-center">
                    <div className="text-sm font-medium">{order.total_weight?.toFixed(3) || '0.000'}</div>
                    <div className="text-xs text-gray-400">克重</div>
                  </div>

                  {/* 总金额 */}
                  <div className="min-w-[100px] text-center">
                    <div className="text-sm font-medium text-orange-600">¥{order.total_labor_cost?.toFixed(2) || '0.00'}</div>
                    <div className="text-xs text-gray-400">总工费</div>
                  </div>

                  {/* 状态 */}
                  <div className="min-w-[80px]">
                    {(() => {
                      const statusInfo = getSalesStatusDisplay(order.status);
                      return (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                          {statusInfo.label}
                        </span>
                      );
                    })()}
                  </div>

                  {/* 备注 */}
                  <div className="min-w-[80px] max-w-[120px] flex-1">
                    <div className="text-xs text-gray-400 mb-0.5">备注</div>
                    <div className="text-sm text-gray-700 truncate" title={order.remark || ''}>
                      {order.remark || '-'}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex-1 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {/* 编辑按钮 - 仅draft状态可用 */}
                    {order.status === 'draft' && (
                      <button
                        onClick={() => handleEdit(order)}
                        className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors border border-blue-200"
                      >
                        编辑
                      </button>
                    )}
                    {/* 删除按钮 - 仅draft状态可用 */}
                    {order.status === 'draft' && (
                      <button
                        onClick={() => handleDeleteOrder(order)}
                        className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-0.5" />
                        删除
                      </button>
                    )}
                    {/* 确认按钮 - 仅draft状态可用 */}
                    {order.status === 'draft' && (
                      <button
                        onClick={() => handleConfirmOrder(order)}
                        disabled={confirmingOrder}
                        className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {confirmingOrder ? '确认中...' : '确认'}
                      </button>
                    )}
                    {/* 已结算提示 - 不可直接反确认 */}
                    {order.status === '已结算' && (
                      <span className="px-2.5 py-1 text-xs text-amber-600 bg-amber-50 rounded-md border border-amber-200" title="需先对结算单反确认并撤单">
                        已结算
                      </span>
                    )}
                    {/* 反确认按钮 - 仅待结算状态可用 */}
                    {(order.status === 'confirmed' || order.status === '待结算') && (
                      <button
                        onClick={() => handleUnconfirmOrder(order)}
                        className="px-2.5 py-1 text-xs font-medium bg-yellow-50 text-yellow-700 rounded-md hover:bg-yellow-100 transition-colors border border-yellow-200"
                      >
                        反确认
                      </button>
                    )}
                    <button
                      onClick={() => printOrder(order)}
                      className="px-2.5 py-1 text-xs font-medium bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors border border-gray-200"
                    >
                      打印
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="px-4 py-3 flex items-center justify-between border-t bg-gray-50/50">
          <span className="text-sm text-gray-500">
            共 {totalOrders} 条，第 {currentPage}/{totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setCurrentPage(1); loadOrders(1); }}
              disabled={currentPage <= 1}
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >首页</button>
            <button
              onClick={() => { const p = currentPage - 1; setCurrentPage(p); loadOrders(p); }}
              disabled={currentPage <= 1}
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >上一页</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => { setCurrentPage(pageNum); loadOrders(pageNum); }}
                  className={`px-2.5 py-1 text-xs rounded border ${pageNum === currentPage
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white hover:bg-gray-50'
                    }`}
                >{pageNum}</button>
              );
            })}
            <button
              onClick={() => { const p = currentPage + 1; setCurrentPage(p); loadOrders(p); }}
              disabled={currentPage >= totalPages}
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >下一页</button>
            <button
              onClick={() => { setCurrentPage(totalPages); loadOrders(totalPages); }}
              disabled={currentPage >= totalPages}
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >末页</button>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingOrder && (
        <EditSalesOrderModal
          order={editingOrder}
          onClose={handleEditClose}
          onSuccess={() => {
            if (editOrderId && onClose) {
              onClose(); // 编辑模式完成后关闭页面
            } else {
              setEditingOrder(null);
              loadOrders(currentPage);
            }
          }}
        />
      )}
    </div>
  );
};

// 编辑销售单弹窗
interface EditSalesOrderModalProps {
  order: SalesOrder;
  onClose: () => void;
  onSuccess: () => void;
}

interface EditOrderItem {
  id: string;
  product_code?: string;
  product_name: string;
  weight: string;
  labor_cost: string;
}

const EditSalesOrderModal: React.FC<EditSalesOrderModalProps> = ({ order, onClose, onSuccess }) => {
  const [customerSearch, setCustomerSearch] = useState(order.customer_name || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(order.customer_id || null);
  const [customers, setCustomers] = useState<{ id: number, name: string }[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [salespersons, setSalespersons] = useState<{ id: number, name: string }[]>([]);
  const [selectedSalesperson, setSelectedSalesperson] = useState(order.salesperson || '');
  const [items, setItems] = useState<EditOrderItem[]>(() => {
    if (order.details && order.details.length > 0) {
      return order.details.map((d, idx) => ({
        id: `existing-${idx}`,
        product_code: d.product_code || '',
        product_name: d.product_name || '',
        weight: d.weight?.toString() || '',
        labor_cost: d.labor_cost?.toString() || ''
      }));
    }
    return [{ id: '1', product_name: '', weight: '', labor_cost: '' }];
  });
  const [remark, setRemark] = useState(order.remark || '');
  const [loading, setLoading] = useState(false);

  // 商品编码列表及下拉
  const [productCodeList, setProductCodeList] = useState<{ id: number; code: string; name: string }[]>([]);
  const [productDropdownId, setProductDropdownId] = useState<string | null>(null);
  const [productSearchResults, setProductSearchResults] = useState<{ id: number; code: string; name: string }[]>([]);

  // 加载商品编码列表
  const fetchProductCodes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes?limit=1000`);
      if (response.ok) {
        const data = await response.json();
        const codeList = Array.isArray(data) ? data : (data.codes || []);
        setProductCodeList(codeList);
      }
    } catch (error) {
      console.error('获取商品编码列表失败:', error);
    }
  };

  // 商品名称搜索 - 输入时匹配编码表
  const handleProductNameInput = (itemId: string, value: string) => {
    setItems(items.map(item => item.id === itemId ? { ...item, product_name: value, product_code: '' } : item));
    if (value.trim()) {
      const keyword = value.trim().toLowerCase();
      const results = productCodeList.filter(
        pc => pc.name.toLowerCase().includes(keyword) || pc.code.toLowerCase().includes(keyword)
      ).slice(0, 10);
      setProductSearchResults(results);
      setProductDropdownId(results.length > 0 ? itemId : null);
    } else {
      setProductDropdownId(null);
      setProductSearchResults([]);
    }
  };

  // 选择商品编码
  const handleSelectProductCode = (itemId: string, pc: { code: string; name: string }) => {
    setItems(items.map(item => item.id === itemId ? { ...item, product_code: pc.code, product_name: pc.name } : item));
    setProductDropdownId(null);
    setProductSearchResults([]);
  };

  // 加载客户列表
  const fetchCustomers = async (search?: string) => {
    try {
      const params = new URLSearchParams({ page_size: '500' });
      if (search) params.append('search', search);
      const res = await fetch(`${API_BASE_URL}/api/customers?${params}`);
      const data = await res.json();
      if (data.data?.customers) {
        setCustomers(data.data.customers);
      }
    } catch (error) {
      console.error('加载客户列表失败:', error);
    }
  };

  // 加载业务员列表
  const fetchSalespersons = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/salespersons`);
      const data = await response.json();
      if (data.success) {
        setSalespersons(data.salespersons || []);
      }
    } catch (error) {
      console.error('获取业务员列表失败', error);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchSalespersons();
    fetchProductCodes();
  }, []);

  // 客户搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      if (customerSearch) {
        fetchCustomers(customerSearch);
      } else {
        fetchCustomers();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  // 选择客户
  const handleSelectCustomer = (customer: { id: number, name: string }) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
  };

  // 添加商品行
  const addItem = () => {
    setItems([...items, { id: Date.now().toString(), product_name: '', weight: '', labor_cost: '' }]);
  };

  // 删除商品行
  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  // 更新商品行
  const updateItem = (id: string, field: keyof EditOrderItem, value: string) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  // 计算汇总
  const totalWeight = items.reduce((sum, item) => sum + (parseFloat(item.weight) || 0), 0);
  const totalLaborCost = items.reduce((sum, item) => {
    const w = parseFloat(item.weight) || 0;
    const lc = parseFloat(item.labor_cost) || 0;
    return sum + w * lc;
  }, 0);

  const handleSave = async () => {
    // 验证
    const validItems = items.filter(item => item.product_name.trim());
    if (validItems.length === 0) {
      toast.error('请至少添加一个商品');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        salesperson: selectedSalesperson,
        remark,
        items: validItems.map(item => ({
          product_name: item.product_name,
          weight: parseFloat(item.weight) || 0,
          labor_cost: parseFloat(item.labor_cost) || 0
        }))
      };
      if (selectedCustomerId) {
        payload.customer_id = selectedCustomerId;
      }
      if (customerSearch) {
        payload.customer_name = customerSearch;
      }

      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        toast.success('保存成功');
        onSuccess();
      } else {
        toast.error(data.message || '保存失败');
      }
    } catch (error) {
      toast.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-800">编辑销售单</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          {/* 销售单号（不可编辑） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">销售单号</label>
            <input
              type="text"
              value={order.order_no}
              disabled
              className="w-full px-3 py-2 bg-gray-100 border rounded-lg text-gray-500"
            />
          </div>

          {/* 客户选择 */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              客户
            </label>
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setShowCustomerDropdown(true);
                setSelectedCustomerId(null);
              }}
              onFocus={() => setShowCustomerDropdown(true)}
              onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
              placeholder="搜索或输入客户名..."
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
            />
            {showCustomerDropdown && customers.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {customers
                  .filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                  .slice(0, 20)
                  .map(c => (
                    <div
                      key={c.id}
                      onMouseDown={() => handleSelectCustomer(c)}
                      className={`px-3 py-2 hover:bg-orange-50 cursor-pointer text-sm ${selectedCustomerId === c.id ? 'bg-orange-50 text-orange-700 font-medium' : ''
                        }`}
                    >
                      {c.name}
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          {/* 业务员 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <UserCheck className="w-4 h-4 inline mr-1" />
              业务员
            </label>
            <select
              value={selectedSalesperson}
              onChange={(e) => setSelectedSalesperson(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
            >
              <option value="">请选择业务员</option>
              {salespersons.map(sp => (
                <option key={sp.id} value={sp.name}>{sp.name}</option>
              ))}
            </select>
          </div>

          {/* 商品明细 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Package className="w-4 h-4 inline mr-1" />
              商品明细
            </label>

            <div className="space-y-2">
              {items.map((item, index) => {
                const w = parseFloat(item.weight) || 0;
                const lc = parseFloat(item.labor_cost) || 0;
                const subtotal = w * lc;
                return (
                  <div key={item.id} className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg">
                    <span className="text-sm text-gray-400 w-6 shrink-0">{index + 1}.</span>
                    {item.product_code && (
                      <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-mono rounded shrink-0" title="商品编码">
                        {item.product_code}
                      </span>
                    )}
                    <div className="relative flex-1 min-w-[120px]">
                      <input
                        type="text"
                        value={item.product_name}
                        onChange={(e) => handleProductNameInput(item.id, e.target.value)}
                        onFocus={() => {
                          if (item.product_name.trim()) {
                            const keyword = item.product_name.trim().toLowerCase();
                            const results = productCodeList.filter(
                              pc => pc.name.toLowerCase().includes(keyword) || pc.code.toLowerCase().includes(keyword)
                            ).slice(0, 10);
                            if (results.length > 0) {
                              setProductSearchResults(results);
                              setProductDropdownId(item.id);
                            }
                          }
                        }}
                        onBlur={() => setTimeout(() => setProductDropdownId(null), 200)}
                        placeholder="输入商品名称或编码搜索..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                      />
                      {productDropdownId === item.id && productSearchResults.length > 0 && (
                        <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {productSearchResults.map(pc => (
                            <div
                              key={pc.id}
                              onMouseDown={() => handleSelectProductCode(item.id, pc)}
                              className="px-3 py-2 hover:bg-amber-50 cursor-pointer text-sm flex items-center gap-2"
                            >
                              <span className="font-mono text-orange-600 text-xs bg-orange-50 px-1.5 py-0.5 rounded">{pc.code}</span>
                              <span>{pc.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.001"
                        value={item.weight}
                        onChange={(e) => updateItem(item.id, 'weight', e.target.value)}
                        placeholder="克重"
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm text-center"
                      />
                      <span className="text-xs text-gray-400 ml-1">克</span>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.01"
                        value={item.labor_cost}
                        onChange={(e) => updateItem(item.id, 'labor_cost', e.target.value)}
                        placeholder="工费单价"
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm text-center"
                      />
                      <span className="text-xs text-gray-400 ml-1">元</span>
                    </div>
                    <div className="text-sm text-gray-500 w-24 text-right shrink-0 font-mono">
                      {subtotal > 0 ? `¥${subtotal.toFixed(2)}` : '-'}
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 汇总 */}
            {totalWeight > 0 && (
              <div className="flex justify-end items-center gap-6 mt-2 pr-10 text-sm">
                <span className="text-gray-500">总重量: <strong className="text-gray-800">{totalWeight.toFixed(3)} 克</strong></span>
                <span className="text-gray-500">总工费: <strong className="text-orange-600 font-mono">¥{totalLaborCost.toFixed(2)}</strong></span>
              </div>
            )}

            <button
              onClick={addItem}
              className="mt-2 flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"
            >
              <Plus className="w-4 h-4" />
              <span>添加商品</span>
            </button>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              rows={2}
              placeholder="添加备注..."
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border text-gray-700 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300"
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SalesOrdersPage;
