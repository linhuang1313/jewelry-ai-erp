import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import {
  X, Package, AlertCircle, Loader2, Printer, Download, CheckCircle, Plus, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Supplier {
  id: number;
  name: string;
  pinyin_initials?: string;
  supplier_no: string;
}

interface Location {
  id: number;
  code: string;
  name: string;
  location_type: string;
}

interface InventoryItem {
  id: number;
  product_name: string;
  pinyin_initials?: string;
  weight: number;
  location_name?: string;
}

interface ReturnItem {
  product_name: string;
  return_weight: string;
  labor_cost: string;
  piece_count: string;
  piece_labor_cost: string;
  remark: string;
}

interface ReturnResult {
  return_id: number;
  return_no: string;
  total_weight: number;
  total_labor_cost: number;
  item_count: number;
  return_reason: string;
  supplier_name?: string;
  from_location_name?: string;
}

interface QuickReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: ReturnResult) => void;
  userRole?: string;
}

const RETURN_REASONS = ['质量问题', '款式不符', '数量差异', '工艺瑕疵', '其他'];

const emptyItem: ReturnItem = {
  product_name: '',
  return_weight: '',
  labor_cost: '',
  piece_count: '',
  piece_labor_cost: '',
  remark: ''
};

export const QuickReturnModal: React.FC<QuickReturnModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userRole = 'product'
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState<number | null>(null);
  const [supplierKeyword, setSupplierKeyword] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  
  // 根据角色确定退货配置
  const getReturnConfig = () => {
    if (userRole === 'counter') {
      return {
        returnType: 'to_warehouse',
        locationCode: 'showroom',
        locationName: '展厅',
        needSupplier: false,
        title: '快捷退货（退给商品部）',
        subtitle: '快速创建退货单（退给商品部）'
      };
    } else {
      // 商品专员
      return {
        returnType: 'to_supplier',
        locationCode: 'warehouse',
        locationName: '商品部仓库',
        needSupplier: true,
        title: '快捷退货（退给供应商）',
        subtitle: '快速创建退货单（退给供应商）'
      };
    }
  };

  const returnConfig = getReturnConfig();

  // 商品列表
  const [items, setItems] = useState<ReturnItem[]>([{ ...emptyItem }]);
  
  // 其他表单数据
  const [formData, setFormData] = useState({
    supplier_id: '',
    from_location_id: '',
    return_reason: '质量问题',
    reason_detail: '',
    remark: ''
  });

  // 创建成功后的退货单信息
  const [createdReturn, setCreatedReturn] = useState<any>(null);

  // 加载供应商和位置列表
  useEffect(() => {
    if (isOpen) {
      setDataLoading(true);
      const promises: Promise<void>[] = [fetchLocations()];
      if (returnConfig.needSupplier) {
        promises.push(fetchSuppliers());
      }
      Promise.all(promises).finally(() => setDataLoading(false));
    }
  }, [isOpen, returnConfig.needSupplier]);
  
  // 位置确定后加载该位置的库存
  useEffect(() => {
    if (isOpen && formData.from_location_id) {
      fetchLocationInventory(formData.from_location_id);
    }
  }, [isOpen, formData.from_location_id]);

  // 根据角色自动设置固定位置（每次弹窗打开时）
  useEffect(() => {
    if (isOpen && locations.length > 0) {
      const targetLocation = locations.find(loc => loc.code === returnConfig.locationCode);
      if (targetLocation) {
        setFormData(prev => ({ ...prev, from_location_id: String(targetLocation.id) }));
      }
    }
  }, [isOpen, locations, returnConfig.locationCode]);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.product-dropdown-container')) {
        setActiveDropdownIndex(null);
      }
      if (!target.closest('.supplier-dropdown-container')) {
        setShowSupplierDropdown(false);
      }
    };
    
    if (activeDropdownIndex !== null || showSupplierDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [activeDropdownIndex, showSupplierDropdown]);

  // 供应商搜索过滤
  const filteredSuppliers = supplierKeyword.trim()
    ? suppliers.filter(s => {
        const keyword = supplierKeyword.toUpperCase();
        return s.name.includes(supplierKeyword) ||
               (s.pinyin_initials && s.pinyin_initials.includes(keyword));
      })
    : suppliers;

  // 选择供应商
  const selectSupplier = (supplier: Supplier) => {
    setFormData(prev => ({ ...prev, supplier_id: String(supplier.id) }));
    setSupplierKeyword(supplier.name);
    setShowSupplierDropdown(false);
  };

  const fetchSuppliers = async (): Promise<void> => {
    try {
      // 传递空的 status 参数，不筛选状态，返回所有供应商
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/suppliers?status=`);
      const data = await res.json();
      if (data.success) {
        setSuppliers(data.suppliers || []);
      } else {
        toast.error('获取供应商列表失败');
      }
    } catch (error) {
      console.error('获取供应商失败:', error);
      toast.error('获取供应商列表失败，请刷新重试');
    }
  };

  const fetchLocationInventory = async (locationId: string): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/warehouse/inventory?location_id=${locationId}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items || data.inventory || []);
      setInventoryItems(items);
    } catch (error) {
      console.error('获取位置库存失败:', error);
      setInventoryItems([]);
      toast.error('获取库存数据失败');
    }
  };

  const fetchLocations = async (): Promise<void> => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/locations`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setLocations(data);
      } else {
        setLocations([]);
        toast.error('未找到仓库位置数据');
      }
    } catch (error) {
      console.error('获取位置失败:', error);
      toast.error('获取仓库位置失败，请刷新重试');
    }
  };

  // 添加商品行
  const addItem = () => {
    setItems([...items, { ...emptyItem }]);
  };

  // 删除商品行
  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  // 更新商品行
  const updateItem = (index: number, field: keyof ReturnItem, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  // 计算单个商品的总工费
  const calcItemLaborCost = (item: ReturnItem): number => {
    const weight = parseFloat(item.return_weight) || 0;
    const laborCost = parseFloat(item.labor_cost) || 0;
    const pieceCount = parseInt(item.piece_count) || 0;
    const pieceLaborCost = parseFloat(item.piece_labor_cost) || 0;
    return weight * laborCost + pieceCount * pieceLaborCost;
  };

  // 计算汇总
  const totalWeight = items.reduce((sum, item) => sum + (parseFloat(item.return_weight) || 0), 0);
  const totalLaborCost = items.reduce((sum, item) => sum + calcItemLaborCost(item), 0);

  // 验证表单
  const validateForm = (): string | null => {
    // 验证商品列表
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.product_name.trim()) {
        return `第 ${i + 1} 行：请输入商品名称`;
      }
      if (!item.return_weight || parseFloat(item.return_weight) <= 0) {
        return `第 ${i + 1} 行：请输入有效的退货克重`;
      }
    }
    
    if (returnConfig.needSupplier && !formData.supplier_id) {
      return '请选择供应商';
    }
    if (!formData.from_location_id) {
      return '发起位置未设置';
    }
    return null;
  };

  // 提交退货单
  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }

    setSubmitting(true);
    try {
      // 构建请求数据
      const requestItems = items.map(item => ({
        product_name: item.product_name.trim(),
        return_weight: parseFloat(item.return_weight),
        labor_cost: parseFloat(item.labor_cost) || 0,
        piece_count: item.piece_count ? parseInt(item.piece_count) : null,
        piece_labor_cost: item.piece_labor_cost ? parseFloat(item.piece_labor_cost) : null,
        remark: item.remark.trim() || null
      }));

      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/returns?created_by=${userRole}&user_role=${userRole}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            return_type: returnConfig.returnType,
            items: requestItems,
            supplier_id: returnConfig.needSupplier ? parseInt(formData.supplier_id) : null,
            from_location_id: parseInt(formData.from_location_id),
            return_reason: formData.return_reason,
            reason_detail: formData.reason_detail.trim() || null,
            remark: formData.remark.trim() || null,
          }),
        }
      );

      const data = await response.json();
      if (data.success) {
        toast.success(`退货单创建成功！单号：${data.return_order?.return_no || ''}`);
        setCreatedReturn(data.return_order);
        
        const selectedSupplierObj = suppliers.find(s => s.id === parseInt(formData.supplier_id));
        
        onSuccess?.({
          return_id: data.return_order?.id,
          return_no: data.return_order?.return_no || '',
          total_weight: totalWeight,
          total_labor_cost: totalLaborCost,
          item_count: items.length,
          return_reason: formData.return_reason,
          supplier_name: selectedSupplierObj?.name,
          from_location_name: returnConfig.locationName
        });
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (error) {
      toast.error('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 打印退货单
  const handlePrint = () => {
    if (!createdReturn) return;
    const url = `${API_ENDPOINTS.API_BASE_URL}/api/returns/${createdReturn.id}/download?format=html`;
    window.open(url, '_blank');
  };

  // 下载退货单
  const handleDownload = () => {
    if (!createdReturn) return;
    const url = `${API_ENDPOINTS.API_BASE_URL}/api/returns/${createdReturn.id}/download?format=pdf`;
    window.open(url, '_blank');
  };

  // 重置表单
  const handleReset = () => {
    setItems([{ ...emptyItem }]);
    setFormData({
      supplier_id: '',
      from_location_id: '',
      return_reason: '质量问题',
      reason_detail: '',
      remark: ''
    });
    setSupplierKeyword('');
    setCreatedReturn(null);
  };

  // 关闭时重置
  const handleClose = () => {
    handleReset();
    onClose();
  };

  if (!isOpen) return null;

  // 如果创建成功，显示成功页面
  if (createdReturn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        />
        
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-in fade-in zoom-in-95 duration-200">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-xl">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">退货单创建成功</h2>
                <p className="text-sm text-gray-500">退货单号：{createdReturn.return_no}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* 成功信息 */}
          <div className="p-6 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center space-x-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-900">退货单已创建</span>
              </div>
              <div className="text-sm text-green-800 space-y-1">
                <p>商品数量：{createdReturn.item_count} 个</p>
                <p>总退货克重：{createdReturn.total_weight?.toFixed(2)}克</p>
                <p>总工费：¥{createdReturn.total_labor_cost?.toFixed(2)}</p>
                <p>退货原因：{createdReturn.return_reason}</p>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex space-x-3">
              <button
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl
                           hover:bg-blue-700 transition-all font-medium"
              >
                <Printer className="w-4 h-4" />
                <span>打印</span>
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-green-600 text-white rounded-xl
                           hover:bg-green-700 transition-all font-medium"
              >
                <Download className="w-4 h-4" />
                <span>下载</span>
              </button>
            </div>

            <button
              onClick={handleReset}
              className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl
                         hover:bg-gray-200 transition-all font-medium"
            >
              继续创建
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-red-50 to-orange-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 rounded-xl">
              <Package className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{returnConfig.title}</h2>
              <p className="text-sm text-gray-500">{returnConfig.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 发起位置（固定显示） */}
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">发起位置</label>
              <div className="px-4 py-2.5 border border-gray-300 rounded-xl bg-gray-50 text-gray-700">
                {returnConfig.locationName}
              </div>
            </div>
            {/* 供应商（仅商品专员需要） */}
            {returnConfig.needSupplier && (
              <div className="flex-1 relative supplier-dropdown-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  供应商 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={supplierKeyword}
                  onChange={(e) => {
                    setSupplierKeyword(e.target.value);
                    setFormData(prev => ({ ...prev, supplier_id: '' }));
                  }}
                  onFocus={() => setShowSupplierDropdown(true)}
                  placeholder={dataLoading ? '加载中...' : '输入供应商名称或拼音首字母'}
                  disabled={dataLoading}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                             focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:bg-gray-100"
                />
                {showSupplierDropdown && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-auto">
                    {filteredSuppliers.length > 0 ? (
                      filteredSuppliers.slice(0, 15).map(supplier => (
                        <button
                          key={supplier.id}
                          type="button"
                          onClick={() => selectSupplier(supplier)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 flex items-center justify-between border-b border-gray-50 last:border-b-0"
                        >
                          <span className="text-gray-700">{supplier.name}</span>
                          {supplier.pinyin_initials && (
                            <span className="text-xs text-gray-400 ml-2">{supplier.pinyin_initials}</span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-center text-gray-400 text-sm">
                        {dataLoading ? '加载中...' : '暂无匹配的供应商'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 商品列表 */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="font-medium text-gray-700">退货商品明细</span>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center space-x-1 text-sm text-red-600 hover:text-red-700"
              >
                <Plus className="w-4 h-4" />
                <span>添加商品</span>
              </button>
            </div>
            
            {/* 表头 */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-100 text-xs font-medium text-gray-600">
              <div className="col-span-3">商品名称 *</div>
              <div className="col-span-2">退货克重 *</div>
              <div className="col-span-2">克工费(元/克)</div>
              <div className="col-span-1">件数</div>
              <div className="col-span-2">件工费(元/件)</div>
              <div className="col-span-1">小计</div>
              <div className="col-span-1"></div>
            </div>
            
            {/* 商品行 */}
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-gray-100 items-center">
                {/* 商品名称 */}
                <div className="col-span-3 relative product-dropdown-container">
                  <input
                    type="text"
                    value={item.product_name}
                    onChange={(e) => updateItem(index, 'product_name', e.target.value)}
                    onFocus={() => setActiveDropdownIndex(index)}
                    placeholder="选择或输入"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  {activeDropdownIndex === index && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-auto">
                      {(item.product_name.trim() 
                        ? inventoryItems.filter(inv => {
                            const keyword = item.product_name.toUpperCase();
                            return inv.product_name.includes(item.product_name) ||
                                   (inv.pinyin_initials && inv.pinyin_initials.includes(keyword));
                          })
                        : inventoryItems
                      ).slice(0, 15).map((inv) => (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => {
                            updateItem(index, 'product_name', inv.product_name);
                            setActiveDropdownIndex(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 flex items-center justify-between border-b border-gray-50 last:border-b-0"
                        >
                          <span className="text-gray-700 truncate">{inv.product_name}</span>
                          <span className="font-mono text-orange-500 text-xs ml-2">{inv.weight?.toFixed(2)}g</span>
                        </button>
                      ))}
                      {inventoryItems.length === 0 && (
                        <div className="px-3 py-3 text-center text-gray-400 text-sm">
                          {dataLoading ? '加载中...' : '暂无库存'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* 退货克重 */}
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.return_weight}
                    onChange={(e) => updateItem(index, 'return_weight', e.target.value)}
                    placeholder="克重"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                
                {/* 克工费 */}
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.labor_cost}
                    onChange={(e) => updateItem(index, 'labor_cost', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                
                {/* 件数 */}
                <div className="col-span-1">
                  <input
                    type="number"
                    min="0"
                    value={item.piece_count}
                    onChange={(e) => updateItem(index, 'piece_count', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                
                {/* 件工费 */}
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.piece_labor_cost}
                    onChange={(e) => updateItem(index, 'piece_labor_cost', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                
                {/* 小计 */}
                <div className="col-span-1 text-sm font-medium text-orange-600">
                  ¥{calcItemLaborCost(item).toFixed(2)}
                </div>
                
                {/* 删除按钮 */}
                <div className="col-span-1">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            
            {/* 汇总行 */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-red-50 font-medium">
              <div className="col-span-3 text-gray-700">合计 ({items.length} 个商品)</div>
              <div className="col-span-2 text-red-600">{totalWeight.toFixed(2)} 克</div>
              <div className="col-span-5"></div>
              <div className="col-span-1 text-red-600">¥{totalLaborCost.toFixed(2)}</div>
              <div className="col-span-1"></div>
            </div>
          </div>

          {/* 退货原因 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                退货原因 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.return_reason}
                onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                {RETURN_REASONS.map(reason => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">详细说明</label>
              <input
                type="text"
                value={formData.reason_detail}
                onChange={(e) => setFormData({ ...formData, reason_detail: e.target.value })}
                placeholder="请详细说明退货原因（可选）"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">备注</label>
            <textarea
              value={formData.remark}
              onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
              placeholder="其他备注信息（可选）"
              rows={2}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            共 <span className="font-bold text-red-600">{items.length}</span> 个商品，
            总退货 <span className="font-bold text-red-600">{totalWeight.toFixed(2)}</span> 克，
            总工费 <span className="font-bold text-red-600">¥{totalLaborCost.toFixed(2)}</span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleClose}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all font-medium"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 
                         transition-all font-medium disabled:bg-gray-300 disabled:cursor-not-allowed
                         flex items-center space-x-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>提交中...</span>
                </>
              ) : (
                <span>提交退货单</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
