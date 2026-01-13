import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Package, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config';

interface InboundRow {
  id: string;
  productCode: string;
  productName: string;
  weight: string;
  laborCost: string;
  pieceCount: string;
  pieceLaborCost: string;
}

interface Supplier {
  id: number;
  name: string;
  supplier_no: string;
}

interface ProductCode {
  code: string;
  name: string;
  code_type: string;
}

interface QuickInboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  userRole: string;
}

const createEmptyRow = (): InboundRow => ({
  id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  productCode: '',
  productName: '',
  weight: '',
  laborCost: '',
  pieceCount: '',
  pieceLaborCost: '',
});

export default function QuickInboundModal({ isOpen, onClose, onSuccess, userRole }: QuickInboundModalProps) {
  const [rows, setRows] = useState<InboundRow[]>([createEmptyRow()]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<{rowId: string, results: ProductCode[]}[]>([]);

  // 加载供应商列表
  useEffect(() => {
    if (isOpen) {
      fetchSuppliers();
      fetchProductCodes();
    }
  }, [isOpen]);

  const fetchSuppliers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/suppliers`);
      if (response.ok) {
        const data = await response.json();
        setSuppliers(data.filter((s: Supplier & { status: string }) => s.status === 'active'));
      }
    } catch (error) {
      console.error('加载供应商失败:', error);
    }
  };

  const fetchProductCodes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes`);
      if (response.ok) {
        const data = await response.json();
        setProductCodes(data);
      }
    } catch (error) {
      console.error('加载商品编码失败:', error);
    }
  };

  // 搜索商品编码
  const searchProductCode = useCallback((rowId: string, query: string) => {
    if (!query.trim()) {
      setSearchResults(prev => prev.filter(r => r.rowId !== rowId));
      return;
    }
    
    const upperQuery = query.toUpperCase();
    const results = productCodes.filter(pc => 
      pc.code.toUpperCase().includes(upperQuery) || 
      pc.name.includes(query)
    ).slice(0, 5);
    
    setSearchResults(prev => {
      const filtered = prev.filter(r => r.rowId !== rowId);
      if (results.length > 0) {
        return [...filtered, { rowId, results }];
      }
      return filtered;
    });
  }, [productCodes]);

  // 选择商品编码
  const selectProductCode = (rowId: string, code: ProductCode) => {
    setRows(prev => prev.map(row => 
      row.id === rowId 
        ? { ...row, productCode: code.code, productName: code.name }
        : row
    ));
    setSearchResults(prev => prev.filter(r => r.rowId !== rowId));
  };

  // 计算单行总工费
  const calculateRowTotal = (row: InboundRow): number => {
    const weight = parseFloat(row.weight) || 0;
    const laborCost = parseFloat(row.laborCost) || 0;
    const pieceCount = parseFloat(row.pieceCount) || 0;
    const pieceLaborCost = parseFloat(row.pieceLaborCost) || 0;
    
    return weight * laborCost + pieceCount * pieceLaborCost;
  };

  // 计算合计
  const calculateTotal = (): number => {
    return rows.reduce((sum, row) => sum + calculateRowTotal(row), 0);
  };

  // 添加新行
  const addRow = () => {
    setRows(prev => [...prev, createEmptyRow()]);
  };

  // 删除行
  const removeRow = (id: string) => {
    if (rows.length <= 1) {
      toast.error('至少保留一行');
      return;
    }
    setRows(prev => prev.filter(row => row.id !== id));
  };

  // 更新行数据
  const updateRow = (id: string, field: keyof InboundRow, value: string) => {
    setRows(prev => prev.map(row => 
      row.id === id ? { ...row, [field]: value } : row
    ));
    
    // 如果是商品编码字段，触发搜索
    if (field === 'productCode') {
      searchProductCode(id, value);
    }
  };

  // 验证数据
  const validateRows = (): boolean => {
    if (!selectedSupplier) {
      toast.error('请选择供应商');
      return false;
    }
    
    const validRows = rows.filter(row => 
      row.productName.trim() && 
      parseFloat(row.weight) > 0 && 
      parseFloat(row.laborCost) >= 0
    );
    
    if (validRows.length === 0) {
      toast.error('请至少填写一个有效的商品信息');
      return false;
    }
    
    return true;
  };

  // 提交入库
  const handleSubmit = async () => {
    if (!validateRows()) return;
    
    setIsSubmitting(true);
    
    try {
      const validRows = rows.filter(row => 
        row.productName.trim() && 
        parseFloat(row.weight) > 0 && 
        parseFloat(row.laborCost) >= 0
      );
      
      // 使用批量入库 API
      const batchData = {
        supplier: selectedSupplier,
        items: validRows.map(row => ({
          product_code: row.productCode || undefined,
          product_name: row.productName,
          weight: parseFloat(row.weight),
          labor_cost: parseFloat(row.laborCost),
          piece_count: row.pieceCount ? parseInt(row.pieceCount) : undefined,
          piece_labor_cost: row.pieceLaborCost ? parseFloat(row.pieceLaborCost) : undefined,
        }))
      };
      
      const response = await fetch(`${API_BASE_URL}/api/inbound-orders/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchData),
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        
        // 重置表单
        setRows([createEmptyRow()]);
        setSelectedSupplier('');
        
        onSuccess?.();
        onClose();
      } else {
        toast.error(result.message || '入库失败，请检查数据');
      }
    } catch (error) {
      console.error('入库失败:', error);
      toast.error('入库失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重置表单
  const handleClose = () => {
    setRows([createEmptyRow()]);
    setSelectedSupplier('');
    setSearchResults([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">快捷入库</h2>
              <p className="text-sm text-gray-500">批量添加商品入库</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 供应商选择 */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              供应商：
            </label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="flex-1 max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            >
              <option value="">请选择供应商</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.name}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 表格区域 */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                  序号
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">
                  商品编码
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  商品名称
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                  克重(g)
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                  克工费(元)
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-20">
                  件数
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                  件工费(元)
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">
                  总工费
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((row, index) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-500 text-center">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2 relative">
                    <input
                      type="text"
                      value={row.productCode}
                      onChange={(e) => updateRow(row.id, 'productCode', e.target.value)}
                      placeholder="编码"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                    {/* 搜索结果下拉 */}
                    {searchResults.find(r => r.rowId === row.id)?.results && (
                      <div className="absolute z-10 w-64 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                        {searchResults.find(r => r.rowId === row.id)?.results.map((pc) => (
                          <button
                            key={pc.code}
                            onClick={() => selectProductCode(row.id, pc)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2"
                          >
                            <span className="font-mono text-amber-600">{pc.code}</span>
                            <span className="text-gray-600">{pc.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.productName}
                      onChange={(e) => updateRow(row.id, 'productName', e.target.value)}
                      placeholder="商品名称"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.weight}
                      onChange={(e) => updateRow(row.id, 'weight', e.target.value)}
                      placeholder="0"
                      min="0"
                      step="0.01"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.laborCost}
                      onChange={(e) => updateRow(row.id, 'laborCost', e.target.value)}
                      placeholder="0"
                      min="0"
                      step="0.01"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.pieceCount}
                      onChange={(e) => updateRow(row.id, 'pieceCount', e.target.value)}
                      placeholder="-"
                      min="0"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.pieceLaborCost}
                      onChange={(e) => updateRow(row.id, 'pieceLaborCost', e.target.value)}
                      placeholder="-"
                      min="0"
                      step="0.01"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-sm font-semibold text-amber-600">
                      ¥{calculateRowTotal(row).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => removeRow(row.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="删除此行"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 添加行按钮 */}
          <button
            onClick={addRow}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加一行
          </button>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-lg font-semibold text-gray-900">
            合计：<span className="text-amber-600">¥{calculateTotal().toFixed(2)}</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2 text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  入库中...
                </>
              ) : (
                '确认入库'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

