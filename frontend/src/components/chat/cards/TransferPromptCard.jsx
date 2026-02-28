import React, { useState } from 'react'
import { API_BASE_URL } from '../../../config'

/**
 * 入库确认后的转移提示卡片
 * 提示用户是否将入库商品从商品部仓库转移到展厅
 * 
 * props.data: {
 *   items: [{ product_name: string, weight: number }],
 *   status: 'pending' | 'creating' | 'created' | 'dismissed',
 *   transferNo?: string,
 *   transferOrderId?: number,
 *   orderNos?: string
 * }
 * props.onStatusChange: (newStatus, extraData?) => void
 */
export default function TransferPromptCard({ data, onStatusChange }) {
  const [error, setError] = useState(null)

  if (!data || !data.items || data.items.length === 0) return null

  // 已取消 / 已关闭
  if (data.status === 'dismissed') {
    return null
  }

  // 已创建成功
  if (data.status === 'created') {
    return (
      <div className="mt-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200/60 shadow-sm">
        <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          转移单已创建
        </div>
        <div className="text-sm text-green-600">
          转移单号：<span className="font-mono font-semibold">{data.transferNo}</span>
          <span className="ml-2 text-gray-500">（商品部仓库 → 展厅，待确认）</span>
        </div>
      </div>
    )
  }

  const handleCreateTransfer = async () => {
    setError(null)
    onStatusChange('creating')

    try {
      // 1. 获取位置列表
      const locRes = await fetch(`${API_BASE_URL}/api/warehouse/locations`)
      const locations = await locRes.json()

      const warehouseLoc = locations.find(l => l.code === 'warehouse' || l.name === '商品部仓库')
      const showroomLoc = locations.find(l => l.code === 'showroom' || l.name === '展厅')

      if (!warehouseLoc || !showroomLoc) {
        throw new Error('未找到商品部仓库或展厅位置配置')
      }

      // 2. 创建转移单
      const remark = data.orderNos ? `来自入库单 ${data.orderNos}` : '入库后快速转移'
      const transferRes = await fetch(
        `${API_BASE_URL}/api/warehouse/transfer-orders?initial_status=pending_confirm&user_role=product&created_by=商品专员`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_location_id: warehouseLoc.id,
            to_location_id: showroomLoc.id,
            items: data.items.map(item => ({
              product_name: item.product_name,
              weight: item.weight
            })),
            remark
          })
        }
      )

      const result = await transferRes.json()

      if (transferRes.ok && (result.id || result.data?.id)) {
        onStatusChange('created', {
          transferNo: result.transfer_no || result.data?.transfer_no,
          transferOrderId: result.id || result.data?.id
        })
      } else {
        const errMsg = result.detail || result.message || result.error || '创建转移单失败'
        throw new Error(errMsg)
      }
    } catch (err) {
      console.error('创建转移单失败:', err)
      setError(err.message || '创建转移单失败')
      onStatusChange('pending')
    }
  }

  const handleDismiss = () => {
    onStatusChange('dismissed')
  }

  const isCreating = data.status === 'creating'
  const totalWeight = data.items.reduce((sum, item) => sum + (item.weight || 0), 0)

  return (
    <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200/60 shadow-sm">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-blue-700 font-medium mb-3">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        是否将入库商品转移到展厅？
      </div>

      {/* 方向指示 */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-md font-medium">商品部仓库</span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-md font-medium">展厅</span>
        <span className="text-gray-400 ml-2">共 {data.items.length} 个商品，{totalWeight.toFixed(2)}g</span>
      </div>

      {/* 商品列表 */}
      <div className="bg-white/60 rounded-lg p-3 mb-3 space-y-1.5">
        {data.items.map((item, idx) => (
          <div key={idx} className="flex justify-between text-sm">
            <span className="text-gray-700">{item.product_name}</span>
            <span className="text-gray-500 font-mono">{item.weight.toFixed(2)}g</span>
          </div>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-2">
          {error}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <button
          onClick={handleCreateTransfer}
          disabled={isCreating}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isCreating ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              创建中...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              生成转移单（转入展厅）
            </>
          )}
        </button>
        <button
          onClick={handleDismiss}
          disabled={isCreating}
          className="px-4 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-60"
        >
          暂不转移
        </button>
      </div>
    </div>
  )
}
