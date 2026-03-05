/**
 * 带行号的文本编辑器组件
 */
import React, { useRef } from 'react'

const LineNumberedTextarea = React.forwardRef(({ value, onChange, placeholder, className = '' }, ref) => {
  const textareaRef = useRef(null)
  const lineNumbersRef = useRef(null)
  
  // 将ref转发到textarea
  React.useImperativeHandle(ref, () => textareaRef.current)
  
  // 计算行数
  const lineCount = value.split('\n').length
  
  // 同步滚动
  const handleScroll = () => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }
  
  return (
    <div className="flex border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* 行号区域 */}
      <div 
        ref={lineNumbersRef}
        className="flex-shrink-0 w-12 bg-gray-50 border-r border-gray-300 py-3 px-2 text-right text-xs text-gray-400 font-mono overflow-hidden"
        style={{ 
          lineHeight: '1.5rem',
          userSelect: 'none'
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} style={{ height: '1.5rem' }}>
            {i + 1}
          </div>
        ))}
      </div>
      
      {/* 文本编辑区域 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        placeholder={placeholder}
        className={`flex-1 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm leading-6 ${className}`}
        style={{ fontSize: '14px' }}
      />
    </div>
  )
})

LineNumberedTextarea.displayName = 'LineNumberedTextarea'

export default LineNumberedTextarea

