/**
 * 思考步骤消息组件
 */
import React from 'react'

export const ThinkingMessage = ({ steps, progress }) => {
  if (!Array.isArray(steps) || steps.length === 0) return null

  return (
    <div className="flex justify-start">
      <div className="bg-white rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60 max-w-2xl">
        {/* 进度条 */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>处理进度</span>
            <span>{steps[steps.length - 1]?.progress || 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div 
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${steps[steps.length - 1]?.progress || 0}%` }}
            ></div>
          </div>
        </div>
        
        {/* 思考步骤 */}
        <div className="space-y-2">
          {steps.map((step, stepIdx) => (
            <div key={stepIdx} className="flex items-start space-x-3">
              <div className={`w-2 h-2 rounded-full mt-2 ${
                step.status === 'complete' 
                  ? 'bg-green-500' 
                  : 'bg-blue-500 animate-pulse'
              }`}></div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-700">{step.step}</div>
                <div className="text-sm text-gray-500">{step.message}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ThinkingMessage
