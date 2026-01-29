import React, { useState, useEffect } from 'react';
import { 
  Package, Search, Calendar, Filter, Edit2, Save, X, 
  ChevronDown, ChevronUp, Download, Printer, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface InboundDetail {
  id: number;
  product_code?: string;
  product_name: string;
  product_category?: string;
  weight: number;
  labor_cost: number;
  piece_count?: number;
  piece_labor_cost?: number;
  supplier: string;
  total_cost?: number;
  fineness?: string;
  craft?: string;
  style?: string;
}

interface InboundOrder {
  id: number;
  order_no: string;
  create_time: string;
  operator: string;
  status: string;
  item_count: number;
  total_weight: number;
  suppliers: string[];
  details: InboundDetail[];
}

interface InboundOrdersPageProps {
  userRole?: string;
}

export const InboundOrdersPage: React.FC<InboundOrdersPageProps> = ({ userRole = 'product' }) => {
  const [orders, setOrders] = useState<InboundOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editingDetails, setEditingDetails] = useState<InboundDetail[]>([]);
  
  // 筛选条件
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    supplier: '',
    orderNo: '',
    productName: '',
    productCode: '',
    weightMin: '',
    weightMax: '',
    laborCostMin: '',
    laborCostMax: '',
    totalCostMin: '',
    totalCostMax: '',
    operator: '',
    fineness: '',
    craft: '',
    style: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // 筛选选项（用于下拉框）
  const [filterOptions, setFilterOptions] = useState<{
    product_names: string[];
    product_codes: string[];
    suppliers: string[];
    fineness: string[];
    crafts: string[];
    styles: string[];
  }>({
    product_names: [],
    product_codes: [],
    suppliers: [],
    fineness: [],
    crafts: [],
    styles: []
  });

  // 加载筛选选项
  const loadFilterOptions = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/inbound-orders/filter-options`);
      const data = await res.json();
      if (data.success) {
        setFilterOptions(data.data);
      }
    } catch (error) {
      console.error('加载筛选选项失败:', error);
    }
  };

  // 加载入库单列表
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.supplier) params.append('supplier', filters.supplier);
      if (filters.orderNo) params.append('order_no', filters.orderNo);
      if (filters.productName) params.append('product_name', filters.productName);
      if (filters.productCode) params.append('product_code', filters.productCode);
      if (filters.weightMin) params.append('weight_min', filters.weightMin);
      if (filters.weightMax) params.append('weight_max', filters.weightMax);
      if (filters.laborCostMin) params.append('labor_cost_min', filters.laborCostMin);
      if (filters.laborCostMax) params.append('labor_cost_max', filters.laborCostMax);
      if (filters.totalCostMin) params.append('total_cost_min', filters.totalCostMin);
      if (filters.totalCostMax) params.append('total_cost_max', filters.totalCostMax);
      if (filters.operator) params.append('operator', filters.operator);
      if (filters.fineness) params.append('fineness', filters.fineness);
      if (filters.craft) params.append('craft', filters.craft);
      if (filters.style) params.append('style', filters.style);
      params.append('limit', '200');

      const res = await fetch(`${API_BASE_URL}/api/inbound-orders?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setOrders(data.data || []);
      } else {
        toast.error(data.error || '加载失败');
      }
    } catch (error) {
      console.error('加载入库单失败:', error);
      toast.error('加载入库单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    loadFilterOptions();
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

  // 开始编辑
  const startEdit = (order: InboundOrder) => {
    setEditingOrderId(order.id);
    setEditingDetails([...order.details]);
    setExpandedOrderId(order.id);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingOrderId(null);
    setEditingDetails([]);
  };

  // 保存编辑
  const saveEdit = async (orderId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/inbound-orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ details: editingDetails })
      });
      
      const data = await res.json();
      if (data.success) {
        toast.success('保存成功');
        setEditingOrderId(null);
        setEditingDetails([]);
        loadOrders();
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch (error) {
      toast.error('保存失败');
    }
  };

  // 更新编辑中的明细
  const updateEditingDetail = (detailId: number, field: string, value: any) => {
    setEditingDetails(prev => 
      prev.map(d => d.id === detailId ? { ...d, [field]: value } : d)
    );
  };

  // 打印/下载
  const handlePrint = (orderId: number) => {
    window.open(`${API_BASE_URL}/api/inbound-orders/${orderId}/download?format=html`, '_blank');
  };

  const handleDownload = (orderId: number) => {
    window.open(`${API_BASE_URL}/api/inbound-orders/${orderId}/download?format=pdf`, '_blank');
  };

  // 搜索
  const handleSearch = () => {
    loadOrders();
  };

  // 重置筛选
  const resetFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      supplier: '',
      orderNo: '',
      productName: '',
      productCode: '',
      weightMin: '',
      weightMax: '',
      laborCostMin: '',
      laborCostMax: '',
      totalCostMin: '',
      totalCostMax: '',
      operator: '',
      fineness: '',
      craft: '',
      style: ''
    });
  };

  // 导出Excel
  const handleExportExcel = () => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('date_start', filters.startDate);
    if (filters.endDate) params.append('date_end', filters.endDate);
    if (filters.supplier) params.append('supplier', filters.supplier);
    if (filters.productName) params.append('product', filters.productName);
    window.open(`${API_BASE_URL}/api/export/inbound-query?${params}`, '_blank');
  };

  // 检查是否有活动的筛选
  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-orange-100 rounded-xl">
            <Package className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">入库单据一览表</h1>
            <p className="text-sm text-gray-500">查看、搜索和修改入库单据</p>
          </div>
        </div>
        <button
          onClick={loadOrders}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
      </div>

      {/* 筛选条件 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Filter className="w-5 h-5 text-gray-500" />
            <span className="font-medium text-gray-700">高级查询</span>
            {hasActiveFilters && (
              <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded-full">
                已筛选
              </span>
            )}
          </div>
          {showFilters ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>
        
        {showFilters && (
          <div className="px-6 pb-4 border-t border-gray-100 pt-4">
            {/* 基础筛选 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">入库单号</label>
                <input
                  type="text"
                  value={filters.orderNo}
                  onChange={(e) => setFilters({ ...filters, orderNo: e.target.value })}
                  placeholder="输入入库单号"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">开始日期</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">结束日期</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">供应商</label>
                <input
                  type="text"
                  list="supplier-options"
                  value={filters.supplier}
                  onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}
                  placeholder="输入或选择供应商"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
                <datalist id="supplier-options">
                  {(filterOptions.suppliers || []).map((s, i) => (
                    <option key={i} value={s} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* 展开更多筛选按钮 */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="text-sm text-orange-600 hover:text-orange-700 mb-4 flex items-center space-x-1"
            >
              {showAdvancedFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>{showAdvancedFilters ? '收起高级筛选' : '展开高级筛选'}</span>
            </button>

            {/* 高级筛选 */}
            {showAdvancedFilters && (
              <div className="space-y-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">商品名称</label>
                    <input
                      type="text"
                      list="product-name-options"
                      value={filters.productName}
                      onChange={(e) => setFilters({ ...filters, productName: e.target.value })}
                      placeholder="输入或选择商品"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <datalist id="product-name-options">
                      {(filterOptions.product_names || []).map((p, i) => (
                        <option key={i} value={p} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">商品编码</label>
                    <input
                      type="text"
                      list="product-code-options"
                      value={filters.productCode}
                      onChange={(e) => setFilters({ ...filters, productCode: e.target.value })}
                      placeholder="输入或选择编码"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <datalist id="product-code-options">
                      {(filterOptions.product_codes || []).map((c, i) => (
                        <option key={i} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">操作员</label>
                    <input
                      type="text"
                      value={filters.operator}
                      onChange={(e) => setFilters({ ...filters, operator: e.target.value })}
                      placeholder="输入操作员"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* 成色/工艺/款式筛选 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">成色</label>
                    <input
                      type="text"
                      list="fineness-options"
                      value={filters.fineness}
                      onChange={(e) => setFilters({ ...filters, fineness: e.target.value })}
                      placeholder="输入或选择成色"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <datalist id="fineness-options">
                      {(filterOptions.fineness || []).map((f, i) => (
                        <option key={i} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">工艺</label>
                    <input
                      type="text"
                      list="craft-options"
                      value={filters.craft}
                      onChange={(e) => setFilters({ ...filters, craft: e.target.value })}
                      placeholder="输入或选择工艺"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <datalist id="craft-options">
                      {(filterOptions.crafts || []).map((c, i) => (
                        <option key={i} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">款式</label>
                    <input
                      type="text"
                      list="style-options"
                      value={filters.style}
                      onChange={(e) => setFilters({ ...filters, style: e.target.value })}
                      placeholder="输入或选择款式"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <datalist id="style-options">
                      {(filterOptions.styles || []).map((s, i) => (
                        <option key={i} value={s} />
                      ))}
                    </datalist>
                  </div>
                </div>
                
                {/* 数值范围筛选 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">重量范围（克）</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        value={filters.weightMin}
                        onChange={(e) => setFilters({ ...filters, weightMin: e.target.value })}
                        placeholder="最小"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <span className="text-gray-400">-</span>
                      <input
                        type="number"
                        value={filters.weightMax}
                        onChange={(e) => setFilters({ ...filters, weightMax: e.target.value })}
                        placeholder="最大"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">克工费范围（元/克）</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        value={filters.laborCostMin}
                        onChange={(e) => setFilters({ ...filters, laborCostMin: e.target.value })}
                        placeholder="最小"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <span className="text-gray-400">-</span>
                      <input
                        type="number"
                        value={filters.laborCostMax}
                        onChange={(e) => setFilters({ ...filters, laborCostMax: e.target.value })}
                        placeholder="最大"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">总成本范围（元）</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        value={filters.totalCostMin}
                        onChange={(e) => setFilters({ ...filters, totalCostMin: e.target.value })}
                        placeholder="最小"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <span className="text-gray-400">-</span>
                      <input
                        type="number"
                        value={filters.totalCostMax}
                        onChange={(e) => setFilters({ ...filters, totalCostMax: e.target.value })}
                        placeholder="最大"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-between items-center">
              <button
                onClick={handleExportExcel}
                disabled={orders.length === 0}
                className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                <span>导出Excel</span>
              </button>
              <div className="flex space-x-3">
                <button
                  onClick={resetFilters}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  重置
                </button>
                <button
                  onClick={handleSearch}
                  className="flex items-center space-x-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  <span>查询</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 入库单列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>暂无入库单据</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {orders.map((order) => (
              <div key={order.id} className="hover:bg-gray-50 transition-colors">
                {/* 入库单主信息 */}
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center space-x-6">
                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                    >
                      {expandedOrderId === order.id ? (
                        <ChevronUp className="w-5 h-5 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-500" />
                      )}
                    </button>
                    <div>
                      <div className="font-mono font-semibold text-gray-900">{order.order_no}</div>
                      <div className="text-sm text-gray-500">{formatDate(order.create_time)}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-8">
                    <div className="text-center">
                      <div className="text-sm text-gray-500">商品数</div>
                      <div className="font-semibold text-gray-900">{order.item_count}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-500">总重量</div>
                      <div className="font-semibold text-orange-600">{order.total_weight}克</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-500">供应商</div>
                      <div className="font-semibold text-gray-900 max-w-32 truncate">
                        {order.suppliers.join(', ') || '-'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-500">状态</div>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-sm rounded-full">
                        {order.status}
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {editingOrderId === order.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(order.id)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="保存"
                          >
                            <Save className="w-5 h-5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                            title="取消"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(order)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="编辑"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handlePrint(order.id)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="打印"
                          >
                            <Printer className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDownload(order.id)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="下载"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 明细展开 */}
                {expandedOrderId === order.id && (
                  <div className="bg-gray-50 px-6 py-4 border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="pb-2 font-medium">条码</th>
                          <th className="pb-2 font-medium">商品名称</th>
                          <th className="pb-2 font-medium">重量(克)</th>
                          <th className="pb-2 font-medium">克工费</th>
                          <th className="pb-2 font-medium">件数</th>
                          <th className="pb-2 font-medium">件工费</th>
                          <th className="pb-2 font-medium">供应商</th>
                          <th className="pb-2 font-medium">总成本</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(editingOrderId === order.id ? editingDetails : order.details).map((detail) => (
                          <tr key={detail.id}>
                            <td className="py-2">
                              <span className="font-mono text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                                {detail.product_code || '-'}
                              </span>
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="text"
                                  value={detail.product_name}
                                  onChange={(e) => updateEditingDetail(detail.id, 'product_name', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.product_name
                              )}
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={detail.weight}
                                  onChange={(e) => updateEditingDetail(detail.id, 'weight', e.target.value)}
                                  className="w-24 px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.weight
                              )}
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={detail.labor_cost}
                                  onChange={(e) => updateEditingDetail(detail.id, 'labor_cost', e.target.value)}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.labor_cost
                              )}
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="number"
                                  value={detail.piece_count || ''}
                                  onChange={(e) => updateEditingDetail(detail.id, 'piece_count', e.target.value)}
                                  className="w-16 px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.piece_count || '-'
                              )}
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={detail.piece_labor_cost || ''}
                                  onChange={(e) => updateEditingDetail(detail.id, 'piece_labor_cost', e.target.value)}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.piece_labor_cost || '-'
                              )}
                            </td>
                            <td className="py-2">
                              {editingOrderId === order.id ? (
                                <input
                                  type="text"
                                  value={detail.supplier || ''}
                                  onChange={(e) => updateEditingDetail(detail.id, 'supplier', e.target.value)}
                                  className="w-28 px-2 py-1 border border-gray-300 rounded"
                                />
                              ) : (
                                detail.supplier || '-'
                              )}
                            </td>
                            <td className="py-2 text-orange-600 font-medium">
                              {detail.total_cost?.toFixed(2) || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 统计信息 */}
      <div className="mt-4 text-sm text-gray-500 text-right">
        共 {orders.length} 条入库单据
      </div>
    </div>
  );
};

export default InboundOrdersPage;

