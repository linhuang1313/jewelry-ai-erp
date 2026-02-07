/**
 * 聊天输入区域组件
 */
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'

export const InputArea = ({
  input,
  setInput,
  onSend,
  loading,
  uploading,
  userRole,
  onImageUpload,
  onQuickInbound,
  onQuickOrder,
  onQuickReturn,
  onQuickReceipt,
  onQuickWithdrawal
}) => {
  const { t } = useTranslation()
  const fileInputRef = useRef(null)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const handleInput = (e) => {
    const target = e.target
    target.style.height = 'auto'
    target.style.height = Math.min(target.scrollHeight, 200) + 'px'
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      onImageUpload(file)
    }
    // Reset file input so the same file can be re-uploaded
    if (e.target) {
      e.target.value = ''
    }
  }

  return (
    <footer className="bg-white/80 backdrop-blur-xl border-t border-gray-200/60 px-6 py-5">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end space-x-3">
          {/* 快捷入库按钮 - 仅商品专员可见 */}
          {userRole === 'product' && (
            <button
              onClick={onQuickInbound}
              disabled={loading || uploading}
              className={`
                px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                h-[52px] flex items-center font-medium text-[14px]
                ${loading || uploading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm hover:shadow-md'
                }
              `}
              title="快捷入库"
            >
              📦 入库
            </button>
          )}

          {/* 快速开单按钮 - 仅柜台可见 */}
          {userRole === 'counter' && (
            <button
              onClick={onQuickOrder}
              disabled={loading || uploading}
              className={`
                px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                h-[52px] flex items-center font-medium text-[14px]
                ${loading || uploading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm hover:shadow-md'
                }
              `}
              title="快速开单"
            >
              📝 开单
            </button>
          )}

          {/* 快捷退货按钮 - 商品专员和柜台可见 */}
          {(userRole === 'product' || userRole === 'counter') && (
            <button
              onClick={onQuickReturn}
              disabled={loading || uploading}
              className={`
                px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                h-[52px] flex items-center font-medium text-[14px]
                ${loading || uploading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-red-500 text-white hover:bg-red-600 shadow-sm hover:shadow-md'
                }
              `}
              title="快捷退货"
            >
              ↩️ 退货
            </button>
          )}

          {/* 图片上传按钮 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            id="image-upload"
            disabled={loading || uploading}
          />
          <label
            htmlFor="image-upload"
            title="OCR识别入库单据 - 支持拍照或上传单据图片自动识别"
            className={`
              px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200
              h-[52px] flex items-center font-medium text-[15px]
              ${loading || uploading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white'
              }
            `}
          >
            {uploading ? `📷 ${t('chat.scanning')}` : `📷 ${t('chat.scan')}`}
          </label>

          {/* 快捷收料/提料按钮 - 结算专员和管理层可见 */}
          {(userRole === 'settlement' || userRole === 'manager') && (
            <>
              <button
                onClick={onQuickReceipt}
                className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white hover:from-jewelry-gold-dark hover:to-jewelry-gold shadow-sm hover:shadow-md transition-all duration-200"
                title="快捷收料"
              >
                📦 {t('chat.receipt')}
              </button>
              <button
                onClick={onQuickWithdrawal}
                className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white transition-all duration-200"
                title="快捷提料"
              >
                ⬆️ {t('chat.withdrawal')}
              </button>
            </>
          )}

          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder')}
              rows={1}
              className="w-full px-5 py-4 border-2 border-gray-200 rounded-2xl 
                         focus:outline-none focus:border-jewelry-gold focus:ring-4 focus:ring-jewelry-gold/10
                         resize-none min-h-[52px] max-h-[200px] overflow-y-auto
                         text-[15px] bg-white transition-all duration-200"
              disabled={loading || uploading}
              onInput={handleInput}
            />
          </div>
          
          <button
            onClick={onSend}
            disabled={loading || uploading || !input.trim()}
            className={`
              px-6 py-3 rounded-2xl font-medium text-[15px] h-[52px]
              transition-all duration-200 shadow-sm hover:shadow-md
              ${loading || uploading || !input.trim()
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white hover:from-jewelry-gold-dark hover:to-jewelry-gold'
              }
            `}
          >
            {t('common.send')}
          </button>
        </div>
      </div>
    </footer>
  )
}

export default InputArea
