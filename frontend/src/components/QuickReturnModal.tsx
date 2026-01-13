import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import {
  X, Package, AlertCircle, Loader2, Printer, Download, CheckCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Supplier {
  id: number;
  name: string;
  supplier_no: string;
}

interface Location {
  id: number;
  code: string;
  name: string;
  location_type: string;
}

interface ProductCode {
  code: string;
  name: string;
  code_type: string;
}

interface QuickReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  userRole?: string;
}

const RETURN_REASONS = ['质量问题', '款式不符', '数量差异', '工艺瑕疵', '其他'];

export const QuickReturnModal: React.FC<QuickReturnModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userRole = 'product'
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  
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

  // 表单数据
  const [formData, setFormData] = useState({
    product_name: '',
    return_weight: '',
    supplier_id: '',
    from_location_id: '',
    return_reason: '质量问题',
    reason_detail: '',
    remark: ''
  });

  // 创建成功后的退货单信息
  const [createdReturn, setCreatedReturn] = useState<any>(null);

  // 加载供应商、位置列表和商品编码
  useEffect(() => {
    if (isOpen) {
      if (returnConfig.needSupplier) {
        fetchSuppliers();
      }
      fetchLocations();
      fetchProductCodes();
    }
  }, [isOpen]);

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
        setShowProductDropdown(false);
      }
    };
    
    if (showProductDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showProductDropdown]);

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/suppliers`);
      const data = await res.json();
      if (data.success) {
        setSuppliers(data.suppliers || []);
      }
    } catch (error) {
      console.error('获取供应商失败:', error);
    }
  };

  const fetchProductCodes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/product-codes`);
      const data = await res.json();
      const codeList = Array.isArray(data) ? data : (data.codes || []);
      setProductCodes(codeList);
    } catch (error) {
      console.error('获取商品编码失败:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/locations`);
      const data = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('获取位置失败:', error);
    }
  };

  // 验证表单
  const validateForm = (): string | null => {
    if (!formData.product_name.trim()) {
      return '请输入商品名称';
    }
    if (!formData.return_weight || parseFloat(formData.return_weight) <= 0) {
      return '请输入有效的退货克重';
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
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/returns?created_by=${userRole}&user_role=${userRole}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            return_type: returnConfig.returnType, // 根据角色确定退货类型
            product_name: formData.product_name.trim(),
            return_weight: parseFloat(formData.return_weight),
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
        onSuccess?.();
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
    setFormData({
      product_name: '',
      return_weight: '',
      supplier_id: '',
      from_location_id: '',
      return_reason: '质量问题',
      reason_detail: '',
      remark: ''
    });
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
                <p>商品名称：{createdReturn.product_name}</p>
                <p>退货克重：{createdReturn.return_weight}克</p>
                <p>退货原因：{createdReturn.return_reason}</p>
                <p>状态：待审批</p>
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
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
          {/* 商品名称 */}
          <div className="relative product-dropdown-container">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Package className="w-4 h-4 inline mr-1" />
              商品名称 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={formData.product_name}
                onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                onFocus={() => setShowProductDropdown(true)}
                placeholder="输入或选择商品名称"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-red-500 focus:border-transparent pr-10"
              />
              <button
                type="button"
                onClick={() => setShowProductDropdown(!showProductDropdown)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {/* 下拉选择框 */}
            {showProductDropdown && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-auto">
                {(formData.product_name.trim() 
                  ? productCodes.filter(pc => 
                      pc.name.includes(formData.product_name) ||
                      pc.code.toUpperCase().includes(formData.product_name.toUpperCase())
                    )
                  : productCodes
                ).slice(0, 15).map((pc) => (
                  <button
                    key={pc.code}
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, product_name: pc.name });
                      setShowProductDropdown(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 flex items-center gap-2 border-b border-gray-50 last:border-b-0"
                  >
                    <span className="text-gray-700">{pc.name}</span>
                    <span className="font-mono text-red-500 text-xs">({pc.code})</span>
                  </button>
                ))}
                {productCodes.length === 0 && (
                  <div className="px-4 py-4 text-center text-gray-400 text-sm">
                    暂无商品编码
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 退货克重 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              退货克重 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.return_weight}
              onChange={(e) => setFormData({ ...formData, return_weight: e.target.value })}
              placeholder="请输入退货克重"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          {/* 供应商（仅商品专员需要） */}
          {returnConfig.needSupplier && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                供应商 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.supplier_id}
                onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="">请选择供应商</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 发起位置（固定显示，不可修改） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              发起位置 <span className="text-red-500">*</span>
            </label>
            <div className="w-full px-4 py-2.5 border border-gray-300 rounded-xl bg-gray-50 text-gray-700">
              {returnConfig.locationName}
            </div>
            <p className="mt-1 text-xs text-gray-500">此位置已根据您的角色自动设置</p>
          </div>

          {/* 退货原因 */}
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

          {/* 详细说明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              详细说明
            </label>
            <textarea
              value={formData.reason_detail}
              onChange={(e) => setFormData({ ...formData, reason_detail: e.target.value })}
              placeholder="请详细说明退货原因（可选）"
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              备注
            </label>
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
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
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
  );
};

