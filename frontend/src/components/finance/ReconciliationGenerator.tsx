import React, { useState } from 'react';
import { FileText, Download, Send, Printer, User, Loader2, X, Copy, FileSpreadsheet } from 'lucide-react';
import { CustomerReference } from '../../types/finance';
import { generateReconciliationStatement, StatementData } from '../../services/financeService';
import { toast } from 'react-hot-toast';
import { exportStatementToPDF } from '../../utils/pdfExport';
import { StatementPreview } from './StatementPreview';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';

interface ReconciliationGeneratorProps {
  customers: CustomerReference[];
  onGenerate: (customerId: number, startDate: Date, endDate: Date) => void;
}

export const ReconciliationGenerator: React.FC<ReconciliationGeneratorProps> = ({
  customers,
  onGenerate,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [periodType, setPeriodType] = useState<'this_month' | 'last_month' | 'custom'>('this_month');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [generatedStatement, setGeneratedStatement] = useState<StatementData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareLink, setShareLink] = useState<string>('');

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.customerNo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleGenerate = async () => {
    if (!selectedCustomerId) {
      toast.error('请选择客户');
      return;
    }

    let startDate: Date;
    let endDate: Date;
    const now = new Date();

    if (periodType === 'this_month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (periodType === 'last_month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
    } else {
      if (!customStartDate || !customEndDate) {
        toast.error('请选择自定义日期范围');
        return;
      }
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
    }

    setIsGenerating(true);
    try {
      const result = await generateReconciliationStatement(selectedCustomerId, startDate, endDate);
      if (result.success && result.data) {
        setGeneratedStatement(result.data);
        toast.success(result.message || '对账单生成成功');
        onGenerate(selectedCustomerId, startDate, endDate);
      } else {
        toast.error(result.error || '生成对账单失败');
      }
    } catch (error) {
      console.error('生成对账单失败:', error);
      toast.error('生成对账单失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // 导出PDF
  const handleExportPDF = async () => {
    if (!generatedStatement) return;
    try {
      await exportStatementToPDF(generatedStatement);
      toast.success('PDF导出成功');
    } catch (error) {
      console.error('PDF导出失败:', error);
      toast.error('PDF导出失败，请重试');
    }
  };

  // 导出Excel
  const handleExportExcel = async () => {
    if (!selectedCustomerId) return;
    
    let startDate: Date;
    let endDate: Date;
    const now = new Date();

    if (periodType === 'this_month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (periodType === 'last_month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
    } else {
      if (!customStartDate || !customEndDate) {
        toast.error('请选择自定义日期范围');
        return;
      }
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
    }
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const params = new URLSearchParams({
        customer_id: selectedCustomerId.toString(),
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
      });
      
      const response = await fetch(`${API_BASE_URL}/api/finance/statement/excel?${params}`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('导出失败');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `客户往来账_${selectedCustomer?.name || ''}_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success('Excel导出成功');
    } catch (error) {
      console.error('Excel导出失败:', error);
      toast.error('Excel导出失败，请重试');
    }
  };

  // 打印
  const handlePrint = () => {
    if (!generatedStatement) return;

    // 查找对账单预览元素
    const previewElement = document.querySelector('.statement-preview');
    if (!previewElement) {
      toast.error('未找到对账单内容');
      return;
    }

    // 克隆元素内容
    const printContent = previewElement.cloneNode(true) as HTMLElement;

    // 创建新窗口
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('无法打开打印窗口，请检查浏览器弹窗设置');
      return;
    }

    // 构建打印页面的 HTML
    const printHTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>客户往来账对账单</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background: white;
      padding: 20px;
    }
    
    .statement-preview {
      width: 210mm;
      min-height: 297mm;
      max-width: 100%;
      margin: 0 auto;
      padding: 32px 40px;
      background: white;
      border: 2px solid #000;
      box-shadow: none;
    }
    
    /* 表格样式 */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    
    th, td {
      border: 1px solid #000;
      padding: 8px;
      text-align: left;
    }
    
    th {
      background-color: #fef3c7;
      font-weight: bold;
      text-align: center;
    }
    
    /* 字体样式 */
    .font-mono {
      font-family: 'Courier New', Courier, monospace;
    }
    
    .font-bold {
      font-weight: bold;
    }
    
    /* 文本对齐 */
    .text-center {
      text-align: center;
    }
    
    .text-right {
      text-align: right;
    }
    
    .text-left {
      text-align: left;
    }
    
    /* 颜色样式 */
    .text-gray-600 { color: #4b5563; }
    .text-gray-700 { color: #374151; }
    .text-gray-800 { color: #1f2937; }
    .text-gray-900 { color: #111827; }
    .text-amber-700 { color: #b45309; }
    .text-blue-600 { color: #2563eb; }
    .text-green-600 { color: #16a34a; }
    .text-red-600 { color: #dc2626; }
    .text-orange-600 { color: #ea580c; }
    
    /* 背景色 */
    .bg-amber-50 { background-color: #fffbeb; }
    .bg-amber-50\\/50 { background-color: rgba(255, 251, 235, 0.5); }
    .bg-blue-50\\/50 { background-color: rgba(239, 246, 255, 0.5); }
    .bg-green-50\\/50 { background-color: rgba(240, 253, 244, 0.5); }
    .bg-gray-50 { background-color: #f9fafb; }
    .bg-gray-100 { background-color: #f3f4f6; }
    .bg-gradient-to-br { background: linear-gradient(to bottom right, var(--tw-gradient-stops)); }
    .from-amber-50 { --tw-gradient-from: #fffbeb; }
    .to-orange-50 { --tw-gradient-to: #fff7ed; }
    .from-emerald-50 { --tw-gradient-from: #ecfdf5; }
    .to-green-50 { --tw-gradient-to: #f0fdf4; }
    
    /* 边框样式 */
    .border { border-width: 1px; }
    .border-2 { border-width: 2px; }
    .border-gray-300 { border-color: #d1d5db; }
    .border-gray-400 { border-color: #9ca3af; }
    .border-amber-200 { border-color: #fde68a; }
    .border-emerald-200 { border-color: #a7f3d0; }
    
    /* 间距 */
    .mb-1 { margin-bottom: 0.25rem; }
    .mb-2 { margin-bottom: 0.5rem; }
    .mb-3 { margin-bottom: 0.75rem; }
    .mb-4 { margin-bottom: 1rem; }
    .mb-5 { margin-bottom: 1.25rem; }
    .mb-6 { margin-bottom: 1.5rem; }
    .mt-1 { margin-top: 0.25rem; }
    .mt-2 { margin-top: 0.5rem; }
    .mt-3 { margin-top: 0.75rem; }
    .mt-auto { margin-top: auto; }
    .p-3 { padding: 0.75rem; }
    .p-4 { padding: 1rem; }
    .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
    .py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
    .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
    .pt-3 { padding-top: 0.75rem; }
    .gap-2 { gap: 0.5rem; }
    .gap-4 { gap: 1rem; }
    .gap-8 { gap: 2rem; }
    
    /* 布局 */
    .flex { display: flex; }
    .flex-1 { flex: 1 1 0%; }
    .items-center { align-items: center; }
    .items-start { align-items: flex-start; }
    .justify-between { justify-content: space-between; }
    .grid { display: grid; }
    .grid-cols-2 { grid-template-columns: repeat(2, minfr); }
    
    /* 字体大小 */
    .text-xs { font-size: 0.75rem; }
    .text-sm { font-size: 0.875rem; }
    .text-xl { font-size: 1.25rem; }
    .text-2xl { font-size: 1.5rem; }
    
    /* 其他 */
    .rounded { border-radius: 0.25rem; }
    .rounded-lg { border-radius: 0.5rem; }
    .space-y-1 > * + * { margin-top: 0.25rem; }
    .w-full { width: 100%; }
    .w-10 { width: 2.5rem; }
    .w-20 { width: 5rem; }
    .w-24 { width: 6rem; }
    .w-40 { width: 10rem; }
    .inline-block { display: inline-block; }
    .border-b-2 { border-bottom-width: 2px; }
    .border-t-2 { border-top-width: 2px; }
    .h-0\\.5 { height: 0.125rem; }
    .tracking-wider { letter-spacing: 0.05em; }
    
    /* 打印样式 */
    @media print {
      body {
        padding: 0;
      }
      
      .statement-preview {
        width: 210mm !important;
        min-height: 297mm !important;
        margin: 0 !important;
        padding: 20mm !important;
        border: 2px solid #000 !important;
        page-break-after: always;
        page-break-inside: avoid;
      }
      
      table, th, td {
        border: 1px solid #000 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      
      .font-mono {
        font-family: 'Courier New', Courier, monospace !important;
      }
      
      /* 确保背景色打印 */
      .bg-amber-50,
      .bg-amber-50\\/50,
      .bg-blue-50\\/50,
      .bg-green-50\\/50,
      .bg-gray-100 {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      
      /* 金额颜色在打印时保持 */
      .text-blue-600,
      .text-green-600,
      .text-red-600,
      .text-orange-600 {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  ${printContent.outerHTML}
  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() {
        window.close();
      };
    };
  </script>
</body>
</html>`;

    // 写入内容并打印
    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  // 发送客户（生成分享链接和二维码）
  const handleSendToCustomer = () => {
    if (!generatedStatement) return;

    // 生成分享链接（模拟）
    const link = `https://erp.example.com/statement/${generatedStatement.statementNo}`;
    setShareLink(link);
    setShowShareDialog(true);
    toast.success('已生成分享链接，客户可扫码查看');
  };

  // 复制链接
  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink);
    toast.success('链接已复制到剪贴板');
  };

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div className="space-y-6">
      {/* 生成器 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <FileText className="w-5 h-5" />
          <span>生成对账单</span>
        </h3>

        <div className="space-y-4">
          {/* 选择客户 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择客户 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索客户名称或编号..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchTerm && filteredCustomers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      onClick={() => {
                        setSelectedCustomerId(customer.id);
                        setSearchTerm(customer.name);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 text-sm"
                    >
                      <div className="font-medium">{customer.name}</div>
                      <div className="text-xs text-gray-500">{customer.customerNo}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="mt-2 text-sm text-gray-600">
                已选择：<span className="font-medium">{selectedCustomer.name}</span> (
                {selectedCustomer.customerNo})
              </div>
            )}
          </div>

          {/* 选择周期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择周期 <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="period"
                  value="this_month"
                  checked={periodType === 'this_month'}
                  onChange={(e) => setPeriodType(e.target.value as any)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm">本月</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="period"
                  value="last_month"
                  checked={periodType === 'last_month'}
                  onChange={(e) => setPeriodType(e.target.value as any)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm">上月</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="period"
                  value="custom"
                  checked={periodType === 'custom'}
                  onChange={(e) => setPeriodType(e.target.value as any)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm">自定义</span>
              </label>
            </div>
            {periodType === 'custom' && (
              <div className="mt-3 flex space-x-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full md:w-auto px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>生成中...</span>
              </>
            ) : (
              <span>生成对账单</span>
            )}
          </button>
        </div>
      </div>

      {/* 对账单预览 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">对账单预览</h3>

        {!generatedStatement ? (
          <div className="text-center py-12 text-gray-500">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <p>请先选择客户和周期，然后生成对账单</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 使用StatementPreview组件 */}
            <div className="flex justify-center">
              <StatementPreview data={generatedStatement} />
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200 print:hidden">
              <button
                onClick={handleExportPDF}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>导出PDF</span>
              </button>
              <button
                onClick={handleExportExcel}
                className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>导出Excel</span>
              </button>
              <button
                onClick={handleSendToCustomer}
                className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>发送客户</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>打印</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 分享链接对话框 */}
      <Transition appear show={showShareDialog} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowShareDialog(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-xl font-bold text-gray-900">
                      分享对账单
                    </Dialog.Title>
                    <button
                      onClick={() => setShowShareDialog(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      已生成分享链接，客户可扫码查看对账单
                    </p>

                    {/* 二维码 */}
                    <div className="flex justify-center py-4 bg-gray-50 rounded-lg">
                      <QRCodeSVG value={shareLink} size={200} />
                    </div>

                    {/* 分享链接 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        分享链接
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={shareLink}
                          readOnly
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                        />
                        <button
                          onClick={handleCopyLink}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center space-x-1"
                        >
                          <Copy className="w-4 h-4" />
                          <span>复制</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <button
                        onClick={() => setShowShareDialog(false)}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};
