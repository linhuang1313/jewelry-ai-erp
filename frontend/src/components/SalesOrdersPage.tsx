import React, { useState, useEffect } from 'react';
import { 
  Search, Calendar, Filter, Edit2, Eye, X, 
  ChevronDown, ChevronUp, Download, Printer, RefreshCw, RotateCcw,
  CheckCircle, XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// 销售单状态映射（支持新旧状态值）
const SALES_STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: '未确认', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  confirmed: { label: '已确认', bg: 'bg-blue-100', text: 'text-blue-700' },
  cancelled: { label: '已取消', bg: 'bg-gray-100', text: 'text-gray-700' },
  // 向后兼容旧状态值
  '待结算': { label: '待结算', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  '已结算': { label: '已结算', bg: 'bg-green-100', text: 'text-green-700' },
  '已取消': { label: '已取消', bg: 'bg-gray-100', text: 'text-gray-700' },
};

const getSalesStatusDisplay = (status: string) => {
  return SALES_STATUS_MAP[status] || { label: status, bg: 'bg-gray-100', text: 'text-gray-700' };
};

interface SalesDetail {
  id: number;
  product_name: string;
  weight: number;
  labor_cost: number;
  total_labor_cost: number;
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
}

export const SalesOrdersPage: React.FC<SalesOrdersPageProps> = ({ userRole = 'settlement', onClose }) => {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  
  // 筛选条件
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    customerName: '',
    orderNo: '',
    status: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  
  // 客户列表（用于下拉）
  const [customers, setCustomers] = useState<{id: number, name: string}[]>([]);

  // 加载客户列表
  const loadCustomers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/customers`);
      const data = await res.json();
      if (data.data?.customers) {
        setCustomers(data.data.customers);
      }
    } catch (error) {
      console.error('加载客户列表失败:', error);
    }
  };

  // 加载销售单列表
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.customerName) params.append('customer_name', filters.customerName);
      if (filters.orderNo) params.append('order_no', filters.orderNo);
      if (filters.status) params.append('status', filters.status);
      params.append('limit', '200');

      const res = await fetch(`${API_BASE_URL}/api/sales/orders?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setOrders(data.orders || []);
      } else {
        toast.error(data.message || '加载失败');
      }
    } catch (error) {
      console.error('加载销售单失败:', error);
      toast.error('加载销售单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    loadCustomers();
  }, []);

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

  // 展开/折叠明细
  const toggleExpand = (orderId: number) => {
    setExpandedOrderId(expandedOrderId === orderId ? null : orderId);
  };

  // 查看详情
  const viewDetail = (order: SalesOrder) => {
    setExpandedOrderId(order.id);
  };

  // 打印销售单
  const printOrder = (order: SalesOrder) => {
    window.open(`${API_BASE_URL}/api/sales/orders/${order.id}/download?format=html`, '_blank');
  };

  // 导出销售单
  const exportOrder = (order: SalesOrder) => {
    window.open(`${API_BASE_URL}/api/sales/orders/${order.id}/download?format=pdf`, '_blank');
  };

  // 编辑销售单
  const handleEdit = (order: SalesOrder) => {
    setEditingOrder(order);
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
        loadOrders(); // 刷新列表
      } else {
        toast.error(data.message || '销退失败');
      }
    } catch (error) {
      toast.error('销退操作失败');
    }
  };

  // 确认销售单
  const handleConfirmOrder = async (order: SalesOrder) => {
    if (!confirm(`确认销售单 ${order.order_no}？\n确认后将不可编辑。`)) {
      return;
    }
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
        loadOrders();
      } else {
        toast.error(data.detail || data.message || '确认失败');
      }
    } catch (error) {
      toast.error('确认操作失败');
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
        loadOrders();
      } else {
        toast.error(data.detail || data.message || '反确认失败');
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
      status: ''
    });
  };

  // 统计信息（兼容新旧状态值）
  const stats = {
    total: orders.length,
    draft: orders.filter(o => o.status === 'draft' || o.status === '待结算').length,
    confirmed: orders.filter(o => o.status === 'confirmed' || o.status === '已结算').length,
    cancelled: orders.filter(o => o.status === 'cancelled' || o.status === '已取消').length,
    totalWeight: orders.reduce((sum, o) => sum + (o.total_weight || 0), 0),
    totalAmount: orders.reduce((sum, o) => sum + (o.total_labor_cost || 0), 0)
  };

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
            onClick={loadOrders}
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
          <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* 日期范围 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">开始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">结束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            
            {/* 客户名称 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">客户名称</label>
              <input
                type="text"
                placeholder="输入客户名..."
                value={filters.customerName}
                onChange={(e) => setFilters({...filters, customerName: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            
            {/* 单据状态 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">单据状态</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              >
                <option value="">全部状态</option>
                <option value="draft">未确认</option>
                <option value="confirmed">已确认</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            
            {/* 销售单号 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">销售单号</label>
              <input
                type="text"
                placeholder="输入单号..."
                value={filters.orderNo}
                onChange={(e) => setFilters({...filters, orderNo: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>
            
            {/* 操作按钮 */}
            <div className="col-span-2 md:col-span-3 lg:col-span-5 flex gap-2 mt-2">
              <button
                onClick={loadOrders}
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
        <span className="text-blue-600">总重量 <strong>{stats.totalWeight.toFixed(2)}</strong> 克</span>
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
              <div key={order.id} className="hover:bg-gray-50">
                {/* 订单行 */}
                <div className="px-4 py-3 flex items-center gap-4">
                  {/* 展开按钮 */}
                  <button
                    onClick={() => toggleExpand(order.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    {expandedOrderId === order.id ? (
                      <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                  
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
                    <div className="text-sm font-medium">{order.total_weight?.toFixed(2) || '0.00'}</div>
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
                  
                  {/* 操作按钮 */}
                  <div className="flex-1 flex justify-end gap-1">
                    <button
                      onClick={() => viewDetail(order)}
                      className="p-2 hover:bg-blue-100 rounded-lg text-blue-600"
                      title="查看详情"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {/* 确认按钮 - 仅draft状态可用 */}
                    {(order.status === 'draft' || order.status === '待结算') && (
                      <>
                        <button
                          onClick={() => handleEdit(order)}
                          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleConfirmOrder(order)}
                          className="p-2 hover:bg-green-100 rounded-lg text-green-600"
                          title="确认"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {/* 反确认按钮 - 仅confirmed状态可用 */}
                    {(order.status === 'confirmed' || order.status === '已结算') && (
                      <button
                        onClick={() => handleUnconfirmOrder(order)}
                        className="p-2 hover:bg-yellow-100 rounded-lg text-yellow-600"
                        title="反确认"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {/* 销退按钮 - 仅柜台角色可见，且仅draft/待结算状态可用 */}
                    {userRole === 'counter' && (order.status === 'draft' || order.status === '待结算') && (
                      <button
                        onClick={() => handleSalesReturn(order)}
                        className="p-2 hover:bg-red-100 rounded-lg text-red-600"
                        title="销退（取消并退回库存）"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => printOrder(order)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
                      title="打印"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => exportOrder(order)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
                      title="导出"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {/* 展开的明细 */}
                {expandedOrderId === order.id && (
                  <div className="px-4 pb-4 pl-12 bg-orange-50/50">
                    <div className="text-xs text-gray-500 mb-2 font-medium">商品明细</div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="pb-2 font-medium">商品名称</th>
                          <th className="pb-2 font-medium text-right">重量(克)</th>
                          <th className="pb-2 font-medium text-right">工费单价</th>
                          <th className="pb-2 font-medium text-right">工费小计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.details?.map((detail, idx) => (
                          <tr key={detail.id || idx} className="border-b border-gray-100">
                            <td className="py-2">{detail.product_name}</td>
                            <td className="py-2 text-right">{detail.weight?.toFixed(2)}</td>
                            <td className="py-2 text-right">¥{detail.labor_cost?.toFixed(2)}</td>
                            <td className="py-2 text-right text-orange-600">¥{detail.total_labor_cost?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-medium">
                          <td className="pt-2">合计</td>
                          <td className="pt-2 text-right">{order.total_weight?.toFixed(2)} 克</td>
                          <td className="pt-2 text-right">-</td>
                          <td className="pt-2 text-right text-orange-600">¥{order.total_labor_cost?.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {order.remark && (
                      <div className="mt-2 text-sm text-gray-500">
                        <span className="font-medium">备注：</span>{order.remark}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editingOrder && (
        <EditSalesOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSuccess={() => {
            setEditingOrder(null);
            loadOrders();
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

const EditSalesOrderModal: React.FC<EditSalesOrderModalProps> = ({ order, onClose, onSuccess }) => {
  const [remark, setRemark] = useState(order.remark || '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark })
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
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">编辑销售单</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">销售单号</label>
            <input
              type="text"
              value={order.order_no}
              disabled
              className="w-full px-3 py-2 bg-gray-100 border rounded-lg text-gray-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客户</label>
            <input
              type="text"
              value={order.customer_name}
              disabled
              className="w-full px-3 py-2 bg-gray-100 border rounded-lg text-gray-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              rows={3}
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
