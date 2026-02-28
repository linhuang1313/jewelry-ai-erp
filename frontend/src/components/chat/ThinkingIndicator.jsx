/**
 * 思考状态指示器组件
 */
import React from 'react'

export const ThinkingIndicator = ({ uploading = false }) => {
  return (
    <div className="flex justify-start items-start gap-3">
      {/* AI头像 + 脉冲动画 */}
      <div className="relative flex-shrink-0">
        <img src="/ai-avatar.png" alt="AI" className="w-9 h-9 rounded-full object-cover shadow-lg" />
        <div className="absolute inset-0 bg-amber-400 rounded-full animate-ping opacity-30"></div>
      </div>
      {/* 思考气泡 */}
      <div className="bg-gradient-to-br from-white to-amber-50 rounded-3xl px-5 py-4 shadow-sm border border-amber-100">
        <div className="flex items-center gap-3">
          <div className="flex space-x-1.5">
            <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce"></div>
            <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
            <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
          </div>
          <span className="text-sm text-amber-600 font-medium">
            {uploading ? 'AI正在识别图片...' : 'AI正在分析...'}
          </span>
        </div>
      </div>
    </div>
  )
}

export default ThinkingIndicator
