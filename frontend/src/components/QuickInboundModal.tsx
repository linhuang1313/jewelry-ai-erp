import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Package, Search, Gem } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config';
import { parseInboundFile } from '../utils/excelImport';
import { parseInlayInboundFile } from '../utils/inlayExcelImport';

interface InboundRow {
  id: string;
  productCode: string;
  productName: string;
  weight: string;
  laborCost: string;
  pieceCount: string;
  pieceLaborCost: string;
  // 镶嵌入库相关字段
  mainStoneWeight?: string;
  mainStoneCount?: string;
  mainStonePrice?: string;
  mainStoneAmount?: string;
  subStoneWeight?: string;
  subStoneCount?: string;
  subStonePrice?: string;
  subStoneAmount?: string;
  stoneSettingFee?: string;
  totalAmount?: string;
  mainStoneMark?: string;
  subStoneMark?: string;
  pearlWeight?: string;
  bearingWeight?: string;
  saleLaborCost?: string;
  salePieceLaborCost?: string;
  manualLaborCostTotal?: string; // 手动输入的总工费（镶嵌模式用）
  errors?: Partial<Record<'productCode' | 'productName' | 'weight' | 'laborCost' | 'pieceCount' | 'pieceLaborCost', string>>;
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

const CACHE_TTL_MS = 5 * 60 * 1000;
const SUPPLIER_CACHE_KEY = 'quick_inbound_suppliers_cache_v1';
const PRODUCT_CODE_CACHE_KEY = 'quick_inbound_product_codes_cache_v1';
const PRODUCT_ATTR_CACHE_KEY = 'quick_inbound_product_attrs_cache_v1';

const getCachedData = (key: string) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp || Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
};

const setCachedData = (key: string, data: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // 忽略缓存写入失败
  }
};

const createEmptyRow = (): InboundRow => ({
  id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  productCode: '',
  productName: '',
  weight: '',
  laborCost: '',
  pieceCount: '',
  pieceLaborCost: '',
  errors: {},
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
  const [isImportingInlay, setIsImportingInlay] = useState(false);
  const [isInlayMode, setIsInlayMode] = useState(false); // 镶嵌入库模式
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inlayFileInputRef = useRef<HTMLInputElement | null>(null);
  
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
      const delayedLoad = setTimeout(() => {
        fetchProductCodes();
        fetchProductAttributes();
      }, 300);
      return () => clearTimeout(delayedLoad);
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
  const fetchProductAttributes = async (force = false) => {
    if (!force) {
      const cached = getCachedData(PRODUCT_ATTR_CACHE_KEY);
      if (cached) {
        setProductAttributes(cached as ProductAttributes);
      }
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes/attributes`);
      if (response.ok) {
        const data = await response.json();
        setProductAttributes(data);
        setCachedData(PRODUCT_ATTR_CACHE_KEY, data);
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

  const fetchSuppliers = async (force = false) => {
    if (!force) {
      const cached = getCachedData(SUPPLIER_CACHE_KEY);
      if (cached) {
        setSuppliers(cached as Supplier[]);
      }
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/suppliers`);
      if (response.ok) {
        const data = await response.json();
        // API 返回格式是 { success: true, suppliers: [...] }
        const supplierList = data.suppliers || data || [];
        const activeSuppliers = supplierList.filter((s: Supplier & { status: string }) => s.status === 'active');
        setSuppliers(activeSuppliers);
        setCachedData(SUPPLIER_CACHE_KEY, activeSuppliers);
      }
    } catch (error) {
      console.error('加载供应商失败:', error);
    }
  };

  const fetchProductCodes = async (force = false) => {
    if (!force) {
      const cached = getCachedData(PRODUCT_CODE_CACHE_KEY);
      if (cached) {
        setProductCodes(cached as ProductCode[]);
      }
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/product-codes`);
      if (response.ok) {
        const data = await response.json();
        // API 可能返回数组或 { codes: [...] } 格式
        const codeList = Array.isArray(data) ? data : (data.codes || []);
        setProductCodes(codeList);
        setCachedData(PRODUCT_CODE_CACHE_KEY, codeList);
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

  // 计算单行总工费（普通模式）
  const calculateRowTotal = (row: InboundRow): number => {
    const weight = parseFloat(row.weight) || 0;
    const laborCost = parseFloat(row.laborCost) || 0;
    const pieceCount = parseFloat(row.pieceCount) || 0;
    const pieceLaborCost = parseFloat(row.pieceLaborCost) || 0;
    
    return weight * laborCost + pieceCount * pieceLaborCost;
  };

  // 计算单行总工费（镶嵌模式）：重量*克工费 + 件工费 + 主石额 + 副石额 + 镶石费
  const calculateInlayRowTotal = (row: InboundRow): number => {
    const weight = parseFloat(row.weight) || 0;
    const laborCost = parseFloat(row.laborCost) || 0;
    const pieceLaborCost = parseFloat(row.pieceLaborCost) || 0;
    const mainStoneAmount = parseFloat(row.mainStoneAmount || '0') || 0;
    const subStoneAmount = parseFloat(row.subStoneAmount || '0') || 0;
    const stoneSettingFee = parseFloat(row.stoneSettingFee || '0') || 0;
    
    return weight * laborCost + pieceLaborCost + mainStoneAmount + subStoneAmount + stoneSettingFee;
  };

  // 计算合计
  const calculateTotal = (): number => {
    if (isInlayMode) {
      // 镶嵌模式：自动计算
      return rows.reduce((sum, row) => sum + calculateInlayRowTotal(row), 0);
    }
    // 普通模式：自动计算
    return rows.reduce((sum, row) => sum + calculateRowTotal(row), 0);
  };

  // 添加新行
  const addRow = () => {
    setRows(prev => [...prev, createEmptyRow()]);
  };

  const isRowEmpty = (row: InboundRow) => {
    return !row.productCode && !row.productName && !row.weight && !row.laborCost && !row.pieceCount && !row.pieceLaborCost;
  };

  const getRowErrors = (row: InboundRow) => {
    const errors: InboundRow['errors'] = {};
    if (isRowEmpty(row)) return errors;

    if (!row.productName.trim()) {
      errors.productName = '商品名称不能为空';
    }

    const weight = parseFloat(row.weight);
    if (Number.isNaN(weight) || weight <= 0) {
      errors.weight = isInlayMode ? '重量必须大于 0' : '克重必须大于 0';
    }

    const laborCost = parseFloat(row.laborCost);
    if (Number.isNaN(laborCost) || laborCost < 0) {
      errors.laborCost = '克工费必须大于等于 0';
    }

    if (row.pieceCount) {
      const pieceCount = parseFloat(row.pieceCount);
      if (Number.isNaN(pieceCount) || pieceCount < 0) {
        errors.pieceCount = '件数必须大于等于 0';
      }
    }

    if (row.pieceLaborCost) {
      const pieceLaborCost = parseFloat(row.pieceLaborCost);
      if (Number.isNaN(pieceLaborCost) || pieceLaborCost < 0) {
        errors.pieceLaborCost = '件工费必须大于等于 0';
      }
    }

    return errors;
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
      
      // 第一步：处理每行数据，标记需要生成新编码的行
      const rowsWithCodeStatus = imported.map(item => {
        let productCode = item.data.productCode || '';
        let needsNewCode = false;
        
        if (!productCode && item.data.productName) {
          const matchedCode = productCodes.find(
            pc => pc.name === item.data.productName.trim()
          );
          if (matchedCode) {
            productCode = matchedCode.code;
          } else {
            needsNewCode = true;
          }
        } else if (!productCode) {
          needsNewCode = true;
        }
        
        return { item, productCode, needsNewCode };
      });
      
      // 第二步：批量获取新编码
      const needNewCodeCount = rowsWithCodeStatus.filter(r => r.needsNewCode).length;
      let newCodes: string[] = [];
      
      if (needNewCodeCount > 0) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/product-codes/batch-f-codes?count=${needNewCodeCount}&save=true&product_name=${encodeURIComponent('快捷入库产品')}`);
          if (response.ok) {
            const data = await response.json();
            newCodes = data.codes || [];
          }
        } catch (err) {
          console.error('获取新编码失败:', err);
        }
      }
      
      // 第三步：分配新编码并创建行数据
      let newCodeIndex = 0;
      const newRows = rowsWithCodeStatus.map(({ item, productCode, needsNewCode }) => {
        let finalCode = productCode;
        if (needsNewCode && newCodeIndex < newCodes.length) {
          finalCode = newCodes[newCodeIndex];
          newCodeIndex++;
        }
        
        return {
          id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          productCode: finalCode,
          productName: item.data.productName || '',
          weight: String(item.data.weight ?? ''),
          laborCost: String(item.data.laborCost ?? ''),
          pieceCount: item.data.pieceCount !== undefined ? String(item.data.pieceCount) : '',
          pieceLaborCost: item.data.pieceLaborCost !== undefined ? String(item.data.pieceLaborCost) : '',
          errors: item.errors,
        };
      });

      setRows(prev => {
        const baseRows = prev.length === 1 && isRowEmpty(prev[0]) ? [] : prev;
        return [...baseRows, ...newRows];
      });

      if (newRows.length > 0) {
        const newCodeMsg = needNewCodeCount > 0 ? `（自动生成 ${newCodes.length} 个新编码）` : '';
        toast.success(`导入成功 ${newRows.length} 行${newCodeMsg}`);
      }
      if (errors.length > 0) {
        console.warn('Excel 导入错误:', errors);
        toast.error(`导入发现 ${errors.length} 个表头问题，请在预览中修正`);
      }
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入失败，请检查文件格式');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  // 镶嵌入库导入
  const handleInlayImportClick = () => {
    if (!selectedSupplier) {
      toast.error('请先选择供应商');
      return;
    }
    inlayFileInputRef.current?.click();
  };

  const handleInlayImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingInlay(true);
    try {
      const { rows: imported, errors } = await parseInlayInboundFile(file);
      
      // 第一步：处理每行数据，标记需要生成新编码的行
      const rowsWithCodeStatus = imported.map(item => {
        let productCode = item.data.productCode || '';
        let needsNewCode = false;
        
        if (!productCode && item.data.productName) {
          // 尝试根据商品名称匹配已有编码
          const matchedCode = productCodes.find(
            pc => pc.name === item.data.productName.trim()
          );
          if (matchedCode) {
            productCode = matchedCode.code;
          } else {
            // 没有匹配到，需要生成新编码
            needsNewCode = true;
          }
        } else if (!productCode) {
          // 没有编码也没有名称，也需要生成新编码
          needsNewCode = true;
        }
        
        return { item, productCode, needsNewCode };
      });
      
      // 第二步：统计需要生成新编码的数量，批量获取
      const needNewCodeCount = rowsWithCodeStatus.filter(r => r.needsNewCode).length;
      let newCodes: string[] = [];
      
      if (needNewCodeCount > 0) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/product-codes/batch-f-codes?count=${needNewCodeCount}&save=true&product_name=${encodeURIComponent('镶嵌产品')}`);
          if (response.ok) {
            const data = await response.json();
            newCodes = data.codes || [];
          }
        } catch (err) {
          console.error('获取新编码失败:', err);
        }
      }
      
      // 第三步：分配新编码并创建行数据
      let newCodeIndex = 0;
      const newRows = rowsWithCodeStatus.map(({ item, productCode, needsNewCode }) => {
        let finalCode = productCode;
        if (needsNewCode && newCodeIndex < newCodes.length) {
          finalCode = newCodes[newCodeIndex];
          newCodeIndex++;
        }
        
        return {
          id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          productCode: finalCode,
          productName: item.data.productName || '',
          weight: String(item.data.weight ?? ''),
          laborCost: String(item.data.laborCost ?? ''),
          pieceCount: item.data.pieceCount !== undefined ? String(item.data.pieceCount) : '',
          pieceLaborCost: item.data.pieceLaborCost !== undefined ? String(item.data.pieceLaborCost) : '',
          // 镶嵌相关字段
          mainStoneWeight: item.data.mainStoneWeight !== undefined ? String(item.data.mainStoneWeight) : undefined,
          mainStoneCount: item.data.mainStoneCount !== undefined ? String(item.data.mainStoneCount) : undefined,
          mainStonePrice: item.data.mainStonePrice !== undefined ? String(item.data.mainStonePrice) : undefined,
          mainStoneAmount: item.data.mainStoneAmount !== undefined ? String(item.data.mainStoneAmount) : undefined,
          subStoneWeight: item.data.subStoneWeight !== undefined ? String(item.data.subStoneWeight) : undefined,
          subStoneCount: item.data.subStoneCount !== undefined ? String(item.data.subStoneCount) : undefined,
          subStonePrice: item.data.subStonePrice !== undefined ? String(item.data.subStonePrice) : undefined,
          subStoneAmount: item.data.subStoneAmount !== undefined ? String(item.data.subStoneAmount) : undefined,
          stoneSettingFee: item.data.stoneSettingFee !== undefined ? String(item.data.stoneSettingFee) : undefined,
          totalAmount: item.data.totalAmount !== undefined ? String(item.data.totalAmount) : undefined,
          mainStoneMark: item.data.mainStoneMark,
          subStoneMark: item.data.subStoneMark,
          pearlWeight: item.data.pearlWeight !== undefined ? String(item.data.pearlWeight) : undefined,
          bearingWeight: item.data.bearingWeight !== undefined ? String(item.data.bearingWeight) : undefined,
          saleLaborCost: item.data.saleLaborCost !== undefined ? String(item.data.saleLaborCost) : undefined,
          salePieceLaborCost: item.data.salePieceLaborCost !== undefined ? String(item.data.salePieceLaborCost) : undefined,
          manualLaborCostTotal: '', // 总工费留空，用户手动输入
          errors: item.errors,
        };
      });

      setRows(prev => {
        const baseRows = prev.length === 1 && isRowEmpty(prev[0]) ? [] : prev;
        return [...baseRows, ...newRows];
      });

      if (newRows.length > 0) {
        setIsInlayMode(true); // 切换到镶嵌入库模式
        const newCodeMsg = needNewCodeCount > 0 ? `（自动生成 ${newCodes.length} 个新编码）` : '';
        toast.success(`镶嵌入库导入成功 ${newRows.length} 行${newCodeMsg}`);
      }
      if (errors.length > 0) {
        console.warn('镶嵌入库导入错误:', errors);
        toast.error(`导入发现 ${errors.length} 个表头问题，请在预览中修正`);
      }
    } catch (error) {
      console.error('镶嵌入库导入失败:', error);
      toast.error('导入失败，请检查文件格式');
    } finally {
      setIsImportingInlay(false);
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
        setRows(prev => prev.map(row => {
          if (row.id !== id) return row;
          const next = { ...row, productCode: matchedCode.code, productName: matchedCode.name };
          return { ...next, errors: getRowErrors(next) };
        }));
      } else {
        // 不匹配，只更新编码
        setRows(prev => prev.map(row => {
          if (row.id !== id) return row;
          const next = { ...row, [field]: value } as InboundRow;
          return { ...next, errors: getRowErrors(next) };
        }));
      }
      searchProductCode(id, value);
    } else if (field === 'productName') {
      // 如果是商品名称字段，检查是否完全匹配已有编码的名称，自动填充商品编码
      const matchedCode = productCodes.find(
        pc => pc.name === value.trim()
      );
      
      if (matchedCode) {
        // 完全匹配，同时更新名称和编码
        setRows(prev => prev.map(row => {
          if (row.id !== id) return row;
          const next = { ...row, productName: value, productCode: matchedCode.code };
          return { ...next, errors: getRowErrors(next) };
        }));
      } else {
        // 不匹配，只更新名称
        setRows(prev => prev.map(row => {
          if (row.id !== id) return row;
          const next = { ...row, [field]: value } as InboundRow;
          return { ...next, errors: getRowErrors(next) };
        }));
      }
    } else {
      setRows(prev => prev.map(row => {
        if (row.id !== id) return row;
        const next = { ...row, [field]: value } as InboundRow;
        return { ...next, errors: getRowErrors(next) };
      }));
    }
  };

  // 验证数据
  const validateRows = (): { ok: boolean; validRows: InboundRow[] } => {
    if (!selectedSupplier) {
      toast.error('请选择供应商');
      return { ok: false, validRows: [] };
    }

    const updatedRows = rows.map(row => ({ ...row, errors: getRowErrors(row) }));
    setRows(updatedRows);

    const hasErrors = updatedRows.some(row => row.errors && Object.keys(row.errors).length > 0);
    const validRows = updatedRows.filter(row => !isRowEmpty(row) && (!row.errors || Object.keys(row.errors).length === 0));

    if (hasErrors) {
      toast.error('请先修正标红项后再提交');
      return { ok: false, validRows: [] };
    }

    if (validRows.length === 0) {
      toast.error('请至少填写一个有效的商品信息');
      return { ok: false, validRows: [] };
    }

    return { ok: true, validRows };
  };

  // 提交入库
  const handleSubmit = async () => {
    const validation = validateRows();
    if (!validation.ok) return;
    
    setIsSubmitting(true);
    
    try {
      const validRows = validation.validRows;
      
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
          // 镶嵌入库相关字段
          main_stone_weight: row.mainStoneWeight ? parseFloat(row.mainStoneWeight) : undefined,
          main_stone_count: row.mainStoneCount ? parseInt(row.mainStoneCount) : undefined,
          main_stone_price: row.mainStonePrice ? parseFloat(row.mainStonePrice) : undefined,
          main_stone_amount: row.mainStoneAmount ? parseFloat(row.mainStoneAmount) : undefined,
          sub_stone_weight: row.subStoneWeight ? parseFloat(row.subStoneWeight) : undefined,
          sub_stone_count: row.subStoneCount ? parseInt(row.subStoneCount) : undefined,
          sub_stone_price: row.subStonePrice ? parseFloat(row.subStonePrice) : undefined,
          sub_stone_amount: row.subStoneAmount ? parseFloat(row.subStoneAmount) : undefined,
          stone_setting_fee: row.stoneSettingFee ? parseFloat(row.stoneSettingFee) : undefined,
          total_amount: row.totalAmount ? parseFloat(row.totalAmount) : undefined,
          main_stone_mark: row.mainStoneMark || undefined,
          sub_stone_mark: row.subStoneMark || undefined,
          pearl_weight: row.pearlWeight ? parseFloat(row.pearlWeight) : undefined,
          bearing_weight: row.bearingWeight ? parseFloat(row.bearingWeight) : undefined,
          sale_labor_cost: row.saleLaborCost ? parseFloat(row.saleLaborCost) : undefined,
          sale_piece_labor_cost: row.salePieceLaborCost ? parseFloat(row.salePieceLaborCost) : undefined,
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
        setIsInlayMode(false);
        
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
    setIsInlayMode(false);
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
          <table className={`border-collapse ${isInlayMode ? 'min-w-[2000px]' : 'w-full'}`}>
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                  序号
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">
                  商品编码
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider min-w-[150px]">
                  商品名称
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                  {isInlayMode ? '重量' : '克重(g)'}
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
                {/* 镶嵌入库模式额外列 */}
                {isInlayMode && (
                  <>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">主石重</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">主石粒数</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">主石单价</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">主石额</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">副石重</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">副石粒数</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">副石单价</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">副石额</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">镶石费</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">总金额</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">主石字印</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">副石字印</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">珍珠重</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-20">轴承重</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-24">销售克工费</th>
                    <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 tracking-wider w-24">销售件工费</th>
                  </>
                )}
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
                        className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 cursor-pointer ${
                          row.errors?.productCode
                            ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                            : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                        }`}
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
                        className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 text-gray-900 placeholder:text-gray-400 ${
                          row.errors?.productName
                            ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                            : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                        }`}
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
                      className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 ${
                        row.errors?.weight
                          ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                          : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                      }`}
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
                      className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 ${
                        row.errors?.laborCost
                          ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                          : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                      }`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={row.pieceCount}
                      onChange={(e) => updateRow(row.id, 'pieceCount', e.target.value)}
                      placeholder="-"
                      min="0"
                      className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 ${
                        row.errors?.pieceCount
                          ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                          : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                      }`}
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
                      className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 ${
                        row.errors?.pieceLaborCost
                          ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
                          : 'border-gray-300 focus:ring-amber-500 focus:border-amber-500'
                      }`}
                    />
                  </td>
                  {/* 镶嵌入库模式额外数据列 */}
                  {isInlayMode && (
                    <>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.mainStoneWeight || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.mainStoneCount || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.mainStonePrice || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.mainStoneAmount || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.subStoneWeight || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.subStoneCount || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.subStonePrice || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.subStoneAmount || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.stoneSettingFee || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.totalAmount || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.mainStoneMark || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.subStoneMark || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.pearlWeight || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.bearingWeight || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.saleLaborCost || '-'}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-sm text-gray-600">{row.salePieceLaborCost || '-'}</span>
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right">
                    <span className="text-sm font-semibold text-amber-600">
                      ¥{isInlayMode ? calculateInlayRowTotal(row).toFixed(2) : calculateRowTotal(row).toFixed(2)}
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
                    {row.errors && Object.keys(row.errors).length > 0 && (
                      <div className="mt-1 text-xs text-red-500 text-left">
                        {Object.values(row.errors).filter(Boolean).join('；')}
                      </div>
                    )}
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

            {/* 镶嵌入库导入 */}
            <div className="flex items-center gap-2">
              <input
                ref={inlayFileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleInlayImportFile}
              />
              <button
                onClick={handleInlayImportClick}
                disabled={isImportingInlay}
                title="镶嵌入库模板：品名(可拼接)/件数/重量/克工费/件工费/主石重/主石粒数/主石单价/主石额/副石重/副石粒数/副石单价/副石额/镶石费/总金额等"
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors border ${
                  isImportingInlay
                    ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'text-emerald-600 border-emerald-300 hover:bg-emerald-50'
                }`}
              >
                <Gem className="w-4 h-4" />
                {isImportingInlay ? '导入中...' : '镶嵌入库'}
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

