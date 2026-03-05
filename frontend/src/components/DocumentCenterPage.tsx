import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, FileText, Calendar, Filter, RefreshCw, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface DocumentType {
  type: string;
  name: string;
}

interface Document {
  id: number;
  order_no: string;
  doc_type: string;
  doc_type_name: string;
  date: string | null;
  status?: string;
  total_amount?: number;
  total_weight?: number;
  customer_name?: string;
  supplier_name?: string;
  payment_method?: string;
  return_type?: string;
  product_name?: string;
  weight?: number;
  unpaid_amount?: number;
}

interface DocumentCenterPageProps {
  userRole: string;
}

export const DocumentCenterPage: React.FC<DocumentCenterPageProps> = ({ userRole }) => {
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // 获取可用的单据类型
  const fetchDocumentTypes = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/types?user_role=${userRole}`);
      const data = await response.json();
      if (data.success) {
        setDocumentTypes(data.document_types);
        if (data.document_types.length > 0 && !selectedType) {
          setSelectedType(data.document_types[0].type);
        }
      }
    } catch (error) {
      console.error('获取单据类型失败:', error);
    }
  }, [userRole, selectedType]);

  // 搜索单据
  const searchDocuments = useCallback(async () => {
    if (!selectedType) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        doc_type: selectedType,
        user_role: userRole,
        skip: ((currentPage - 1) * pageSize).toString(),
        limit: pageSize.toString(),
      });
      
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (keyword) params.append('keyword', keyword);
      
      const response = await fetch(`${API_BASE_URL}/api/documents/search?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setDocuments(data.documents);
        setTotal(data.total);
      } else {
        toast.error(data.message || '查询失败');
      }
    } catch (error) {
      console.error('查询单据失败:', error);
      toast.error('查询单据失败');
    } finally {
      setLoading(false);
    }
  }, [selectedType, startDate, endDate, keyword, userRole, currentPage]);

  // 下载单据
  const downloadDocument = async (doc: Document, format: string = 'pdf', subType?: string) => {
    try {
      const params = new URLSearchParams({
        doc_type: doc.doc_type,
        doc_id: doc.id.toString(),
        format,
      });
      if (subType) params.append('sub_type', subType);
      
      const response = await fetch(`${API_BASE_URL}/api/documents/download-url?${params}`);
      const data = await response.json();
      
      if (data.success) {
        // 打开下载链接
        window.open(`${API_BASE_URL}${data.download_url}`, '_blank');
      } else {
        toast.error(data.message || '获取下载链接失败');
      }
    } catch (error) {
      console.error('下载单据失败:', error);
      toast.error('下载单据失败');
    }
  };

  useEffect(() => {
    fetchDocumentTypes();
  }, [fetchDocumentTypes]);

  useEffect(() => {
    if (selectedType) {
      searchDocuments();
    }
  }, [selectedType, currentPage]);

  const handleSearch = () => {
    setCurrentPage(1);
    searchDocuments();
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    setKeyword('');
    setCurrentPage(1);
    searchDocuments();
  };

  const totalPages = Math.ceil(total / pageSize);

  // 获取状态显示
  const getStatusDisplay = (status: string | undefined) => {
    const statusMap: Record<string, { text: string; color: string }> = {
      'pending': { text: '待处理', color: 'bg-yellow-100 text-yellow-800' },
      'confirmed': { text: '已确认', color: 'bg-green-100 text-green-800' },
      'completed': { text: '已完成', color: 'bg-blue-100 text-blue-800' },
      'cancelled': { text: '已取消', color: 'bg-gray-100 text-gray-800' },
      'unpaid': { text: '未付款', color: 'bg-red-100 text-red-800' },
      'partial': { text: '部分付款', color: 'bg-orange-100 text-orange-800' },
      'paid': { text: '已付款', color: 'bg-green-100 text-green-800' },
      'borrowed': { text: '已借出', color: 'bg-purple-100 text-purple-800' },
      'returned': { text: '已归还', color: 'bg-green-100 text-green-800' },
    };
    
    if (!status) return null;
    const display = statusMap[status] || { text: status, color: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${display.color}`}>
        {display.text}
      </span>
    );
  };

  // 获取下载选项
  const getDownloadOptions = (doc: Document) => {
    const options: { label: string; subType?: string }[] = [];
    
    switch (doc.doc_type) {
      case 'inbound':
        options.push({ label: '下载入库单', subType: 'inbound' });
        options.push({ label: '下载采购单', subType: 'purchase' });
        break;
      case 'return':
        options.push({ label: '下载退货单', subType: 'return' });
        options.push({ label: '下载退库单', subType: 'stock_out' });
        options.push({ label: '下载采购退货单', subType: 'purchase_return' });
        break;
      default:
        options.push({ label: '下载PDF' });
    }
    
    return options;
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-amber-600" />
            单据查询中心
          </h1>
          <p className="text-gray-500 mt-1">统一查询和管理各类单据</p>
        </div>

        {/* 筛选区域 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* 单据类型选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单据类型</label>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              >
                {documentTypes.map((type) => (
                  <option key={type.type} value={type.type}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 开始日期 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>

            {/* 结束日期 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>

            {/* 单号搜索 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单号搜索</label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入单号..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>

            {/* 按钮 */}
            <div className="flex items-end gap-2">
              <button
                onClick={handleSearch}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                查询
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 结果区域 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {/* 表头 */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              共 <span className="font-semibold text-gray-900">{total}</span> 条记录
            </div>
          </div>

          {/* 表格 */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">单号</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">详情</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center gap-2 text-gray-500">
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        加载中...
                      </div>
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={`${doc.doc_type}-${doc.id}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-medium text-gray-900">{doc.order_no}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">{doc.doc_type_name}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {doc.date ? new Date(doc.date).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {doc.customer_name && <span>客户: {doc.customer_name}</span>}
                        {doc.supplier_name && <span>供应商: {doc.supplier_name}</span>}
                        {doc.total_weight && <span>重量: {Number(doc.total_weight).toFixed(3)}g</span>}
                        {doc.weight && <span>重量: {Number(doc.weight).toFixed(3)}g</span>}
                        {doc.total_amount !== undefined && <span>金额: ¥{doc.total_amount?.toFixed(2)}</span>}
                        {doc.product_name && <span>商品: {doc.product_name}</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusDisplay(doc.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {getDownloadOptions(doc).map((option, idx) => (
                            <button
                              key={idx}
                              onClick={() => downloadDocument(doc, 'pdf', option.subType)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                              title={option.label}
                            >
                              <Download className="w-4 h-4" />
                              {getDownloadOptions(doc).length > 1 ? '' : option.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentCenterPage;
