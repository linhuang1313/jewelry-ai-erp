/**
 * OCR编辑弹窗组件
 */
import React, { useEffect, useRef } from 'react'
import LineNumberedTextarea from '../LineNumberedTextarea'

export const OCRModal = ({
  isOpen,
  onClose,
  ocrResult,
  setOcrResult,
  uploadedImage,
  onConfirm,
  loading
}) => {
  const textareaRef = useRef(null)

  // 当对话框打开时自动聚焦
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
        if (textareaRef.current) {
          const length = textareaRef.current.value.length
          textareaRef.current.setSelectionRange(length, length)
        }
      }, 150)
      
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* 对话框标题栏 */}
        <div className="px-4 sm:px-6 py-4 border-b flex justify-between items-center bg-gray-50">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">📝</span>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
              审核并编辑识别内容
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-3xl font-light w-8 h-8 flex items-center justify-center transition-colors"
            title="关闭"
          >
            ×
          </button>
        </div>
        
        {/* 对话框内容区域 */}
        <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
          {/* 左侧：图片预览（桌面端显示） */}
          {uploadedImage && (
            <div className="hidden sm:block w-80 border-r bg-gray-50 p-4 overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">原始图片</h3>
              <div className="bg-white rounded-lg p-2 shadow-sm">
                <img 
                  src={uploadedImage} 
                  alt="上传的入库单" 
                  className="w-full h-auto rounded border border-gray-200"
                />
              </div>
              <p className="text-xs text-gray-500 mt-3">
                请对照图片检查识别内容是否正确
              </p>
            </div>
          )}
          
          {/* 右侧：编辑区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 提示信息 */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b bg-blue-50">
              <p className="text-xs sm:text-sm text-blue-800 font-medium mb-1">
                ⚠️ 请检查并编辑识别内容，确认无误后点击"确认入库"
              </p>
              <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5 mt-2">
                <li>检查商品名称是否正确</li>
                <li>检查重量、工费、供应商等信息</li>
                <li>可以手动编辑修改内容</li>
              </ul>
            </div>
            
            {/* 文本编辑区域 */}
            <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
              <LineNumberedTextarea
                ref={textareaRef}
                value={ocrResult}
                onChange={(e) => setOcrResult(e.target.value)}
                placeholder="识别出的文字内容将显示在这里..."
                className="min-h-[300px]"
              />
            </div>
          </div>
        </div>
        
        {/* 移动端图片预览 */}
        {uploadedImage && (
          <div className="sm:hidden border-t bg-gray-50 p-4 max-h-48 overflow-y-auto">
            <h3 className="text-xs font-semibold text-gray-700 mb-2">原始图片</h3>
            <img 
              src={uploadedImage} 
              alt="上传的入库单" 
              className="w-full h-auto rounded border border-gray-200"
            />
          </div>
        )}
        
        {/* 对话框底部按钮 */}
        <div className="px-4 sm:px-6 py-4 border-t bg-gray-50 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-4">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-white transition-colors font-medium order-2 sm:order-1"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !ocrResult.trim()}
            className="w-full sm:w-auto px-8 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium order-1 sm:order-2"
          >
            {loading ? '处理中...' : '确认入库'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OCRModal
