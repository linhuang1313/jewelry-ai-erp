import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Package, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config';
import { parseInboundFile } from '../utils/excelImport';

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

interface InboundResult {
  order_id?: number;
  order_no?: string;
  total_count: number;
  total_weight: number;
  total_labor_cost: number;
  supplier_name: string;
  products: { name: string; weight: string; labor_cost: string; piece_count?: string; piece_labor_cost?: string }[];
}

interface QuickInboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: InboundResult) => void;
  userRole: string;
}

// 珐琅产品属性接口
interface ProductAttribute {
  id: number;
  value: string;
  sort_order: number;
}

interface ProductAttributes {
  fineness: ProductAttribute[];
  craft: ProductAttribute[];
  style: ProductAttribute[];
}

// 静态回退选项（API 失败时使用）
const FALLBACK_FINENESS = ['足金', '板料', 'S925银', '足银', '18K金', '足铂', '18K金珐琅', '旧料'];
const FALLBACK_CRAFT = ['3D硬金', '古法珐琅', '5D镶嵌', '999.9精品', '5G珐琅'];
const FALLBACK_STYLE = ['戒指', '项链', '挂坠', '手链', '手镯', '耳饰'];

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
  const [batchAddCount, setBatchAddCount] = useState<string>('10'); // 批量添加行数
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null); // 当前打开的下拉框
  const [nameSearchKeyword, setNameSearchKeyword] = useState<string>(''); // 商品名称搜索关键词
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // 珐琅产品批量生成状态
  const [showEnamelGenerator, setShowEnamelGenerator] = useState(false);
  const [enamelCodeType, setEnamelCodeType] = useState<'f' | 'fl'>('f'); // F码或FL码
  const [enamelFineness, setEnamelFineness] = useState(''); // 成色
  const [enamelCraft, setEnamelCraft] = useState(''); // 工艺
  const [enamelStyle, setEnamelStyle] = useState(''); // 款式
  const [enamelCount, setEnamelCount] = useState<string>('10');
  const [enamelWeight, setEnamelWeight] = useState<string>('');
  const [enamelLaborCost, setEnamelLaborCost] = useState<string>('');
  const [enamelPieceLaborCost, setEnamelPieceLaborCost] = useState<string>(''); // 件工费
  const [isGenerating, setIsGenerating] = useState(false);
  
  // 动态属性选项
  const [productAttributes, setProductAttributes] = useState<ProductAttributes>({
    fineness: [],
    craft: [],
    style: []
  });

  // 自动拼接商品名称
  const enamelProductName = React.useMemo(() => {
    return `${enamelFineness}${enamelCraft}${enamelStyle}`;
  }, [enamelFineness, enamelCraft, enamelStyle]);
  
  // 获取选项列表（动态优先，静态回退）
  const finenessOptions = productAttributes.fineness.length > 0 
    ? productAttributes.fineness.map(a => a.value) 
    : FALLBACK_FINENESS;
  const craftOptions = productAttributes.craft.length > 0 
    ? productAttributes.craft.map(a => a.value) 
    : FALLBACK_CRAFT;
  const styleOptions = productAttributes.style.length > 0 
    ? productAttributes.style.map(a => a.value) 
    : FALLBACK_STYLE;


  // 加载供应商列表和属性配置
  useEffect(() => {
    if (isOpen) {
      fetchSuppliers();
      fetchProductCodes();
      fetchProductAttributes();
    }
  }, [isOpen]);
  
  // 键盘快捷键：Ctrl+Enter 添加新行
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter 添加新行
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        setRows(prev => [...prev, createEmptyRow()]);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);
  
  // 获取商品属性配置
  const fetchProductAttributes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes/attributes`);
      if (response.ok) {
        const data = await response.json();
        setProductAttributes(data);
      }
    } catch (error) {
      console.error('加载商品属性失败:', error);
      // 失败时使用静态回退选项，不提示错误
    }
  };

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setOpenDropdownId(null);
      }
    };
    
    if (openDropdownId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdownId]);

  const fetchSuppliers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/suppliers`);
      if (response.ok) {
        const data = await response.json();
        // API 返回格式是 { success: true, suppliers: [...] }
        const supplierList = data.suppliers || data || [];
        setSuppliers(supplierList.filter((s: Supplier & { status: string }) => s.status === 'active'));
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
        // API 可能返回数组或 { codes: [...] } 格式
        const codeList = Array.isArray(data) ? data : (data.codes || []);
        setProductCodes(codeList);
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
    setNameSearchKeyword(''); // 清除搜索关键词
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

  const isRowEmpty = (row: InboundRow) => {
    return !row.productCode && !row.productName && !row.weight && !row.laborCost && !row.pieceCount && !row.pieceLaborCost;
  };

  // 批量添加多行
  const addMultipleRows = () => {
    const count = parseInt(batchAddCount) || 0;
    if (count <= 0) {
      toast.error('请输入有效的行数');
      return;
    }
    if (count > 500) {
      toast.error('一次最多添加500行');
      return;
    }
    const newRows = Array.from({ length: count }, () => createEmptyRow());
    setRows(prev => [...prev, ...newRows]);
    toast.success(`已添加 ${count} 行`);
  };

  const handleImportClick = () => {
    if (!selectedSupplier) {
      toast.error('请先选择供应商');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const { rows: imported, errors } = await parseInboundFile(file);
      const newRows = imported.map(item => ({
        id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productCode: item.productCode || '',
        productName: item.productName || '',
        weight: String(item.weight ?? ''),
        laborCost: String(item.laborCost ?? ''),
        pieceCount: item.pieceCount !== undefined ? String(item.pieceCount) : '',
        pieceLaborCost: item.pieceLaborCost !== undefined ? String(item.pieceLaborCost) : '',
      }));

      setRows(prev => {
        const baseRows = prev.length === 1 && isRowEmpty(prev[0]) ? [] : prev;
        return [...baseRows, ...newRows];
      });

      if (newRows.length > 0) {
        toast.success(`导入成功 ${newRows.length} 行`);
      }
      if (errors.length > 0) {
        console.warn('Excel 导入错误:', errors);
        toast.error(`有 ${errors.length} 行数据不符合要求，已跳过`);
      }
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入失败，请检查文件格式');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  // 批量生成珐琅产品编码
  const generateEnamelProducts = async () => {
    const count = parseInt(enamelCount) || 0;
    if (count <= 0) {
      toast.error('请输入有效的数量');
      return;
    }
    if (count > 500) {
      toast.error('一次最多生成500个');
      return;
    }
    if (!enamelFineness || !enamelCraft || !enamelStyle) {
      toast.error('请选择成色、工艺和款式');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      let codes: string[] = [];
      
      if (enamelCodeType === 'f') {
        // F码：每件一个唯一编码，保存到数据库确保全局唯一
        const encodedName = encodeURIComponent(enamelProductName.trim());
        const response = await fetch(`${API_BASE_URL}/api/product-codes/batch-f-codes?count=${count}&save=true&product_name=${encodedName}`);
        if (response.ok) {
          const data = await response.json();
          codes = data.codes || [];
        } else {
          throw new Error('获取F编码失败');
        }
      } else {
        // FL码：所有商品共用一个编码
        const response = await fetch(`${API_BASE_URL}/api/product-codes/next-fl-code`);
        if (response.ok) {
          const data = await response.json();
          codes = Array(count).fill(data.code);
        } else {
          throw new Error('获取FL编码失败');
        }
      }
      
      if (codes.length === 0) {
        throw new Error('未能生成编码');
      }
      
      // 创建新行
      const newRows: InboundRow[] = codes.map((code) => ({
        id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        productCode: code,
        productName: enamelProductName,
        weight: enamelWeight,
        laborCost: enamelLaborCost,
        pieceCount: '1', // 珐琅产品默认1件
        pieceLaborCost: enamelPieceLaborCost, // 使用用户输入的件工费
      }));
      
      // 添加到表格（替换空行或追加）
      setRows(prev => {
        // 如果当前只有一行且为空，则替换；否则追加
        if (prev.length === 1 && !prev[0].productName && !prev[0].productCode) {
          return newRows;
        }
        return [...prev, ...newRows];
      });
      
      toast.success(`已生成 ${codes.length} 个${enamelCodeType === 'f' ? 'F' : 'FL'}编码商品`);
      setShowEnamelGenerator(false);
      
      // 重置表单
      setEnamelFineness('');
      setEnamelCraft('');
      setEnamelStyle('');
      setEnamelCount('10');
      setEnamelWeight('');
      setEnamelLaborCost('');
    } catch (error) {
      console.error('生成珐琅编码失败:', error);
      toast.error('生成编码失败，请重试');
    } finally {
      setIsGenerating(false);
    }
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
    // 如果是商品编码字段，检查是否完全匹配已有编码，自动填充商品名称
    if (field === 'productCode') {
      const matchedCode = productCodes.find(
        pc => pc.code.toUpperCase() === value.toUpperCase()
      );
      
      if (matchedCode) {
        // 完全匹配，同时更新编码和名称
        setRows(prev => prev.map(row => 
          row.id === id ? { ...row, productCode: matchedCode.code, productName: matchedCode.name } : row
        ));
      } else {
        // 不匹配，只更新编码
        setRows(prev => prev.map(row => 
          row.id === id ? { ...row, [field]: value } : row
        ));
      }
      searchProductCode(id, value);
    } else {
      setRows(prev => prev.map(row => 
        row.id === id ? { ...row, [field]: value } : row
      ));
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
      // 注意：selectedSupplier 已经是供应商名称了（select 的 value 是 supplier.name）
      const batchData = {
        supplier: selectedSupplier,  // 直接使用选中的供应商名称
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
        
        // 计算总工费
        const totalLaborCost = validRows.reduce((sum, row) => {
          const weight = parseFloat(row.weight || '0');
          const laborCost = parseFloat(row.laborCost || '0');
          const pieceCount = parseInt(row.pieceCount || '0');
          const pieceLaborCost = parseFloat(row.pieceLaborCost || '0');
          return sum + (weight * laborCost) + (pieceCount * pieceLaborCost);
        }, 0);
        
        // 调用成功回调，传递入库详情
        // 注意：新的批量入库返回 order_id 和 order_no 在根级别
        onSuccess?.({
          order_id: result.order_id,
          order_no: result.order_no,
          total_count: result.success_count || batchData.items.length,
          total_weight: result.total_weight || batchData.items.reduce((sum, item) => sum + item.weight, 0),
          total_labor_cost: result.total_cost || totalLaborCost,
          supplier_name: batchData.supplier,
          products: batchData.items.map(item => ({ 
            name: item.product_name, 
            weight: String(item.weight), 
            labor_cost: String(item.labor_cost),
            piece_count: item.piece_count ? String(item.piece_count) : '',
            piece_labor_cost: item.piece_labor_cost ? String(item.piece_labor_cost) : ''
          }))
        });
        
        // 重置表单
        setRows([createEmptyRow()]);
        setSelectedSupplier('');
        
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
                  <td className="px-3 py-2 relative dropdown-container">
                    <div className="relative">
                      <input
                        type="text"
                        value={row.productCode}
                        onChange={(e) => {
                          updateRow(row.id, 'productCode', e.target.value);
                          searchProductCode(row.id, e.target.value);
                        }}
                        onFocus={() => setOpenDropdownId(row.id)}
                        placeholder="点击选择"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500 cursor-pointer"
                      />
                      {/* 下拉箭头 */}
                      <button
                        onClick={() => setOpenDropdownId(openDropdownId === row.id ? null : row.id)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                      >
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* 下拉选择框 */}
                    {openDropdownId === row.id && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-auto">
                        {/* 搜索过滤后的结果 */}
                        {(row.productCode.trim() 
                          ? productCodes.filter(pc => 
                              pc.code.toUpperCase().includes(row.productCode.toUpperCase()) ||
                              pc.name.includes(row.productCode)
                            )
                          : productCodes
                        ).slice(0, 20).map((pc) => (
                          <button
                            key={pc.code}
                            onClick={() => {
                              selectProductCode(row.id, pc);
                              setOpenDropdownId(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2 border-b border-gray-50 last:border-b-0"
                          >
                            <span className="font-mono text-amber-600 font-medium min-w-[60px]">{pc.code}</span>
                            <span className="text-gray-700 truncate">{pc.name}</span>
                          </button>
                        ))}
                        {productCodes.length === 0 && (
                          <div className="px-3 py-4 text-center text-gray-400 text-sm">
                            暂无商品编码
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 relative dropdown-container">
                    <div className="relative">
                      {/* 可输入筛选的下拉选择框 */}
                      <input
                        type="text"
                        value={row.productName}
                        onChange={(e) => {
                          updateRow(row.id, 'productName', e.target.value);
                          setOpenDropdownId(`name-${row.id}`);
                        }}
                        onFocus={() => setOpenDropdownId(`name-${row.id}`)}
                        placeholder="输入筛选或点击选择"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500 text-gray-900 placeholder:text-gray-400"
                      />
                      {/* 下拉箭头 */}
                      <button
                        type="button"
                        onClick={() => {
                          if (openDropdownId === `name-${row.id}`) {
                            setOpenDropdownId(null);
                          } else {
                            setOpenDropdownId(`name-${row.id}`);
                          }
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                      >
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* 商品名称下拉选择框 */}
                    {openDropdownId === `name-${row.id}` && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-auto min-w-[200px]">
                        {(row.productName.trim() 
                          ? productCodes.filter(pc => 
                              pc.name.includes(row.productName) ||
                              pc.code.toUpperCase().includes(row.productName.toUpperCase())
                            )
                          : productCodes
                        ).slice(0, 20).map((pc) => (
                          <button
                            key={pc.code}
                            type="button"
                            onClick={() => {
                              selectProductCode(row.id, pc);
                              setOpenDropdownId(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2 border-b border-gray-50 last:border-b-0"
                          >
                            <span className="text-gray-700">{pc.name}</span>
                            <span className="font-mono text-amber-600 text-xs">({pc.code})</span>
                          </button>
                        ))}
                        {productCodes.length === 0 && (
                          <div className="px-3 py-4 text-center text-gray-400 text-sm">
                            暂无商品编码，请在编码管理中新建
                          </div>
                        )}
                        {productCodes.length > 0 && row.productName.trim() && 
                          productCodes.filter(pc => 
                            pc.name.includes(row.productName) ||
                            pc.code.toUpperCase().includes(row.productName.toUpperCase())
                          ).length === 0 && (
                          <div className="px-3 py-4 text-center text-gray-400 text-sm">
                            未找到匹配的商品
                          </div>
                        )}
                      </div>
                    )}
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

          {/* 添加行按钮区域 */}
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            {/* 添加单行 */}
            <button
              onClick={addRow}
              className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              添加一行
            </button>
            
            {/* 分隔线 */}
            <div className="h-6 w-px bg-gray-300"></div>
            
            {/* 批量添加 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">批量添加：</span>
              <input
                type="number"
                value={batchAddCount}
                onChange={(e) => setBatchAddCount(e.target.value)}
                min="1"
                max="500"
                className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
              />
              <span className="text-sm text-gray-600">行</span>
              <button
                onClick={addMultipleRows}
                className="px-3 py-1.5 text-sm text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors"
              >
                确定
              </button>
            </div>
            
            {/* 分隔线 */}
            <div className="h-6 w-px bg-gray-300"></div>
            
            {/* Excel/CSV 导入 */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                onClick={handleImportClick}
                disabled={isImporting}
                title="模板表头：商品编码/商品名称/克重(g)/克工费(元)/件数/件工费(元)/备注"
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${
                  isImporting
                    ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'text-blue-600 border-blue-300 hover:bg-blue-50'
                }`}
              >
                {isImporting ? '导入中...' : '导入Excel/CSV'}
              </button>
            </div>

            {/* 分隔线 */}
            <div className="h-6 w-px bg-gray-300"></div>

            {/* 珐琅产品批量生成按钮 */}
            <button
              onClick={() => setShowEnamelGenerator(!showEnamelGenerator)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                showEnamelGenerator 
                  ? 'text-white bg-purple-500 hover:bg-purple-600' 
                  : 'text-purple-600 hover:bg-purple-50 border border-purple-300'
              }`}
            >
              <span>🎨</span>
              珐琅编码批量生成
            </button>
            
            {/* 当前行数显示 */}
            <div className="ml-auto text-sm text-gray-500">
              当前共 {rows.length} 行
            </div>
          </div>
          
          {/* 珐琅产品批量生成面板 */}
          {showEnamelGenerator && (
            <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
              <h4 className="text-sm font-semibold text-purple-800 mb-3 flex items-center gap-2">
                🎨 珐琅产品批量生成
              </h4>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                {/* 编码类型选择 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">编码类型</label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEnamelCodeType('f')}
                      className={`flex-1 px-2 py-2 text-xs rounded-lg transition-colors ${
                        enamelCodeType === 'f'
                          ? 'bg-purple-500 text-white'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      F码
                    </button>
                    <button
                      onClick={() => setEnamelCodeType('fl')}
                      className={`flex-1 px-2 py-2 text-xs rounded-lg transition-colors ${
                        enamelCodeType === 'fl'
                          ? 'bg-purple-500 text-white'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      FL码
                    </button>
                  </div>
                </div>
                
                {/* 成色下拉框 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">成色 *</label>
                  <select
                    value={enamelFineness}
                    onChange={(e) => setEnamelFineness(e.target.value)}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  >
                    <option value="">请选择</option>
                    {finenessOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                
                {/* 工艺下拉框 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">工艺 *</label>
                  <select
                    value={enamelCraft}
                    onChange={(e) => setEnamelCraft(e.target.value)}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  >
                    <option value="">请选择</option>
                    {craftOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                
                {/* 款式下拉框 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">款式 *</label>
                  <select
                    value={enamelStyle}
                    onChange={(e) => setEnamelStyle(e.target.value)}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  >
                    <option value="">请选择</option>
                    {styleOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                
                {/* 数量 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">数量 *</label>
                  <input
                    type="number"
                    value={enamelCount}
                    onChange={(e) => setEnamelCount(e.target.value)}
                    min="1"
                    max="500"
                    placeholder="10"
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                
                {/* 克重 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">单件克重(g)</label>
                  <input
                    type="number"
                    value={enamelWeight}
                    onChange={(e) => setEnamelWeight(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="可选"
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                
                {/* 克工费 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">克工费(元)</label>
                  <input
                    type="number"
                    value={enamelLaborCost}
                    onChange={(e) => setEnamelLaborCost(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="可选"
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                
                {/* 件工费 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">件工费(元)</label>
                  <input
                    type="number"
                    value={enamelPieceLaborCost}
                    onChange={(e) => setEnamelPieceLaborCost(e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="可选"
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>
              
              {/* 显示拼接后的商品名称预览 */}
              {(enamelFineness || enamelCraft || enamelStyle) && (
                <div className="mt-3 p-2 bg-white rounded-lg border border-purple-200">
                  <span className="text-xs text-gray-500">商品名称预览：</span>
                  <span className="ml-2 text-sm font-medium text-purple-700">{enamelProductName || '（请选择成色、工艺和款式）'}</span>
                </div>
              )}
              
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {enamelCodeType === 'f' 
                    ? `将生成 ${enamelCount || 0} 个唯一F编码（F00000001, F00000002, ...），每件商品一个编码` 
                    : `将生成 ${enamelCount || 0} 行，共用一个FL编码（适合同款批量产品）`}
                </p>
                <button
                  onClick={generateEnamelProducts}
                  disabled={isGenerating}
                  className="px-4 py-2 text-sm text-white bg-purple-500 hover:bg-purple-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>生成并填充到表格</>
                  )}
                </button>
              </div>
            </div>
          )}
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

