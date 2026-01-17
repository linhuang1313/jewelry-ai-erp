import { PaymentMethod } from '../types/finance';
import { API_BASE_URL } from '../config';

export interface PaymentSubmitData {
  customerId: number;
  customerName: string;
  receivableId?: number;
  salesOrderId?: number;
  salesOrderNo?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  voucherImage?: string;
  remark?: string;
}

export interface PaymentSubmitResponse {
  success: boolean;
  paymentId?: string;
  message?: string;
  error?: string;
}

export interface StatementData {
  customer: { id: number; name: string; phone?: string; customerNo: string };
  period: { start: Date; end: Date };
  summary: {
    openingBalance: number;
    totalSales: number;
    totalPayments: number;
    closingBalance: number;
  };
  salesDetails: Array<{
    date: Date;
    orderNo: string;
    amount: number;
    salesperson?: string;
  }>;
  paymentDetails: Array<{
    date: Date;
    amount: number;
    method: string;
    relatedOrderNo?: string;
  }>;
  generatedAt: Date;
  statementNo: string;
}

export interface ReconciliationGenerateResponse {
  success: boolean;
  data?: StatementData;
  error?: string;
  message?: string;
}

export interface ReceivableItem {
  id: number;
  salesOrderId: number;
  customerId: number;
  totalAmount: number;
  receivedAmount: number;
  unpaidAmount: number;
  status: string;
  isOverdue: boolean;
  overdueDays: number;
  creditStartDate: string;
  dueDate: string;
  customer?: {
    id: number;
    customerNo: string;
    name: string;
    phone?: string;
  };
  salesOrder?: {
    id: number;
    orderNo: string;
    orderDate: string;
    salesperson?: string;
    totalAmount: number;
  };
}

export interface ReceivablesResponse {
  success: boolean;
  data?: ReceivableItem[];
  total?: number;
  error?: string;
}

/**
 * 将后端返回的 snake_case 数据转换为前端的 camelCase
 */
function convertReceivableFromBackend(item: any): ReceivableItem {
  return {
    id: item.id,
    salesOrderId: item.sales_order_id,
    customerId: item.customer_id,
    totalAmount: item.total_amount ?? 0,
    receivedAmount: item.received_amount ?? 0,
    unpaidAmount: item.unpaid_amount ?? 0,
    status: item.status,
    isOverdue: item.is_overdue ?? false,
    overdueDays: item.overdue_days ?? 0,
    creditStartDate: item.credit_start_date,
    dueDate: item.due_date,
    customer: item.customer ? {
      id: item.customer.id,
      customerNo: item.customer.customer_no,
      name: item.customer.name,
      phone: item.customer.phone,
    } : undefined,
    salesOrder: item.sales_order ? {
      id: item.sales_order.id,
      orderNo: item.sales_order.order_no,
      orderDate: item.sales_order.order_date,
      salesperson: item.sales_order.salesperson,
      totalAmount: item.sales_order.total_amount ?? 0,
    } : undefined,
  };
}

export interface ReceivablesFilterParams {
  filterType?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  startDate?: string;
  endDate?: string;
  salesOrderNo?: string;
  settlementNo?: string;
  skip?: number;
  limit?: number;
}

/**
 * 获取应收账款列表
 */
export async function getReceivables(
  filterType: string = 'all',
  search?: string,
  sortBy: string = 'overdue_days',
  sortOrder: string = 'desc',
  skip: number = 0,
  limit: number = 100,
  startDate?: string,
  endDate?: string,
  salesOrderNo?: string,
  settlementNo?: string
): Promise<ReceivablesResponse> {
  try {
    const params = new URLSearchParams({
      filter_type: filterType,
      sort_by: sortBy,
      sort_order: sortOrder,
      skip: skip.toString(),
      limit: limit.toString(),
    });
    
    if (search) {
      params.append('search', search);
    }
    if (startDate) {
      params.append('start_date', startDate);
    }
    if (endDate) {
      params.append('end_date', endDate);
    }
    if (salesOrderNo) {
      params.append('sales_order_no', salesOrderNo);
    }
    if (settlementNo) {
      params.append('settlement_no', settlementNo);
    }
    
    const response = await fetch(`${API_BASE_URL}/api/finance/receivables?${params}`);
    const result = await response.json();
    
    if (result.success) {
      // 转换后端 snake_case 数据为前端 camelCase
      const convertedData = (result.data || []).map(convertReceivableFromBackend);
      return {
        success: true,
        data: convertedData,
        total: result.total,
      };
    } else {
      return {
        success: false,
        error: result.error || '获取应收账款失败',
      };
    }
  } catch (error) {
    console.error('获取应收账款失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}

/**
 * 提交收款记录
 */
export async function submitPayment(data: PaymentSubmitData): Promise<PaymentSubmitResponse> {
  try {
    // 转换支付方式为后端格式
    const methodMap: Record<PaymentMethod, string> = {
      [PaymentMethod.CASH]: 'cash',
      [PaymentMethod.BANK_TRANSFER]: 'bank_transfer',
      [PaymentMethod.WECHAT]: 'wechat',
      [PaymentMethod.ALIPAY]: 'alipay',
      [PaymentMethod.CARD]: 'card',
      [PaymentMethod.CHECK]: 'check',
      [PaymentMethod.OTHER]: 'other',
    };
    
    const requestData = {
      customer_id: data.customerId,
      account_receivable_id: data.receivableId,
      amount: data.amount,
      payment_method: methodMap[data.paymentMethod] || 'bank_transfer',
      payment_date: data.paymentDate.toISOString().split('T')[0],
      remark: data.remark || '',
    };
    
    const response = await fetch(`${API_BASE_URL}/api/finance/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });
    
    const result = await response.json();
    
    if (result.success) {
      return {
        success: true,
        paymentId: result.data?.payment_id?.toString(),
        message: result.message || '收款记录已保存',
      };
    } else {
      return {
        success: false,
        error: result.error || '提交收款失败',
      };
    }
  } catch (error) {
    console.error('提交收款失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}

/**
 * 确认收款（从聊天界面调用）
 * 使用专门的聊天收款API，自动查找客户未付清的应收账款进行冲抵
 */
export async function confirmPayment(
  customerId: number,
  amount: number,
  paymentMethod: string = '转账',
  remark: string = ''
): Promise<PaymentSubmitResponse> {
  try {
    // 将中文支付方式转换为后端格式
    const methodMap: Record<string, string> = {
      '转账': 'bank_transfer',
      '现金': 'cash',
      '微信': 'wechat',
      '支付宝': 'alipay',
      '刷卡': 'card',
    };
    
    const paymentMethodCode = methodMap[paymentMethod] || 'bank_transfer';
    const paymentDate = new Date().toISOString().split('T')[0];
    
    // 使用专门的聊天收款API（支持不指定account_receivable_id）
    const params = new URLSearchParams({
      customer_id: customerId.toString(),
      amount: amount.toString(),
      payment_method: paymentMethodCode,
      payment_date: paymentDate,
      remark: remark || '聊天收款登记',
    });
    
    const response = await fetch(`${API_BASE_URL}/api/finance/payment/chat?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const result = await response.json();
    
    if (result.success) {
      return {
        success: true,
        paymentId: result.data?.payment_count?.toString(),
        message: result.data?.message || result.message || '收款登记成功',
      };
    } else {
      return {
        success: false,
        error: result.error || '收款登记失败',
      };
    }
  } catch (error) {
    console.error('收款登记失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}

/**
 * 获取客户未付清的销售单列表
 */
export async function getUnpaidSalesOrders(customerId: number): Promise<Array<{
  id: number;
  orderNo: string;
  unpaidAmount: number;
  totalAmount: number;
}>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/finance/receivables?filter_type=unpaid&customer_id=${customerId}`);
    const result = await response.json();
    
    if (result.success && result.data) {
      return result.data.map((r: ReceivableItem) => ({
        id: r.salesOrderId,
        orderNo: r.salesOrder?.orderNo || '',
        unpaidAmount: r.unpaidAmount,
        totalAmount: r.totalAmount,
      }));
    }
    return [];
  } catch (error) {
    console.error('获取未付清销售单失败:', error);
    return [];
  }
}

/**
 * 生成对账单
 */
export async function generateReconciliationStatement(
  customerId: number,
  startDate: Date,
  endDate: Date
): Promise<ReconciliationGenerateResponse> {
  try {
    const params = new URLSearchParams({
      customer_id: customerId.toString(),
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    });
    
    const response = await fetch(`${API_BASE_URL}/api/finance/statement?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: customerId,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
      }),
    });
    
    const result = await response.json();
    
    if (result.success) {
      return {
        success: true,
        data: result.data,
        message: '对账单生成成功',
      };
    } else {
      return {
        success: false,
        error: result.error || '生成对账单失败',
      };
    }
  } catch (error) {
    console.error('生成对账单失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}

export interface PaymentRecordItem {
  id: number;
  accountReceivableId?: number;
  customerId: number;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  voucherImages?: string;
  bankName?: string;
  remark?: string;
  operator?: string;
  createTime: string;
  customer?: {
    id: number;
    customerNo: string;
    name: string;
  };
}

export interface PaymentRecordsResponse {
  success: boolean;
  data?: PaymentRecordItem[];
  total?: number;
  error?: string;
}

export interface PaymentRecordsFilterParams {
  customerId?: number;
  startDate?: string;
  endDate?: string;
  salesOrderNo?: string;
  skip?: number;
  limit?: number;
}

/**
 * 获取收款记录列表
 */
export async function getPaymentRecords(
  customerId?: number,
  skip: number = 0,
  limit: number = 100,
  startDate?: string,
  endDate?: string,
  salesOrderNo?: string
): Promise<PaymentRecordsResponse> {
  try {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });
    
    if (customerId) {
      params.append('customer_id', customerId.toString());
    }
    if (startDate) {
      params.append('start_date', startDate);
    }
    if (endDate) {
      params.append('end_date', endDate);
    }
    if (salesOrderNo) {
      params.append('sales_order_no', salesOrderNo);
    }
    
    const response = await fetch(`${API_BASE_URL}/api/finance/payments?${params}`);
    const result = await response.json();
    
    if (result.success && result.data) {
      // 转换字段名为前端格式
      const records = result.data.records.map((r: any) => ({
        id: r.id,
        accountReceivableId: r.account_receivable_id,
        customerId: r.customer_id,
        paymentDate: r.payment_date,
        amount: r.amount,
        paymentMethod: r.payment_method,
        voucherImages: r.voucher_images,
        bankName: r.bank_name,
        remark: r.remark,
        operator: r.operator,
        createTime: r.create_time,
        customer: r.customer,
      }));
      
      return {
        success: true,
        data: records,
        total: result.data.total,
      };
    } else {
      return {
        success: false,
        error: result.error || '获取收款记录失败',
      };
    }
  } catch (error) {
    console.error('获取收款记录失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}
