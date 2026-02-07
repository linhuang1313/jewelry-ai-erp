import React from 'react'

export const WithdrawalRecordCard = ({ withdrawalData }) => {
  const wd = withdrawalData
  return (
    <div className="flex justify-start">
      <div className="bg-white rounded-2xl shadow-lg border border-green-200 max-w-md overflow-hidden">
        {/* 鏍囬鏍? */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-5 py-3">
          <div className="flex items-center gap-2 text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-semibold">提料单已生成</span>
          </div>
        </div>
        
        {/* 内容? */}
        <div className="p-5 space-y-4">
          {/* 单号信息 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">鍗曞彿</span>
            <span className="font-mono font-semibold text-green-700">{wd.withdrawal_no}</span>
          </div>
          
          {/* 客户信息 */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-green-600 font-bold text-lg">{wd.customer_name?.charAt(0) || '客'}</span>
            </div>
            <div>
              <div className="font-semibold text-gray-900">{wd.customer_name}</div>
              <div className="text-xs text-gray-500">{wd.created_at}</div>
            </div>
          </div>
          
          {/* 提料信息 */}
          <div className="bg-green-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">提料克重</span>
              <span className="font-bold text-green-700 text-2xl">{wd.gold_weight?.toFixed(2)} 克</span>
            </div>
            {wd.remark && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">备注</span>
                <span className="text-gray-700">{wd.remark}</span>
              </div>
            )}
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => window.open(wd.download_url, '_blank')}
              className="flex-1 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              打印/下载
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WithdrawalRecordCard
