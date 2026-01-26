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

export interface TransactionItem {
  date: string;
  datetime?: string;
  type: string;  // 销售结算, 客户来料, 客户来款
  orderNo: string;
  goldAmount: number;  // 正数=客户欠料, 负数=客户给料
  cashAmount: number;  // 正数=客户欠款, 负数=客户付款
  remark?: string;
}

export interface StatementData {
  customer: { id: number; name: string; phone?: string; customerNo: string };
  period: { start: Date | string; end: Date | string };
  summary: {
    openingBalance: number;
    openingGold?: number;
    totalSales: number;
    totalPayments: number;
    totalGold?: number;
    totalCash?: number;
    closingBalance: number;
    closingGold?: number;
  };
  transactions?: TransactionItem[];  // 合并的往来明细
  salesDetails: Array<{
    date: Date | string;
    orderNo: string;
    amount: number;
    salesperson?: string;
  }>;
  paymentDetails: Array<{
    date: Date | string;
    amount: number;
    method: string;
    relatedOrderNo?: string;
  }>;
  generatedAt: Date | string;
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
    const response = await fetch(`${API_BASE_URL}/api/finance/statement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: customerId,
        period_start_date: startDate.toISOString().split('T')[0],
        period_end_date: endDate.toISOString().split('T')[0],
      }),
    });
    
    const result = await response.json();
    
    if (result.success && result.data) {
      // 将后端返回的数据转换为前端期望的格式
      const rawData = result.data;
      const transformedData: StatementData = {
        statementNo: rawData.statement_no,
        customer: {
          id: rawData.customer?.id,
          name: rawData.customer?.name,
          phone: rawData.customer?.phone,
          customerNo: rawData.customer?.customer_no,
        },
        period: {
          start: rawData.period?.start,
          end: rawData.period?.end,
        },
        summary: {
          openingBalance: rawData.summary?.openingBalance ?? 0,
          openingGold: rawData.summary?.openingGold ?? 0,
          totalSales: rawData.summary?.totalSales ?? 0,
          totalPayments: rawData.summary?.totalPayments ?? 0,
          totalGold: rawData.summary?.totalGold ?? 0,
          totalCash: rawData.summary?.totalCash ?? 0,
          closingBalance: rawData.summary?.closingBalance ?? 0,
          closingGold: rawData.summary?.closingGold ?? 0,
        },
        // 合并的往来明细
        transactions: (rawData.transactions || []).map((item: any) => ({
          date: item.date,
          datetime: item.datetime,
          type: item.type,
          orderNo: item.order_no,
          goldAmount: item.gold_amount ?? 0,
          cashAmount: item.cash_amount ?? 0,
          remark: item.remark || '',
        })),
        salesDetails: (rawData.salesDetails || []).map((item: any) => ({
          date: item.sales_date || item.date,
          orderNo: item.sales_order_no || item.orderNo,
          amount: item.sales_amount || item.amount || 0,
          salesperson: item.salesperson,
        })),
        paymentDetails: (rawData.paymentDetails || []).map((item: any) => ({
          date: item.payment_date || item.date,
          amount: item.payment_amount || item.amount || 0,
          method: item.payment_method || item.method || '',
          relatedOrderNo: item.related_order_no || item.relatedOrderNo,
        })),
        generatedAt: rawData.generatedAt,
      };
      
      return {
        success: true,
        data: transformedData,
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


// ==================== 应付账款API ====================

export interface PayableItem {
  id: number;
  payable_no: string;
  supplier_id: number;
  supplier_name: string;
  inbound_order_id?: number;
  inbound_order_no?: string;
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  credit_days: number;
  credit_start_date: string;
  due_date: string;
  overdue_days: number;
  status: string;
  is_overdue: boolean;
  remark?: string;
  create_time: string;
}

export interface PayablesResponse {
  success: boolean;
  data?: PayableItem[];
  total?: number;
  error?: string;
}

export async function getPayables(
  filterType: string = 'all',
  supplierId?: number,
  skip: number = 0,
  limit: number = 100
): Promise<PayablesResponse> {
  try {
    const params = new URLSearchParams({
      filter_type: filterType,
      skip: skip.toString(),
      limit: limit.toString(),
    });
    if (supplierId) {
      params.append('supplier_id', supplierId.toString());
    }
    
    const response = await fetch(`${API_BASE_URL}/api/finance/payables?${params}`);
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('获取应付账款失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function getPayablesStatistics(): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/finance/payables/statistics`);
    return await response.json();
  } catch (error) {
    console.error('获取应付账款统计失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function recordSupplierPayment(
  supplierId: number,
  amount: number,
  paymentMethod: string = 'bank_transfer',
  paymentDate?: string,
  remark?: string
): Promise<{ success: boolean; message?: string; data?: any; error?: string }> {
  try {
    const params = new URLSearchParams({
      supplier_id: supplierId.toString(),
      amount: amount.toString(),
      payment_method: paymentMethod,
    });
    if (paymentDate) params.append('payment_date', paymentDate);
    if (remark) params.append('remark', remark);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/supplier-payment?${params}`, {
      method: 'POST',
    });
    return await response.json();
  } catch (error) {
    console.error('供应商付款失败:', error);
    return { success: false, error: '网络错误' };
  }
}


// ==================== 资金流水API ====================

export interface BankAccountItem {
  id: number;
  account_name: string;
  account_no?: string;
  bank_name?: string;
  account_type: string;
  initial_balance: number;
  current_balance: number;
  is_default: boolean;
  status: string;
  description?: string;
  create_time: string;
}

export interface CashFlowItem {
  id: number;
  flow_no: string;
  account_id: number;
  account_name?: string;
  flow_type: string;
  category: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  related_type?: string;
  related_id?: number;
  flow_date: string;
  counterparty?: string;
  remark?: string;
  created_by: string;
  create_time: string;
}

export async function getBankAccounts(): Promise<{ success: boolean; data?: BankAccountItem[]; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/finance/accounts`);
    return await response.json();
  } catch (error) {
    console.error('获取银行账户失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function createBankAccount(
  accountName: string,
  accountType: string = 'bank',
  initialBalance: number = 0,
  isDefault: boolean = false
): Promise<{ success: boolean; message?: string; data?: any; error?: string }> {
  try {
    const params = new URLSearchParams({
      account_name: accountName,
      account_type: accountType,
      initial_balance: initialBalance.toString(),
      is_default: isDefault.toString(),
    });
    
    const response = await fetch(`${API_BASE_URL}/api/finance/accounts?${params}`, {
      method: 'POST',
    });
    return await response.json();
  } catch (error) {
    console.error('创建银行账户失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function getCashFlows(
  accountId?: number,
  flowType?: string,
  startDate?: string,
  endDate?: string,
  skip: number = 0,
  limit: number = 100
): Promise<{ success: boolean; data?: CashFlowItem[]; total?: number; error?: string }> {
  try {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });
    if (accountId) params.append('account_id', accountId.toString());
    if (flowType) params.append('flow_type', flowType);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/cashflow?${params}`);
    return await response.json();
  } catch (error) {
    console.error('获取资金流水失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function getCashFlowSummary(
  accountId?: number,
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (accountId) params.append('account_id', accountId.toString());
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/cashflow/summary?${params}`);
    return await response.json();
  } catch (error) {
    console.error('获取资金流水汇总失败:', error);
    return { success: false, error: '网络错误' };
  }
}


// ==================== 费用管理API ====================

export interface ExpenseCategory {
  id: number;
  code: string;
  name: string;
  parent_id?: number;
  description?: string;
  sort_order: number;
  is_active: boolean;
}

export interface ExpenseItem {
  id: number;
  expense_no: string;
  category_id: number;
  category_name?: string;
  account_id?: number;
  account_name?: string;
  amount: number;
  expense_date: string;
  payee?: string;
  payment_method?: string;
  status: string;
  remark?: string;
  created_by: string;
  approved_by?: string;
  approved_at?: string;
  create_time: string;
}

export async function getExpenseCategories(): Promise<{ success: boolean; data?: ExpenseCategory[]; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/finance/expense-categories`);
    return await response.json();
  } catch (error) {
    console.error('获取费用类别失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function initExpenseCategories(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/finance/expense-categories/init`, {
      method: 'POST',
    });
    return await response.json();
  } catch (error) {
    console.error('初始化费用类别失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function getExpenses(
  categoryId?: number,
  status?: string,
  startDate?: string,
  endDate?: string,
  skip: number = 0,
  limit: number = 100
): Promise<{ success: boolean; data?: ExpenseItem[]; total?: number; error?: string }> {
  try {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });
    if (categoryId) params.append('category_id', categoryId.toString());
    if (status) params.append('status', status);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/expenses?${params}`);
    return await response.json();
  } catch (error) {
    console.error('获取费用列表失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function createExpense(
  categoryId: number,
  amount: number,
  expenseDate: string,
  accountId?: number,
  payee?: string,
  remark?: string,
  autoApprove: boolean = true
): Promise<{ success: boolean; message?: string; data?: any; error?: string }> {
  try {
    const params = new URLSearchParams({
      category_id: categoryId.toString(),
      amount: amount.toString(),
      expense_date: expenseDate,
      auto_approve: autoApprove.toString(),
    });
    if (accountId) params.append('account_id', accountId.toString());
    if (payee) params.append('payee', payee);
    if (remark) params.append('remark', remark);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/expenses?${params}`, {
      method: 'POST',
    });
    return await response.json();
  } catch (error) {
    console.error('创建费用失败:', error);
    return { success: false, error: '网络错误' };
  }
}

export async function getExpensesSummary(
  startDate?: string,
  endDate?: string,
  groupBy: string = 'category'
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const params = new URLSearchParams({ group_by: groupBy });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await fetch(`${API_BASE_URL}/api/finance/expenses/summary?${params}`);
    return await response.json();
  } catch (error) {
    console.error('获取费用汇总失败:', error);
    return { success: false, error: '网络错误' };
  }
}
