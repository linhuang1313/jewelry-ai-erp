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

interface OrderItem {
  id: string;
  product_name: string;
  weight: string;
  labor_cost: string;
}

interface QuickOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// 常用商品模板
const PRODUCT_TEMPLATES = [
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSalesperson, setSelectedSalesperson] = useState('');
  const [suggestedSalesperson, setSuggestedSalesperson] = useState('');
  const [items, setItems] = useState<OrderItem[]>([
    { id: '1', product_name: '', weight: '', labor_cost: '' }
  ]);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // 获取客户列表
  const fetchCustomers = async (search?: string) => {
    setLoadingCustomers(true);
    try {
      const url = search 
        ? `${API_BASE_URL}/api/customers?name=${encodeURIComponent(search)}`
        : `${API_BASE_URL}/api/customers`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setCustomers(data.customers || []);
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
      // 重置表单
      setSelectedCustomer(null);
      setCustomerSearch('');
      setSelectedSalesperson('');
      setSuggestedSalesperson('');
      setItems([{ id: '1', product_name: '', weight: '', labor_cost: '' }]);
      setRemark('');
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
      product_name: '', 
      weight: '', 
      labor_cost: '' 
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
    const emptyItem = items.find(item => !item.product_name);
    if (emptyItem) {
      updateItem(emptyItem.id, 'product_name', template.name);
      updateItem(emptyItem.id, 'labor_cost', template.labor_cost);
    } else {
      setItems([...items, {
        id: Date.now().toString(),
        product_name: template.name,
        weight: '',
        labor_cost: template.labor_cost
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

    setSubmitting(true);
    try {
      const validItems = items
        .filter(item => item.product_name.trim() && item.weight && item.labor_cost)
        .map(item => ({
          product_name: item.product_name.trim(),
          weight: parseFloat(item.weight),
          labor_cost: parseFloat(item.labor_cost)
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
        toast.success(`销售单创建成功！单号：${data.order?.order_no || ''}`);
        onSuccess?.();
        onClose();
      } else {
        toast.error(data.message || '创建失败');
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
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
              {PRODUCT_TEMPLATES.map(template => (
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
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={item.id} className="flex items-center space-x-2 bg-gray-50 p-3 rounded-xl">
                  <span className="text-xs text-gray-400 w-6">{index + 1}.</span>
                  <input
                    type="text"
                    value={item.product_name}
                    onChange={(e) => updateItem(item.id, 'product_name', e.target.value)}
                    placeholder="商品名"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none 
                               focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={item.weight}
                      onChange={(e) => updateItem(item.id, 'weight', e.target.value)}
                      placeholder="克重"
                      className="w-20 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none 
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
                      className="w-20 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none 
                                 focus:ring-2 focus:ring-emerald-500 text-sm text-center"
                    />
                    <span className="text-xs text-gray-400 ml-1">元</span>
                  </div>
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg 
                               transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

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

