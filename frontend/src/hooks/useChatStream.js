import { useState, useRef, useEffect } from 'react'
import { API_ENDPOINTS } from '../config'
import { createCardFromBackend, createNewCard } from '../utils/inboundHelpers'

/**
 * 聊天流式消息 Hook
 * 
 * 从 App.jsx 的 sendMessage 函数完整提取，管理：
 * - 用户输入状态 (input)
 * - 加载状态 (loading)
 * - SSE 流式请求的发送与解析
 * - AbortController 生命周期
 * 
 * @param {Object} params
 * @param {Array} params.messages - 消息列表
 * @param {Function} params.setMessages - 消息列表 setter
 * @param {string} params.userRole - 当前用户角色
 * @param {string} params.currentSessionId - 当前会话 ID
 * @param {string} params.currentLanguage - 当前语言
 * @param {Function} params.onNeedForm - 当AI检测到信息不完整需要弹出表单时的回调 ({action})
 */
export function useChatStream({
  messages,
  setMessages,
  userRole,
  currentSessionId,
  currentLanguage,
  onNeedForm,
}) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef(null)

  // 组件卸载时取消正在进行的 SSE 请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { type: 'user', content: userMessage }])
    setLoading(true)
    
    // 创建思考过程消息ID
    const thinkingMessageId = Date.now()
    let contentMessageId = null
    let currentContent = ''
    let isContentStarted = false
    let thinkingSteps = []

    try {
      console.log('Send stream request to:', API_ENDPOINTS.CHAT_STREAM)
      console.log('Request message:', userMessage)
      
      // 取消之前的请求（如果有）
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()
      
      const response = await fetch(API_ENDPOINTS.CHAT_STREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: userMessage, 
          user_role: userRole,
          session_id: currentSessionId,
          language: currentLanguage
        }),
        signal: abortControllerRef.current.signal
      })

      console.log('Received response, status code:', response.status)
      console.log('Response headers:', {
        'Content-Type': response.headers.get('Content-Type'),
        'Cache-Control': response.headers.get('Cache-Control'),
        'Connection': response.headers.get('Connection'),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Response error, status code:', response.status)
        console.error('Error content:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }
      
      if (!response.body) {
        console.error('Response body is empty')
          throw new Error('响应体为空')
      }
      
        console.log('Start reading SSE stream...')

      // 创建思考过程消息
      setMessages(prev => [...prev, { 
        id: thinkingMessageId,
        type: 'thinking', 
        steps: [],
        progress: 0
      }])

      // 读取SSE流
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let chunkCount = 0
      while (true) {
        try {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log(`SSE stream ended, total ${chunkCount} data chunks received`)
            setLoading(false)
            break
          }
          
          if (!value) {
            console.warn('Received empty value, continue waiting...')
            continue
          }

          chunkCount++
          if (chunkCount <= 3) {
            console.log(`Received chunk #${chunkCount}, length: ${value.length} bytes`)
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // 保留不完整的行

          for (const line of lines) {
                  if (line.trim() === '') continue // 跳过空行
                  if (line.startsWith('data: ')) {
                    try {
                      const jsonStr = line.slice(6)
                      console.log('Parse SSE JSON:', jsonStr)
                      const data = JSON.parse(jsonStr)
                      console.log('Received SSE data:', data)
                      // 特别检查 all_products
                      if (data.data?.all_products) {
                        console.log('[IMPORTANT] Detected all_products:', data.data.all_products)
                      }
                
                // 处理思考步骤
                if (data.type === 'thinking') {
                  const stepIndex = thinkingSteps.findIndex(s => s.step === data.step)
                  if (stepIndex >= 0) {
                    // 更新现有步骤
                    thinkingSteps[stepIndex] = {
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    }
                  } else {
                    // 添加新步骤
                    thinkingSteps.push({
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    })
                  }
                  
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === thinkingMessageId) {
                      return { ...msg, steps: [...thinkingSteps], progress: data.progress || 0 }
                    }
                    return msg
                  }))
                }
                // 内容开始
                else if (data.type === 'content_start') {
                  isContentStarted = true
                  contentMessageId = Date.now()
                  setMessages(prev => [...prev, { 
                    id: contentMessageId,
                    type: 'system', 
                    content: '',
                    isStreaming: true
                  }])
                }
                // 内容
                else if (data.type === 'content') {
                  // 如果content_start事件还没收到，先创建消息
                  if (!isContentStarted || !contentMessageId) {
                    isContentStarted = true
                    contentMessageId = Date.now()
                    setMessages(prev => [...prev, { 
                      id: contentMessageId,
                      type: 'system', 
                      content: '',
                      isStreaming: true
                    }])
                  }
                  currentContent += data.chunk
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === contentMessageId) {
                      return { ...msg, content: currentContent }
                    }
                    return msg
                  }))
                }
                // 收款确认
                else if (data.type === 'payment_confirm') {
                  console.log('Received payment_confirm event:', data)
                  setLoading(false)
                  // 移除思考过程消息
                  setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                  // 创建收款确认卡片消息
                  const confirmData = data.data
                  setMessages(prev => [...prev, { 
                    id: Date.now(),
                    type: 'payment_confirm', 
                    paymentData: confirmData,
                    content: confirmData.message
                  }])
                }
                // 收料确认卡片
                else if (data.type === 'receipt_confirm') {
                  setLoading(false)
                  setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                  // 创建收料确认卡片消息
                  const confirmData = data.data
                  setMessages(prev => [...prev, { 
                    id: Date.now(),
                    type: 'receipt_confirm', 
                    receiptData: confirmData,
                    content: confirmData.message
                  }])
                }
                // 提料确认卡片
                else if (data.type === 'withdrawal_confirm') {
                  setLoading(false)
                  setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                  // 创建提料确认卡片消息
                  const confirmData = data.data
                  setMessages(prev => [...prev, { 
                    id: Date.now(),
                    type: 'withdrawal_confirm', 
                    withdrawalData: confirmData,
                    content: confirmData.message
                  }])
                }
                // 完成
                else if (data.type === 'complete') {
                  console.log('Received complete event:', data)
                  setLoading(false)
                  // 移除思考过程消息（如果存在）
                  setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                  
                  // 如果没有内容消息（比如入库操作直接返回结果），创建一个新消息
                  if (!contentMessageId || !isContentStarted) {
                      console.log('Create new system message to display result')
                    contentMessageId = Date.now()
                    // 处理入库等操作的响应
                    if (data.data) {
                      // ========== 智能表单弹出：当信息不完整时自动弹出表单 ==========
                      if (data.data.need_form) {
                        console.log('Detected need_form flag, popup corresponding form:', data.data.action)
                        
                        // 根据操作类型弹出对应的表单
                        if (onNeedForm) {
                          onNeedForm(data.data.action)
                        }
                        
                        // 添加提示消息
                        setMessages(prev => [...prev, { 
                          type: 'system', 
                          content: data.data.message || '📝 请在弹出的表格中填写完整信息',
                          id: contentMessageId
                        }])
                        return  // 不再继续处理
                      }
                      
                      let messageContent = ''
                      if (data.data.message) {
                        messageContent = data.data.message
                      } else if (data.data.success !== undefined) {
                        messageContent = data.data.success 
                          ? '操作成功完成' 
                          : (data.data.error || '操作失败')
                      }
                      
                      console.log('Create message, content:', messageContent)
                      
                      // 检查是否是入库操作，如果是则创建待确认的卡片数据
                      let inboundCard = null
                      let inboundCards = null  // 多商品入库时使用
                      // 打印完整 data.data 对象
                      console.log('[Inbound Debug] Complete data.data:', JSON.stringify(data.data, null, 2))
                      console.log('[Inbound Debug] all_products exists:', 'all_products' in (data.data || {}))
                      console.log('[Inbound Debug] all_products value:', data.data?.all_products)
                      console.log('[Inbound Debug] all_products length:', data.data?.all_products?.length)
                      
                      if (data.data?.success && data.data?.pending && data.data?.card_data) {
                        // 方案B：创建待确认的卡片（status: 'pending'）
                        try {
                          // 统一使用 all_products（如果没有则使用 card_data 作为单元素数组）
                          console.log('[Debug] data.data.all_products original:', data.data.all_products)
                          console.log('[Debug] data.data.card_data original:', data.data.card_data)
                          
                          const allProducts = data.data.all_products && data.data.all_products.length > 0 
                            ? data.data.all_products 
                            : [data.data.card_data]
                          console.log('收到待确认商品数据，共', allProducts.length, '个商品', allProducts)
                          
                          // 统一创建卡片数组（无论单商品还是多商品）
                          inboundCards = allProducts.map((cardData, index) => {
                            console.log(`[Debug] Create card ${index+1}:`, cardData)
                            const card = createNewCard({
                              productName: cardData.product_name,
                              goldWeight: cardData.weight,
                              laborCostPerGram: cardData.labor_cost,
                              pieceCount: cardData.piece_count,
                              pieceLaborCost: cardData.piece_labor_cost,
                              totalCost: cardData.total_cost,
                              supplier: {
                                id: 0,
                                name: cardData.supplier || '未知供应商',
                              },
                              status: 'pending',
                              source: 'api',
                              createdAt: new Date(),
                            })
                            card.barcode = ''
                            return card
                          })
                          console.log('Create inbound cards, total:', inboundCards.length, inboundCards)
                          
                          // 如果只有一个商品，同时设置 inboundCard（向后兼容）
                          if (inboundCards.length === 1) {
                            inboundCard = inboundCards[0]
                            inboundCards = null  // 单商品时清空数组，使用单卡片显示
                          }
                        } catch (error) {
                          console.error('Create inbound cards failed:', error)
                        }
                      } else if (data.data?.success && data.data?.order && data.data?.detail && !data.data?.pending) {
                        // 如果已经有订单和明细，且没有pending标志，说明是已确认的（向后兼容或直接入库的情况）
                        console.log('Detected confirmed inbound data (backward compatible)')
                        const orderNo = data.data.order.order_no || ''
                        if (orderNo.startsWith('RK')) {
                          try {
                            inboundCard = createCardFromBackend(
                              data.data.detail,
                              null
                            )
                            inboundCard.orderNo = orderNo
                            inboundCard.orderId = data.data.order.id
                            if (!inboundCard.barcode) {
                              inboundCard.barcode = orderNo
                            }
                            inboundCard.status = 'confirmed'
                            console.log('Create confirmed inbound card (backward compatible):', inboundCard)
                          } catch (error) {
                            console.error('Create inbound card failed:', error)
                          }
                        }
                      } else {
                        console.log('No match for inbound card condition, data:', data.data)
                      }
                      
                      setMessages(prev => [...prev, {
                        id: contentMessageId,
                        type: 'system',
                        content: messageContent,
                        isStreaming: false,
                        // 添加其他数据（如订单信息等）
                        order: data.data.order,
                        detail: data.data.detail,
                        inventory: data.data.inventory,
                        chartData: data.data.chart_data,
                        pieData: data.data.pie_data,
                        chartType: data.data.action,
                        rawData: data.data.raw_data,
                        // AI意图识别结果（用于可视化显示）
                        detectedIntent: data.data.action,
                        // 添加入库卡片数据（单商品或多商品）
                        inboundCard: inboundCard,
                        inboundCards: inboundCards,
                      }])
                    } else {
                      console.warn('complete event has no data field')
                    }
                  } else {
                    console.log('Update existing content message')
                    // 如果有内容消息，更新它
                    setMessages(prev => prev.map(msg => {
                      if (msg.id === contentMessageId) {
                        const updatedMsg = { 
                          ...msg, 
                          isStreaming: false
                        }
                        // 只有在有图表数据时才添加
                        if (data.data?.chart_data) {
                          updatedMsg.chartData = data.data.chart_data
                          updatedMsg.chartType = data.data.action
                        }
                        if (data.data?.pie_data) {
                          updatedMsg.pieData = data.data.pie_data
                        }
                        // 添加其他数据
                        if (data.data?.order) updatedMsg.order = data.data.order
                        if (data.data?.detail) updatedMsg.detail = data.data.detail
                        if (data.data?.inventory) updatedMsg.inventory = data.data.inventory
                        if (data.data?.raw_data) updatedMsg.rawData = data.data.raw_data
                        
                        // 如果是入库操作，创建卡片数据
                        if (data.data?.success && data.data?.order && data.data?.detail) {
                          const orderNo = data.data.order.order_no || ''
                          if (orderNo.startsWith('RK')) {
                            try {
                              const inboundCard = createCardFromBackend(data.data.detail, null)
                              inboundCard.orderNo = orderNo
                              inboundCard.orderId = data.data.order.id
                              if (!inboundCard.barcode) {
                                inboundCard.barcode = orderNo // 使用订单号作为条码
                              }
                              inboundCard.status = 'confirmed'
                              updatedMsg.inboundCard = inboundCard
                            } catch (error) {
                              console.error('Create inbound card failed:', error)
                            }
                          }
                        }
                        
                        return updatedMsg
                      }
                      return msg
                    }))
                  }
                }
                // 错误
                else if (data.type === 'error') {
                  setLoading(false)
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === thinkingMessageId || msg.id === contentMessageId) {
                      return { ...msg, type: 'system', content: `❌ ${data.message}`, isStreaming: false }
                    }
                    return msg
                  }))
                }
              } catch (e) {
                console.error('Parse SSE data failed:', e)
              }
            }
          }
        } catch (readError) {
          console.error('Read SSE stream failed:', readError)
          setLoading(false)
          setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: `❌ 读取流式响应失败：${readError.message}` 
          }])
          break
        }
      }
    } catch (error) {
      // 如果是请求被取消（用户切换页面或发送新消息），静默处理
      if (error.name === 'AbortError') {
          console.log('SSE request cancelled')
        setLoading(false)
        setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
        return
      }
      
      setLoading(false)
      // 移除思考过程消息
      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
      
      let errorMessage = `❌ 网络错误：${error.message}`
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行（http://localhost:8000）'
      }
      
      setMessages(prev => [...prev, { 
        type: 'system', 
        content: errorMessage 
      }])
    }
  }

  return { input, setInput, loading, sendMessage }
}
