/**
 * 通用 API 调用工具函数
 * 统一处理错误、toast提示、loading状态等
 */
import toast from 'react-hot-toast';
import { API_ENDPOINTS } from '../config';

// API 响应基础接口
export interface ApiResponse<T = any> {
  success?: boolean;
  message?: string;
  detail?: string;
  [key: string]: any;
}

// API 调用选项
interface ApiCallOptions {
  showSuccessToast?: boolean;  // 是否显示成功提示
  showErrorToast?: boolean;    // 是否显示错误提示（默认 true）
  successMessage?: string;     // 自定义成功消息
  errorMessage?: string;       // 自定义错误消息
}

/**
 * 通用 API 调用函数
 * @param endpoint API 端点（不含基础 URL）
 * @param options 请求选项
 * @param toastOptions toast 选项
 * @returns API 响应数据或 null
 */
export async function apiCall<T = any>(
  endpoint: string,
  requestOptions?: RequestInit,
  toastOptions: ApiCallOptions = {}
): Promise<T | null> {
  const {
    showSuccessToast = false,
    showErrorToast = true,
    successMessage,
    errorMessage,
  } = toastOptions;

  try {
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${API_ENDPOINTS.API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, requestOptions);
    const data = await response.json();

    // 检查响应状态
    if (!response.ok) {
      const errMsg = errorMessage || data.detail || data.message || '请求失败';
      if (showErrorToast) {
        toast.error(errMsg);
      }
      console.error('API请求失败:', errMsg, data);
      return null;
    }

    // 检查业务逻辑成功
    if (data.success === false) {
      const errMsg = errorMessage || data.message || data.detail || '操作失败';
      if (showErrorToast) {
        toast.error(errMsg);
      }
      console.error('API业务失败:', errMsg, data);
      return null;
    }

    // 成功
    if (showSuccessToast) {
      toast.success(successMessage || data.message || '操作成功');
    }
    
    return data as T;
  } catch (error) {
    const errMsg = errorMessage || '网络错误，请稍后重试';
    if (showErrorToast) {
      toast.error(errMsg);
    }
    console.error('API调用异常:', error);
    return null;
  }
}

/**
 * GET 请求
 */
export async function apiGet<T = any>(
  endpoint: string,
  toastOptions: ApiCallOptions = {}
): Promise<T | null> {
  return apiCall<T>(endpoint, { method: 'GET' }, toastOptions);
}

/**
 * POST 请求
 */
export async function apiPost<T = any>(
  endpoint: string,
  body: any,
  toastOptions: ApiCallOptions = {}
): Promise<T | null> {
  return apiCall<T>(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    toastOptions
  );
}

/**
 * PUT 请求
 */
export async function apiPut<T = any>(
  endpoint: string,
  body: any,
  toastOptions: ApiCallOptions = {}
): Promise<T | null> {
  return apiCall<T>(
    endpoint,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    toastOptions
  );
}

/**
 * DELETE 请求
 */
export async function apiDelete<T = any>(
  endpoint: string,
  toastOptions: ApiCallOptions = {}
): Promise<T | null> {
  return apiCall<T>(endpoint, { method: 'DELETE' }, toastOptions);
}

/**
 * 构建查询参数字符串
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  return searchParams.toString();
}

/**
 * 打开下载/打印链接
 */
export function openDownloadUrl(endpoint: string): void {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_ENDPOINTS.API_BASE_URL}${endpoint}`;
  window.open(url, '_blank');
}

