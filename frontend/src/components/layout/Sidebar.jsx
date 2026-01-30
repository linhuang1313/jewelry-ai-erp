/**
 * 侧边栏组件 - 历史对话记录
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

export const Sidebar = ({
  isOpen,
  onClose,
  conversationHistory,
  currentConversationId,
  userRole,
  onNewConversation,
  onLoadConversation,
  onDeleteConversation
}) => {
  const { t } = useTranslation()

  return (
    <aside className={`
      ${isOpen ? 'w-80' : 'w-0'} 
      ${isOpen ? 'flex' : 'hidden'}
      lg:!flex lg:w-80
      transition-all duration-300 ease-in-out
      bg-gradient-to-b from-jewelry-navy to-jewelry-navy-dark
      flex-col
      overflow-hidden
    `}>
      {/* 侧边栏头部 */}
      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-white tracking-tight">{t('sidebar.title')}</h2>
        <button
          onClick={onClose}
          className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* 新建对话按钮 */}
      <div className="px-6 py-4 border-b border-white/10">
        <button
          onClick={onNewConversation}
          className="w-full px-4 py-2.5 bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white rounded-xl 
                     hover:from-jewelry-gold-dark hover:to-jewelry-gold transition-all duration-200 font-medium text-[15px] shadow-md"
        >
          {t('sidebar.newChat')}
        </button>
      </div>
      
      {/* 对话列表 */}
<div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
        {conversationHistory.length === 0 ? (
          <div className="px-6 py-8 text-center text-white/50 text-sm">
            {t('sidebar.noRecords')}
          </div>
        ) : (
          <div className="py-2">
            {conversationHistory.map((conv) => (
              <div
                key={conv.id}
                className={`
                  mx-3 mb-1 px-4 py-3 rounded-xl cursor-pointer
                  transition-all duration-200
                  ${currentConversationId === conv.id 
                    ? 'bg-jewelry-gold/20 border border-jewelry-gold/40' 
                    : 'hover:bg-white/10 border border-transparent'
                  }
                  group
                `}
                onClick={() => onLoadConversation(conv.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] font-medium truncate mb-1 ${currentConversationId === conv.id ? 'text-jewelry-gold-light' : 'text-white'}`}>
                      {conv.title}
                    </div>
                    <div className="text-xs text-white/50">
                      {new Date(conv.updatedAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                  {/* 只有管理员可以删除对话记录 */}
                  {userRole === 'manager' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteConversation(conv.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded-lg transition-all"
                      title="删除对话"
                    >
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

export default Sidebar
