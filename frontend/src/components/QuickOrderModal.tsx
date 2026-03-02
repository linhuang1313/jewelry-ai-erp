import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import {
  X, Plus, Trash2, Search, User, UserCheck, Package,
  CheckCircle, AlertCircle, Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Customer {
  id: number;
  name: string;
  customer_no: string;
}

interface Salesperson {
  id: number;
  name: string;
}

interface ProductCode {
  id: number;
  code: string;
  name: string;
}

interface OrderItem {
  id: string;
  product_code: string;
  product_name: string;
  weight: string;
  labor_cost: string;
  piece_count: string;
  piece_labor_cost: string;
}

interface InventoryItem {
  product_name: string;
  total_weight: number;
}

interface InventoryError {
  product_name: string;
  error: string;
  required_weight: number;
  available_weight: number;
  total_weight?: number;
  reserved_weight?: number;
}

interface OrderResultItem {
  product_name: string;
  weight: number;
  labor_cost: number;
  piece_count?: number;
  piece_labor_cost?: number;
}

interface FCodeDetail {
  product_code: string;
  product_name: string;
  weight: number | null;
  labor_cost: number | null;
  piece_count: number | null;
  piece_labor_cost: number | null;
  sale_labor_cost: number | null;
  sale_piece_labor_cost: number | null;
  supplier: string | null;
  main_stone_weight: number | null;
  main_stone_count: number | null;
  main_stone_price: number | null;
  main_stone_amount: number | null;
  sub_stone_weight: number | null;
  sub_stone_count: number | null;
  sub_stone_price: number | null;
  sub_stone_amount: number | null;
  stone_setting_fee: number | null;
  total_amount: number | null;
  main_stone_mark: string | null;
  sub_stone_mark: string | null;
  pearl_weight: number | null;
  bearing_weight: number | null;
}

interface OrderResult {
  order_id: number;
  order_no: string;
  order?: Record<string, unknown>;
  customer_name: string;
  salesperson: string;
  total_weight: number;
  total_labor_cost: number;
  items_count: number;
  items: OrderResultItem[];
}

interface QuickOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: OrderResult) => void;
}

// 默认商品模板（新用户没有历史数据时使用）
const DEFAULT_TEMPLATES = [
  { name: '古法戒指', labor_cost: '8' },
  { name: '古法手镯', labor_cost: '6' },
  { name: '项链', labor_cost: '5' },
  { name: '吊坠', labor_cost: '7' },
  { name: '耳环', labor_cost: '6' },
  { name: '手链', labor_cost: '5' },
];

export const QuickOrderModal: React.FC<QuickOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [productTemplates, setProductTemplates] = useState(DEFAULT_TEMPLATES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSalesperson, setSelectedSalesperson] = useState('');
  const [suggestedSalesperson, setSuggestedSalesperson] = useState('');
  const [items, setItems] = useState<OrderItem[]>([
    { id: '1', product_code: '', product_name: '', weight: '', labor_cost: '', piece_count: '', piece_labor_cost: '' }
  ]);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryErrors, setInventoryErrors] = useState<InventoryError[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [codeDropdownId, setCodeDropdownId] = useState<string | null>(null);
  const [codeSearchResults, setCodeSearchResults] = useState<ProductCode[]>([]);
  const [fCodeDetails, setFCodeDetails] = useState<Record<string, FCodeDetail>>({});

  // 获取库存商品列表（展厅库存）
  const fetchInventory = async () => {
    try {
      // 先获取展厅位置ID
      const locResponse = await fetch(`${API_BASE_URL}/api/warehouse/locations`);
      const locData = await locResponse.json();
      const showroomLocation = locData.find((loc: any) => loc.code === 'showroom');
      
      if (showroomLocation) {
        // 获取展厅库存
        const invResponse = await fetch(`${API_BASE_URL}/api/warehouse/inventory?location_id=${showroomLocation.id}`);
        const invData = await invResponse.json();
        // 转换为需要的格式
        const items = invData.map((item: any) => ({
          product_name: item.product_name,
          total_weight: item.weight
        }));
        setInventoryItems(items);
      }
    } catch (error) {
      console.error('获取库存列表失败', error);
    }
  };

  // 获取商品编码列表
  const fetchProductCodes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes?limit=10000&include_used=true`);
      if (response.ok) {
        const data = await response.json();
        const codeList = Array.isArray(data) ? data : (data.codes || []);
        setProductCodes(codeList);
      }
    } catch (error) {
      console.error('获取商品编码列表失败', error);
    }
  };

  // 商品编码搜索
  const searchCode = (itemId: string, query: string) => {
    if (!query.trim()) {
      setCodeSearchResults([]);
      setCodeDropdownId(null);
      return;
    }
    const upperQuery = query.toUpperCase();
    const results = productCodes.filter(pc =>
      pc.code.toUpperCase().includes(upperQuery) ||
      pc.name.includes(query)
    ).slice(0, 8);
    setCodeSearchResults(results);
    setCodeDropdownId(results.length > 0 ? itemId : null);
  };

  // 选择商品编码 → 自动填充商品名称 + 获取F码入库详情
  const selectProductCode = (itemId: string, pc: ProductCode) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, product_code: pc.code, product_name: pc.name } : item
    ));
    setCodeDropdownId(null);
    setCodeSearchResults([]);
    if (pc.code.toUpperCase().startsWith('F')) {
      fetchFCodeDetail(itemId, pc.code);
    }
  };

  // 获取 F码商品的入库详情（镶嵌字段）+ 自动填充克重/工费
  const fetchFCodeDetail = async (itemId: string, code: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/inventory/by-code?code=${encodeURIComponent(code)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          setFCodeDetails(prev => ({ ...prev, [itemId]: data.data }));
          const d = data.data;
          setItems(prev => prev.map(item =>
            item.id === itemId ? {
              ...item,
              weight: d.weight != null ? String(d.weight) : item.weight,
              labor_cost: d.labor_cost != null ? String(d.labor_cost) : item.labor_cost,
              piece_count: d.piece_count != null ? String(d.piece_count) : item.piece_count,
              piece_labor_cost: d.piece_labor_cost != null ? String(d.piece_labor_cost) : item.piece_labor_cost,
            } : item
          ));
        }
      }
    } catch (error) {
      console.error('获取F码入库详情失败', error);
    }
  };

  // 更新 F编码详情面板中的字段（销售工费联动上方输入框）
  const updateFCodeDetail = (itemId: string, field: string, value: string) => {
    setFCodeDetails(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value === '' ? null : isNaN(Number(value)) ? value : Number(value) }
    }));
    if (field === 'sale_labor_cost') {
      setItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, labor_cost: value } : item
      ));
    } else if (field === 'sale_piece_labor_cost') {
      setItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, piece_labor_cost: value } : item
      ));
    }
  };

  // 商品名称变更时 → 反查编码
  const handleProductNameChange = (itemId: string, name: string) => {
    const matched = productCodes.find(pc => pc.name === name);
    setItems(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, product_name: name, product_code: matched ? matched.code : item.product_code }
        : item
    ));
  };

  // 获取客户列表
  const fetchCustomers = async (search?: string) => {
    setLoadingCustomers(true);
    try {
      const url = search 
        ? `${API_BASE_URL}/api/customers?name=${encodeURIComponent(search)}&page_size=500`
        : `${API_BASE_URL}/api/customers?page_size=500`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setCustomers(data.data?.customers || data.customers || []);
      }
    } catch (error) {
      console.error('获取客户列表失败', error);
    } finally {
      setLoadingCustomers(false);
    }
  };

  // 获取业务员列表
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

  // 根据客户名获取推荐业务员
  const fetchSuggestedSalesperson = async (customerName: string) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/suggest-salesperson?customer_name=${encodeURIComponent(customerName)}`
      );
      const data = await response.json();
      if (data.success && data.salesperson) {
        setSuggestedSalesperson(data.salesperson);
        setSelectedSalesperson(data.salesperson);
      } else {
        setSuggestedSalesperson('');
      }
    } catch (error) {
      console.error('获取推荐业务员失败', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCustomers();
      fetchSalespersons();
      fetchInventory();
      fetchProductCodes();
      // 加载常用商品模板（根据历史数据动态生成）
      fetch(`${API_BASE_URL}/api/sales/frequent-products?limit=8`)
        .then(res => res.ok ? res.json() : [])
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setProductTemplates(data);
          }
        })
        .catch(() => {});
      // 重置表单
      setSelectedCustomer(null);
      setCustomerSearch('');
      setSelectedSalesperson('');
      setSuggestedSalesperson('');
      setItems([{ id: '1', product_code: '', product_name: '', weight: '', labor_cost: '', piece_count: '', piece_labor_cost: '' }]);
      setRemark('');
      setInventoryErrors([]);
      setCodeDropdownId(null);
      setCodeSearchResults([]);
      setFCodeDetails({});
    }
  }, [isOpen]);

  // 客户搜索
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

  // 选择客户时自动匹配业务员
  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
    fetchSuggestedSalesperson(customer.name);
  };

  // 添加商品行
  const addItem = () => {
    setItems([...items, { 
      id: Date.now().toString(), 
      product_code: '',
      product_name: '', 
      weight: '', 
      labor_cost: '',
      piece_count: '',
      piece_labor_cost: ''
    }]);
  };

  // 删除商品行
  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  // 更新商品行
  const updateItem = (id: string, field: keyof OrderItem, value: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // 使用模板填充
  const useTemplate = (template: { name: string; labor_cost: string }) => {
    const matched = productCodes.find(pc => pc.name === template.name);
    const code = matched ? matched.code : '';
    const emptyItem = items.find(item => !item.product_name);
    if (emptyItem) {
      setItems(prev => prev.map(item =>
        item.id === emptyItem.id
          ? { ...item, product_code: code, product_name: template.name, labor_cost: template.labor_cost }
          : item
      ));
    } else {
      setItems([...items, {
        id: Date.now().toString(),
        product_code: code,
        product_name: template.name,
        weight: '',
        labor_cost: template.labor_cost,
        piece_count: '',
        piece_labor_cost: ''
      }]);
    }
  };

  // 验证表单
  const validateForm = (): string | null => {
    if (!selectedCustomer && !customerSearch.trim()) {
      return '请选择或输入客户名';
    }
    if (!selectedSalesperson) {
      return '请选择业务员';
    }
    const validItems = items.filter(item => 
      item.product_name.trim() && item.weight && item.labor_cost
    );
    if (validItems.length === 0) {
      return '请至少添加一个完整的商品（商品名、克重、工费）';
    }
    return null;
  };

  // 提交订单
  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }

    // 提交前检查：有件工费但没件数的项
    const itemsWithInvalidPieceCost = items.filter(
      item => item.piece_labor_cost && !item.piece_count && item.product_name.trim()
    );

    if (itemsWithInvalidPieceCost.length > 0) {
      const productNames = itemsWithInvalidPieceCost.map(i => i.product_name || '未命名商品').join('、');
      const confirmed = window.confirm(
        `以下商品输入了件工费但未输入件数，件工费将不会被计算：\n${productNames}\n\n是否继续提交？`
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      // 构建提交数据时，无件数的项自动清除件工费
      const validItems = items
        .filter(item => item.product_name.trim() && item.weight && item.labor_cost)
        .map(item => ({
          product_code: item.product_code?.trim() || undefined,
          product_name: item.product_name.trim(),
          weight: parseFloat(item.weight),
          labor_cost: parseFloat(item.labor_cost),
          piece_count: item.piece_count ? parseInt(item.piece_count) : null,
          piece_labor_cost: (item.piece_count && item.piece_labor_cost) 
            ? parseFloat(item.piece_labor_cost) 
            : null
        }));

      const response = await fetch(`${API_BASE_URL}/api/sales/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: selectedCustomer?.name || customerSearch.trim(),
          customer_id: selectedCustomer?.id,
          salesperson: selectedSalesperson,
          remark: remark.trim() || null,
          items: validItems
        }),
      });

      const data = await response.json();
      if (data.success) {
        const orderData = data.data?.order || data.order;
        toast.success(`销售单创建成功！单号：${orderData?.order_no || ''}`);
        
        // 调用成功回调，传递完整销售单详情（包含 order_id 和商品明细）
        // 计算总工费：(克重 × 克工费) + (件数 × 件工费)
        const calcTotalCost = (item: typeof validItems[0]) => {
          const gramCost = item.weight * item.labor_cost;
          const pieceCost = (item.piece_count || 0) * (item.piece_labor_cost || 0);
          return gramCost + pieceCost;
        };
        
        onSuccess?.({
          order_id: orderData?.id,
          order_no: orderData?.order_no || '',
          customer_name: selectedCustomer?.name || customerSearch.trim(),
          salesperson: selectedSalesperson,
          total_weight: validItems.reduce((sum, item) => sum + item.weight, 0),
          total_labor_cost: validItems.reduce((sum, item) => sum + calcTotalCost(item), 0),
          items_count: validItems.length,
          items: validItems.map(item => ({
            product_name: item.product_name,
            weight: item.weight,
            labor_cost: item.labor_cost,
            piece_count: item.piece_count || undefined,
            piece_labor_cost: item.piece_labor_cost || undefined
          })),
          order: orderData
        });
        
        onClose();
      } else {
        // 检查是否有库存错误详情
        const invErrors = data.data?.inventory_errors || data.inventory_errors;
        if (invErrors && invErrors.length > 0) {
          setInventoryErrors(invErrors);
          // 构建详细错误信息
          const errorDetails = invErrors.map((err: InventoryError) => {
            let msg = `${err.product_name}: ${err.error}（需要${err.required_weight}克，可用${err.available_weight}克）`;
            if (err.reserved_weight !== undefined && err.reserved_weight > 0) {
              msg += `。该商品有 ${err.reserved_weight} 克已被未确认的销售单占用，请先确认或取消相关订单后再开单`;
            }
            return msg;
          }).join('\n');
          toast.error(`库存检查失败:\n${errorDetails}`, { duration: 6000 });
        } else {
          toast.error(data.message || '创建失败');
        }
      }
    } catch (error) {
      toast.error('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-100 rounded-xl">
              <Package className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">快捷开单</h2>
              <p className="text-sm text-gray-500">快速创建销售单</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 客户选择 */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <User className="w-4 h-4 inline mr-1" />
              客户名 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerDropdown(true);
                  if (!e.target.value) setSelectedCustomer(null);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="搜索或输入客户名..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              {selectedCustomer && (
                <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-500" />
              )}
            </div>
            
            {/* 客户下拉列表 */}
            {showCustomerDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {loadingCustomers ? (
                  <div className="p-4 text-center text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </div>
                ) : customers.length > 0 ? (
                  customers.slice(0, 10).map(customer => (
                    <div
                      key={customer.id}
                      onClick={() => handleSelectCustomer(customer)}
                      className="px-4 py-2.5 hover:bg-emerald-50 cursor-pointer flex items-center justify-between"
                    >
                      <span className="font-medium">{customer.name}</span>
                      <span className="text-xs text-gray-400">{customer.customer_no}</span>
                    </div>
                  ))
                ) : customerSearch ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    未找到客户，将创建新客户
                  </div>
                ) : (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    暂无客户数据
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 业务员选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <UserCheck className="w-4 h-4 inline mr-1" />
              业务员 <span className="text-red-500">*</span>
              {suggestedSalesperson && (
                <span className="ml-2 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  智能匹配
                </span>
              )}
            </label>
            <select
              value={selectedSalesperson}
              onChange={(e) => setSelectedSalesperson(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
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
              商品明细 <span className="text-red-500">*</span>
            </label>
            
            {/* 常用模板 */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs text-gray-500 self-center">常用：</span>
              {productTemplates.map(template => (
                <button
                  key={template.name}
                  onClick={() => useTemplate(template)}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-emerald-100 hover:text-emerald-700 
                             rounded-full transition-colors"
                >
                  {template.name}
                </button>
              ))}
            </div>

            {/* 商品列表 */}
            {/* 商品选择列表 - 使用 datalist 实现可选可输入 */}
            <datalist id="product-list">
              {inventoryItems.map((inv) => (
                <option key={inv.product_name} value={inv.product_name}>
                  {inv.product_name} ({inv.total_weight.toFixed(1)}克)
                </option>
              ))}
            </datalist>

            <div className="space-y-2">
              {items.map((item, index) => {
                const w = parseFloat(item.weight) || 0;
                const lc = parseFloat(item.labor_cost) || 0;
                const pc = parseInt(item.piece_count) || 0;
                const plc = parseFloat(item.piece_labor_cost) || 0;
                const itemSubtotal = w * lc + pc * plc;

                return (
                <React.Fragment key={item.id}>
                <div className="flex items-center space-x-2 bg-gray-50 p-3 rounded-xl">
                  <span className="text-sm text-gray-400 w-6 shrink-0">{index + 1}.</span>
                  {/* 商品编码 */}
                  <div className="relative">
                    <input
                      type="text"
                      value={item.product_code}
                      onChange={(e) => {
                        updateItem(item.id, 'product_code', e.target.value);
                        searchCode(item.id, e.target.value);
                      }}
                      onFocus={() => {
                        if (item.product_code) searchCode(item.id, item.product_code);
                      }}
                      onBlur={() => setTimeout(() => {
                        if (codeDropdownId === item.id) setCodeDropdownId(null);
                        const code = item.product_code.trim().toUpperCase();
                        if (code.startsWith('F') && code.length > 1 && !fCodeDetails[item.id]) {
                          const matched = productCodes.find(pc => pc.code.toUpperCase() === code);
                          if (matched) {
                            selectProductCode(item.id, matched);
                          } else {
                            fetchFCodeDetail(item.id, code);
                          }
                        }
                      }, 200)}
                      placeholder="商品编码"
                      className="w-28 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
                    />
                    {codeDropdownId === item.id && codeSearchResults.length > 0 && (
                      <div className="absolute z-20 w-64 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {codeSearchResults.map(pc => (
                          <div
                            key={pc.id}
                            onMouseDown={() => selectProductCode(item.id, pc)}
                            className="px-3 py-2 hover:bg-emerald-50 cursor-pointer flex items-center justify-between text-sm"
                          >
                            <span className="font-mono text-emerald-600">{pc.code}</span>
                            <span className="text-gray-600 ml-2 truncate">{pc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 商品名称 */}
                  <input
                    type="text"
                    list="product-list"
                    value={item.product_name}
                    onChange={(e) => handleProductNameChange(item.id, e.target.value)}
                    placeholder="商品名称"
                    className="flex-1 min-w-[140px] px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                               focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
                  />
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={item.weight}
                      onChange={(e) => updateItem(item.id, 'weight', e.target.value)}
                      placeholder="克重"
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm text-center"
                    />
                    <span className="text-xs text-gray-400 ml-1">克</span>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={item.labor_cost}
                      onChange={(e) => updateItem(item.id, 'labor_cost', e.target.value)}
                      placeholder="工费"
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm text-center"
                    />
                    <span className="text-xs text-gray-400 ml-1">元</span>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={item.piece_count}
                      onChange={(e) => updateItem(item.id, 'piece_count', e.target.value)}
                      placeholder="件数"
                      className="w-18 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm text-center"
                    />
                    <span className="text-xs text-gray-400 ml-1">件</span>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={item.piece_labor_cost}
                      onChange={(e) => updateItem(item.id, 'piece_labor_cost', e.target.value)}
                      placeholder="件工费"
                      className="w-20 px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm text-center"
                    />
                    <span className="text-xs text-gray-400 ml-1">元</span>
                  </div>
                  {/* 工费小计 */}
                  <div className="text-sm text-gray-500 w-24 text-right shrink-0 font-mono">
                    {itemSubtotal > 0 ? `¥${itemSubtotal.toFixed(2)}` : '-'}
                  </div>
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg 
                               transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* F码入库详情面板 */}
                {fCodeDetails[item.id] && (
                  <div className="ml-8 mr-2 -mt-1 mb-1 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                    <div className="text-amber-700 font-medium mb-2">入库详情</div>
                    <div className="grid grid-cols-4 gap-x-4 gap-y-1.5 text-gray-600">
                      {[
                        { label: '主石重', field: 'main_stone_weight', type: 'number', readonly: true },
                        { label: '主石粒数', field: 'main_stone_count', type: 'number', readonly: true },
                        { label: '副石重', field: 'sub_stone_weight', type: 'number', readonly: true },
                        { label: '副石粒数', field: 'sub_stone_count', type: 'number', readonly: true },
                        { label: '主石字印', field: 'main_stone_mark', type: 'text', readonly: true },
                        { label: '副石字印', field: 'sub_stone_mark', type: 'text', readonly: true },
                        { label: '珍珠重', field: 'pearl_weight', type: 'number', readonly: true },
                        { label: '轴承重', field: 'bearing_weight', type: 'number', readonly: true },
                        { label: '销售克工费', field: 'sale_labor_cost', type: 'number', highlight: true, readonly: false },
                        { label: '销售件工费', field: 'sale_piece_labor_cost', type: 'number', prefix: '¥', highlight: true, readonly: false },
                      ].map(({ label, field, type, prefix, highlight, readonly }) => (
                        <div key={field} className="flex items-center gap-1">
                          <span className="text-gray-400 whitespace-nowrap">{label}:</span>
                          <div className="flex items-center">
                            {prefix && fCodeDetails[item.id]?.[field] != null && <span className="text-gray-400">{prefix}</span>}
                            <input
                              type={type}
                              value={fCodeDetails[item.id]?.[field] ?? ''}
                              onChange={(e) => !readonly && updateFCodeDetail(item.id, field, e.target.value)}
                              readOnly={readonly}
                              className={`w-16 px-1 py-0.5 border rounded text-xs text-center
                                ${readonly ? 'bg-gray-50 border-gray-100 text-gray-500 cursor-default' : 'bg-white border-gray-200'}
                                ${highlight ? 'border-emerald-300 text-emerald-700 font-medium bg-white' : ''}`}
                              placeholder="-"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </React.Fragment>
              )})}
            </div>

            {/* 总工费汇总 */}
            {(() => {
              const grandTotal = items.reduce((sum, item) => {
                const w = parseFloat(item.weight) || 0;
                const lc = parseFloat(item.labor_cost) || 0;
                const pc = parseInt(item.piece_count) || 0;
                const plc = parseFloat(item.piece_labor_cost) || 0;
                return sum + w * lc + pc * plc;
              }, 0);
              return grandTotal > 0 ? (
                <div className="flex justify-end items-center mt-2 pr-10 text-sm">
                  <span className="text-gray-500 mr-2">总工费:</span>
                  <span className="font-bold text-gray-800 font-mono">¥{grandTotal.toFixed(2)}</span>
                </div>
              ) : null;
            })()}

            <button
              onClick={addItem}
              className="mt-2 flex items-center space-x-1 text-sm text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="w-4 h-4" />
              <span>添加商品</span>
            </button>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              备注（可选）
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="输入备注信息..."
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {/* 库存错误提示 */}
          {inventoryErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center space-x-2 text-red-700 font-medium mb-2">
                <AlertCircle className="w-5 h-5" />
                <span>库存检查失败</span>
              </div>
              <div className="space-y-2">
                {inventoryErrors.map((err, idx) => (
                  <div key={idx} className="text-sm text-red-600 bg-white rounded-lg p-3 border border-red-100">
                    <div className="font-medium">{err.product_name}</div>
                    <div className="text-red-500 mt-1">
                      {err.error}：需要 <span className="font-semibold">{err.required_weight}</span> 克，
                      可用 <span className="font-semibold">{err.available_weight}</span> 克
                      {err.reserved_weight !== undefined && err.reserved_weight > 0 && (
                        <div className="mt-1.5 text-amber-700 text-xs">
                          该商品有 <span className="font-semibold">{err.reserved_weight}</span> 克已被未确认的销售单占用，请先确认或取消相关订单后再开单
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl 
                       hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 
                       transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed
                       flex items-center space-x-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>提交中...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>确认开单</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickOrderModal;


