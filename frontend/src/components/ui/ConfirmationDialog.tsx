/**
 * 关键操作二次确认对话框
 * 用于高风险操作（删除、撤销结算等）的二次确认
 */
import React from 'react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  warning?: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  details?: {
    label: string;
    value: string;
  }[];
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  warning,
  confirmText = '确认执行',
  cancelText = '取消',
  isDestructive = false,
  isLoading = false,
  details = [],
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* 背景遮罩 */}
      <div 
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      
      {/* 对话框 */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full transform transition-all">
          {/* 头部 */}
          <div className={`px-6 py-4 rounded-t-xl ${
            isDestructive ? 'bg-red-50' : 'bg-amber-50'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                isDestructive ? 'bg-red-100' : 'bg-amber-100'
              }`}>
                {isDestructive ? (
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className={`text-lg font-semibold ${
                isDestructive ? 'text-red-800' : 'text-amber-800'
              }`}>
                {title}
              </h3>
            </div>
          </div>
          
          {/* 内容 */}
          <div className="px-6 py-4">
            <p className="text-gray-700 mb-4">{message}</p>
            
            {/* 警告信息 */}
            {warning && (
              <div className={`p-3 rounded-lg mb-4 ${
                isDestructive ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'
              }`}>
                <div className="flex items-start gap-2">
                  <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                    isDestructive ? 'text-red-500' : 'text-amber-500'
                  }`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className={`text-sm ${
                    isDestructive ? 'text-red-700' : 'text-amber-700'
                  }`}>
                    {warning}
                  </span>
                </div>
              </div>
            )}
            
            {/* 详细信息 */}
            {details.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="text-sm text-gray-600 mb-2">操作详情：</div>
                <dl className="space-y-1">
                  {details.map((detail, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <dt className="text-gray-500">{detail.label}：</dt>
                      <dd className="font-medium text-gray-900">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
          
          {/* 按钮 */}
          <div className="px-6 py-4 bg-gray-50 rounded-b-xl flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 flex items-center gap-2 ${
                isDestructive 
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' 
                  : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
              }`}
            >
              {isLoading && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;
