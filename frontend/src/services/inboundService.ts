/**
 * 入库相关 API 服务
 */
import type { JewelryInboundCard } from '../types/inbound';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import { prepareInboundRequest } from '../utils/inboundHelpers';

/**
 * 确认入库 API
 * 将前端卡片数据转换为后端格式并提交
 */
export async function handleInbound(card: JewelryInboundCard): Promise<{
  success: boolean;
  order?: {
    id: number;
    order_no: string;
    create_time: string;
    status: string;
  };
  detail?: {
    id: number;
    product_name: string;
    weight: number;
    labor_cost: number;
    total_cost: number;
  };
  message?: string;
  error?: string;
}> {
  try {
    // 使用工具函数准备请求数据
    const requestData = prepareInboundRequest(card);

    const response = await fetch(API_ENDPOINTS.INBOUND_ORDERS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.message || `入库失败: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      order: result.order,
      detail: result.detail,
      message: result.message || '入库成功',
    };
  } catch (error) {
    console.error('入库失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '入库失败',
    };
  }
}

/**
 * 报告数据错误 API
 * 提交数据错误报告
 */
export async function handleReportError(
  card: JewelryInboundCard,
  errorReason?: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    // 使用错误报告端点（如果后端实现了）
    const reportUrl = API_ENDPOINTS.REPORT_ERROR || `${API_BASE_URL}/api/report-error`;
    
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        card_id: card.id,
        product_name: card.productName,
        barcode: card.barcode,
        error_type: 'data_mismatch',
        error_reason: errorReason || '数据核对不一致',
        timestamp: new Date().toISOString(),
        card_data: {
          goldWeight: card.goldWeight,
          laborCostPerGram: card.laborCostPerGram,
          goldPrice: card.goldPrice,
          totalCost: card.totalCost,
          supplier: card.supplier,
          gemstones: card.gemstones,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`报错提交失败: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      message: result.message || '错误报告已提交',
    };
  } catch (error) {
    console.error('报错提交失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '报错提交失败',
    };
  }
}

// ============= Mock 函数（开发测试用） =============

/**
 * 模拟入库成功
 * 用于开发和测试，不调用真实 API
 */
export async function mockHandleInbound(card: JewelryInboundCard): Promise<void> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // 模拟成功响应
  console.log('✅ [Mock] 入库成功:', {
    productName: card.productName,
    barcode: card.barcode,
    goldWeight: card.goldWeight,
    laborCostPerGram: card.laborCostPerGram,
    goldPrice: card.goldPrice,
    totalCost: card.totalCost,
  });
  
  // 显示成功通知（实际项目中应该使用 toast 组件）
  if (typeof window !== 'undefined') {
    alert(`✅ 入库成功！\n\n产品：${card.productName}\n条码：${card.barcode}\n金重：${card.goldWeight}克\n总成本：¥${card.totalCost?.toFixed(2) || '0.00'}`);
  }
}

/**
 * 模拟报错提交
 * 用于开发和测试
 */
export async function mockHandleReportError(
  card: JewelryInboundCard,
  errorReason?: string
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('⚠️ [Mock] 数据报错:', {
    cardId: card.id,
    productName: card.productName,
    errorReason: errorReason || '数据核对不一致',
  });
  
  if (typeof window !== 'undefined') {
    alert(`⚠️ 已提交数据报错\n\n产品：${card.productName}\n条码：${card.barcode}\n错误原因：${errorReason || '数据核对不一致'}\n\n我们会尽快核实处理。`);
  }
}

// ============= 包装函数（统一接口） =============

/**
 * 确认入库（自动选择真实 API 或 Mock）
 */
export async function confirmInbound(
  card: JewelryInboundCard,
  useMock: boolean = false
): Promise<{
  success: boolean;
  order?: { id: number; order_no: string; create_time: string; status: string; };
  detail?: { id: number; product_name: string; weight: number; labor_cost: number; total_cost: number; };
  message?: string;
  error?: string;
}> {
  // 强制使用真实API，不使用Mock（因为Mock返回的时间戳ID无法用于下载）
  // 如果 useMock=true，仍然使用真实API，但会记录警告
  if (useMock) {
    console.warn('警告：confirmInbound 已强制使用真实API，忽略 useMock=true 参数');
  }
  
  const result = await handleInbound(card);
  if (!result.success) {
    throw new Error(result.error || '入库失败');
  }
  
  // 验证返回的order.id是否是有效的数据库ID（应该是较小的整数，不是时间戳）
  if (result.order && result.order.id > 1000000000000) {
    console.error('警告：返回的order.id看起来像时间戳而不是数据库ID:', result.order.id);
  }
  
  return result;
}

/**
 * 报告错误（自动选择真实 API 或 Mock）
 */
export async function reportError(
  card: JewelryInboundCard,
  errorReason?: string,
  useMock: boolean = false
): Promise<void> {
  // 开发环境默认使用 Mock，除非明确指定 useMock=false
  const shouldUseMock = useMock || (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false');
  
  if (shouldUseMock) {
    await mockHandleReportError(card, errorReason);
  } else {
    const result = await handleReportError(card, errorReason);
    if (!result.success) {
      throw new Error(result.error || '报错提交失败');
    }
  }
}


 */
import type { JewelryInboundCard } from '../types/inbound';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import { prepareInboundRequest } from '../utils/inboundHelpers';

/**
 * 确认入库 API
 * 将前端卡片数据转换为后端格式并提交
 */
export async function handleInbound(card: JewelryInboundCard): Promise<{
  success: boolean;
  order?: {
    id: number;
    order_no: string;
    create_time: string;
    status: string;
  };
  detail?: {
    id: number;
    product_name: string;
    weight: number;
    labor_cost: number;
    total_cost: number;
  };
  message?: string;
  error?: string;
}> {
  try {
    // 使用工具函数准备请求数据
    const requestData = prepareInboundRequest(card);

    const response = await fetch(API_ENDPOINTS.INBOUND_ORDERS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.message || `入库失败: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      order: result.order,
      detail: result.detail,
      message: result.message || '入库成功',
    };
  } catch (error) {
    console.error('入库失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '入库失败',
    };
  }
}

/**
 * 报告数据错误 API
 * 提交数据错误报告
 */
export async function handleReportError(
  card: JewelryInboundCard,
  errorReason?: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    // 使用错误报告端点（如果后端实现了）
    const reportUrl = API_ENDPOINTS.REPORT_ERROR || `${API_BASE_URL}/api/report-error`;
    
    const response = await fetch(reportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        card_id: card.id,
        product_name: card.productName,
        barcode: card.barcode,
        error_type: 'data_mismatch',
        error_reason: errorReason || '数据核对不一致',
        timestamp: new Date().toISOString(),
        card_data: {
          goldWeight: card.goldWeight,
          laborCostPerGram: card.laborCostPerGram,
          goldPrice: card.goldPrice,
          totalCost: card.totalCost,
          supplier: card.supplier,
          gemstones: card.gemstones,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`报错提交失败: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      message: result.message || '错误报告已提交',
    };
  } catch (error) {
    console.error('报错提交失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '报错提交失败',
    };
  }
}

// ============= Mock 函数（开发测试用） =============

/**
 * 模拟入库成功
 * 用于开发和测试，不调用真实 API
 */
export async function mockHandleInbound(card: JewelryInboundCard): Promise<void> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // 模拟成功响应
  console.log('✅ [Mock] 入库成功:', {
    productName: card.productName,
    barcode: card.barcode,
    goldWeight: card.goldWeight,
    laborCostPerGram: card.laborCostPerGram,
    goldPrice: card.goldPrice,
    totalCost: card.totalCost,
  });
  
  // 显示成功通知（实际项目中应该使用 toast 组件）
  if (typeof window !== 'undefined') {
    alert(`✅ 入库成功！\n\n产品：${card.productName}\n条码：${card.barcode}\n金重：${card.goldWeight}克\n总成本：¥${card.totalCost?.toFixed(2) || '0.00'}`);
  }
}

/**
 * 模拟报错提交
 * 用于开发和测试
 */
export async function mockHandleReportError(
  card: JewelryInboundCard,
  errorReason?: string
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('⚠️ [Mock] 数据报错:', {
    cardId: card.id,
    productName: card.productName,
    errorReason: errorReason || '数据核对不一致',
  });
  
  if (typeof window !== 'undefined') {
    alert(`⚠️ 已提交数据报错\n\n产品：${card.productName}\n条码：${card.barcode}\n错误原因：${errorReason || '数据核对不一致'}\n\n我们会尽快核实处理。`);
  }
}

// ============= 包装函数（统一接口） =============

/**
 * 确认入库（自动选择真实 API 或 Mock）
 */
export async function confirmInbound(
  card: JewelryInboundCard,
  useMock: boolean = false
): Promise<{
  success: boolean;
  order?: { id: number; order_no: string; create_time: string; status: string; };
  detail?: { id: number; product_name: string; weight: number; labor_cost: number; total_cost: number; };
  message?: string;
  error?: string;
}> {
  // 强制使用真实API，不使用Mock（因为Mock返回的时间戳ID无法用于下载）
  // 如果 useMock=true，仍然使用真实API，但会记录警告
  if (useMock) {
    console.warn('警告：confirmInbound 已强制使用真实API，忽略 useMock=true 参数');
  }
  
  const result = await handleInbound(card);
  if (!result.success) {
    throw new Error(result.error || '入库失败');
  }
  
  // 验证返回的order.id是否是有效的数据库ID（应该是较小的整数，不是时间戳）
  if (result.order && result.order.id > 1000000000000) {
    console.error('警告：返回的order.id看起来像时间戳而不是数据库ID:', result.order.id);
  }
  
  return result;
}

/**
 * 报告错误（自动选择真实 API 或 Mock）
 */
export async function reportError(
  card: JewelryInboundCard,
  errorReason?: string,
  useMock: boolean = false
): Promise<void> {
  // 开发环境默认使用 Mock，除非明确指定 useMock=false
  const shouldUseMock = useMock || (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false');
  
  if (shouldUseMock) {
    await mockHandleReportError(card, errorReason);
  } else {
    const result = await handleReportError(card, errorReason);
    if (!result.success) {
      throw new Error(result.error || '报错提交失败');
    }
  }
}

