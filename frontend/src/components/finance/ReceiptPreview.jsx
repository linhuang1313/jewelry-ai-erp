import React, { useState, useEffect, useRef } from 'react'
import { Printer, X, Download } from 'lucide-react'
import { API_BASE_URL } from '../../config'

const PAYMENT_METHODS = {
  cash: '现金',
  bank_transfer: '银行转账',
  wechat: '微信',
  alipay: '支付宝',
  card: '刷卡',
  check: '支票',
}

export const ReceiptPreview = ({ paymentNo, onClose }) => {
  const [receipt, setReceipt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const printRef = useRef(null)

  useEffect(() => {
    if (!paymentNo) return
    setLoading(true)
    fetch(`${API_BASE_URL}/api/finance/receipts/${paymentNo}`)
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          setReceipt(result.data)
        } else {
          setError(result.message || '获取收据失败')
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [paymentNo])

  const handlePrint = () => {
    const content = printRef.current
    if (!content) return
    const printWindow = window.open('', '_blank')
    printWindow.document.write(`
      <html>
        <head>
          <title>收据 - ${paymentNo}</title>
          <style>
            @page { size: A5 landscape; margin: 15mm; }
            body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; }
            .receipt-container { max-width: 600px; margin: 0 auto; padding: 24px; border: 2px solid #C9A86C; }
            .receipt-header { text-align: center; border-bottom: 2px solid #C9A86C; padding-bottom: 12px; margin-bottom: 16px; }
            .receipt-title { font-size: 22px; font-weight: bold; color: #1E3A5F; letter-spacing: 8px; }
            .receipt-no { font-size: 13px; color: #666; margin-top: 4px; }
            .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
            .receipt-label { color: #666; min-width: 80px; }
            .receipt-value { font-weight: 500; }
            .amount-main { font-size: 20px; font-weight: bold; color: #C9A86C; }
            .amount-chinese { font-size: 14px; color: #1E3A5F; font-weight: 500; }
            .amount-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            .amount-table th, .amount-table td { border: 1px solid #ddd; padding: 6px 10px; text-align: right; font-size: 13px; }
            .amount-table th { background: #f5f0e8; color: #1E3A5F; text-align: center; }
            .divider { border-top: 1px dashed #ccc; margin: 12px 0; }
            .footer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 13px; color: #666; margin-top: 16px; padding-top: 12px; border-top: 2px solid #C9A86C; }
            .footer-label { font-weight: 500; color: #333; }
            .method-check { display: inline-flex; gap: 12px; font-size: 13px; }
            .method-item { display: inline-flex; align-items: center; gap: 3px; }
            .check-box { width: 12px; height: 12px; border: 1px solid #999; display: inline-block; text-align: center; font-size: 10px; line-height: 12px; }
            .check-box.checked { background: #C9A86C; color: white; border-color: #C9A86C; }
          </style>
        </head>
        <body>${content.innerHTML}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">加载收据...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 text-center max-w-sm">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">关闭</button>
        </div>
      </div>
    )
  }

  if (!receipt) return null

  const allMethods = ['cash', 'bank_transfer', 'wechat', 'alipay']

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-gray-50 rounded-t-2xl">
          <span className="text-sm text-gray-500">收据预览</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              <Printer size={14} />
              打印
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Receipt Body */}
        <div className="p-6" ref={printRef}>
          <div className="receipt-container max-w-[560px] mx-auto border-2 border-amber-400/60 rounded-lg p-6">
            {/* Header */}
            <div className="text-center border-b-2 border-amber-400/60 pb-3 mb-4">
              <h1 className="text-2xl font-bold text-[#1E3A5F] tracking-[8px]">收  据</h1>
              <p className="text-sm text-gray-400 mt-1">No. {receipt.payment_no}</p>
            </div>

            {/* Date */}
            <div className="flex justify-end text-sm text-gray-500 mb-3">
              日期：{receipt.payment_date || '—'}
            </div>

            {/* Customer */}
            <div className="text-[15px] mb-3">
              <span className="text-gray-500">今收到：</span>
              <span className="font-semibold text-gray-900 text-lg border-b border-dashed border-gray-300 pb-0.5 px-1">
                {receipt.customer_name}
              </span>
            </div>

            {/* Amount Chinese */}
            <div className="text-[15px] mb-1">
              <span className="text-gray-500">人民币（大写）：</span>
              <span className="font-semibold text-[#1E3A5F]">{receipt.amount_chinese}</span>
            </div>

            {/* Amount Number */}
            <div className="text-right mb-4">
              <span className="text-2xl font-bold text-amber-600 font-mono">
                ¥{Number(receipt.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Reason */}
            <div className="text-sm mb-3">
              <span className="text-gray-500">收款事由：</span>
              <span className="text-gray-800">{receipt.receipt_reason || '货款'}</span>
            </div>

            {/* Amount Breakdown */}
            {(receipt.gold_amount > 0 || receipt.labor_amount > 0) && (
              <table className="w-full border-collapse mb-4 text-sm">
                <thead>
                  <tr className="bg-amber-50/80">
                    <th className="border border-gray-200 px-3 py-2 text-center text-[#1E3A5F] font-medium">项目</th>
                    <th className="border border-gray-200 px-3 py-2 text-center text-[#1E3A5F] font-medium">金款</th>
                    <th className="border border-gray-200 px-3 py-2 text-center text-[#1E3A5F] font-medium">工费</th>
                    <th className="border border-gray-200 px-3 py-2 text-center text-[#1E3A5F] font-medium">合计</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-gray-200 px-3 py-2 text-center text-gray-600">金额</td>
                    <td className="border border-gray-200 px-3 py-2 text-right font-mono">
                      {receipt.gold_amount > 0 ? `¥${Number(receipt.gold_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-right font-mono">
                      {receipt.labor_amount > 0 ? `¥${Number(receipt.labor_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-right font-mono font-semibold text-amber-600">
                      ¥{Number(receipt.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Payment Method */}
            <div className="text-sm mb-4">
              <span className="text-gray-500 mr-2">收款方式：</span>
              <span className="inline-flex gap-3">
                {allMethods.map(m => (
                  <span key={m} className="inline-flex items-center gap-1">
                    <span className={`inline-block w-3 h-3 border rounded-sm text-[8px] leading-3 text-center ${
                      receipt.payment_method === m
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'border-gray-400'
                    }`}>
                      {receipt.payment_method === m ? '✓' : ''}
                    </span>
                    <span className="text-gray-700">{PAYMENT_METHODS[m]}</span>
                  </span>
                ))}
              </span>
            </div>

            {/* Divider */}
            <div className="border-t-2 border-amber-400/60 pt-3 mt-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">经手人：</span>
                  <span className="text-gray-800">{receipt.operator || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500">确认人：</span>
                  <span className="text-gray-800">{receipt.confirmed_by || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500">复核人：</span>
                  <span className="text-gray-800">{receipt.reviewed_by || '—'}</span>
                </div>
              </div>
            </div>

            {/* Company Stamp Area */}
            <div className="mt-4 pt-3 border-t border-dashed border-gray-300 text-right text-sm text-gray-400">
              收款单位（盖章）：梵贝琳珠宝
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReceiptPreview
