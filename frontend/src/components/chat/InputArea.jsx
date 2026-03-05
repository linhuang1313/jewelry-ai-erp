/**
 * 聊天输入区域组件（含 @角色 提及弹窗）
 */
import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const MENTION_ROLES = [
  { id: 'finance', label: '财务', desc: '财务核收、对账' },
  { id: 'settlement', label: '结算', desc: '结算确认、平账' },
  { id: 'product', label: '商品部', desc: '商品管理、入库' },
  { id: 'counter', label: '柜台', desc: '销售开单' },
  { id: 'sales', label: '业务员', desc: '客户跟进' },
  { id: 'material', label: '金料', desc: '金料收付' },
  { id: 'manager', label: '经理', desc: '审批管理' },
]

const MentionPopup = ({ filter, onSelect, selectedIndex }) => {
  const filtered = MENTION_ROLES.filter(
    r => r.label.includes(filter) || r.id.includes(filter.toLowerCase()) || r.desc.includes(filter)
  )

  if (filtered.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 font-medium">选择要 @提及 的角色</div>
      <div className="max-h-60 overflow-y-auto">
        {filtered.map((role, idx) => (
          <button
            key={role.id}
            onClick={() => onSelect(role)}
            className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors cursor-pointer
              ${idx === selectedIndex ? 'bg-jewelry-gold/10 text-jewelry-gold-dark' : 'hover:bg-gray-50 text-gray-700'}
            `}
          >
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-jewelry-gold/20 to-jewelry-gold/5 flex items-center justify-center text-sm font-semibold text-jewelry-gold-dark">
              {role.label[0]}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">@{role.label}</div>
              <div className="text-xs text-gray-400 truncate">{role.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

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
  const textareaRef = useRef(null)

  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionStart, setMentionStart] = useState(-1)
  const [selectedIdx, setSelectedIdx] = useState(0)

  const getFilteredRoles = useCallback(() => {
    return MENTION_ROLES.filter(
      r => r.label.includes(mentionFilter) || r.id.includes(mentionFilter.toLowerCase()) || r.desc.includes(mentionFilter)
    )
  }, [mentionFilter])

  const handleInputChange = (e) => {
    const val = e.target.value
    const cursorPos = e.target.selectionStart
    setInput(val)

    const textBeforeCursor = val.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@([^@\s]*)$/)

    if (atMatch) {
      setShowMention(true)
      setMentionFilter(atMatch[1])
      setMentionStart(cursorPos - atMatch[0].length)
      setSelectedIdx(0)
    } else {
      setShowMention(false)
      setMentionFilter('')
      setMentionStart(-1)
    }
  }

  const handleSelectRole = useCallback((role) => {
    if (mentionStart < 0) return
    const before = input.slice(0, mentionStart)
    const afterCursor = input.slice(mentionStart).replace(/^@[^@\s]*/, '')
    const newVal = before + '@' + role.label + ' ' + afterCursor
    setInput(newVal)
    setShowMention(false)
    setMentionFilter('')
    setMentionStart(-1)

    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + role.label.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }, [input, mentionStart, setInput])

  const handleKeyDown = (e) => {
    if (showMention) {
      const filtered = getFilteredRoles()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(prev => (prev + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(prev => (prev - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered.length > 0) {
          e.preventDefault()
          handleSelectRole(filtered[selectedIdx])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMention(false)
        return
      }
    }

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
    if (e.target) {
      e.target.value = ''
    }
  }

  useEffect(() => {
    if (!showMention) return
    const handleClickOutside = (e) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target)) {
        setShowMention(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMention])

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
            {showMention && (
              <MentionPopup
                filter={mentionFilter}
                onSelect={handleSelectRole}
                selectedIndex={selectedIdx}
              />
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
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
