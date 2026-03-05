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
  retryCount?: number;         // 重试次数（默认 2）
  retryDelay?: number;         // 重试延迟（毫秒，默认 1000）
}

/**
 * 通用 API 调用函数（带重试机制）
 * @param endpoint API 端点（不含基础 URL）
 * @param options 请求选项
 * @param toastOptions toast 选项
 * @param retryCount 当前重试次数（内部使用）
 * @returns API 响应数据或 null
 */
export async function apiCall<T = any>(
  endpoint: string,
  requestOptions?: RequestInit,
  toastOptions: ApiCallOptions = {},
  retryCount = 0
): Promise<T | null> {
  const {
    showSuccessToast = false,
    showErrorToast = true,
    successMessage,
    errorMessage,
    retryCount: maxRetries = 2,
    retryDelay = 1000,
  } = toastOptions;

  try {
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${API_ENDPOINTS.API_BASE_URL}${endpoint}`;
    
    const userRole = typeof window !== 'undefined'
      ? localStorage.getItem('userRole') || 'sales'
      : 'sales';

    const response = await fetch(url, {
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': userRole,
        ...requestOptions?.headers,
      },
    });
    
    const data = await response.json();

    // 检查响应状态
    if (!response.ok) {
      const errMsg = errorMessage || data.detail || data.message || '请求失败';
      if (showErrorToast) {
        toast.error(errMsg);
      }
      return null;
    }

    // 检查业务逻辑成功
    if (data.success === false) {
      const errMsg = errorMessage || data.message || data.detail || '操作失败';
      if (showErrorToast) {
        toast.error(errMsg);
      }
      return null;
    }

    // 成功
    if (showSuccessToast) {
      toast.success(successMessage || data.message || '操作成功');
    }
    
    return data as T;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isNetworkError = errorMsg.includes('fetch') || 
                          errorMsg.includes('network') || 
                          errorMsg.includes('CORS') ||
                          errorMsg.includes('Failed to fetch');
    
    // 如果是网络错误且还有重试次数，则重试
    if (isNetworkError && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return apiCall<T>(endpoint, requestOptions, toastOptions, retryCount + 1);
    }
    
    // 最终失败
    const errMsg = errorMessage || '网络错误，请稍后重试';
    if (showErrorToast) {
      toast.error(errMsg);
    }
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
 * 统一错误处理：从 catch 块中提取用户友好的错误消息并显示 toast
 * 用法: catch (err) { handleApiError(err, '加载数据失败') }
 */
export function handleApiError(error: any, fallbackMessage = '操作失败，请稍后重试'): string {
  let msg = fallbackMessage;
  if (error?.response) {
    const data = error.response.data || error.response;
    msg = data?.detail || data?.message || fallbackMessage;
  } else if (error?.message) {
    msg = error.message.includes('fetch') || error.message.includes('network')
      ? '网络连接失败，请检查网络后重试'
      : error.message;
  }
  toast.error(msg);
  return msg;
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
  const baseUrl = endpoint.startsWith('http')
    ? endpoint
    : `${API_ENDPOINTS.API_BASE_URL}${endpoint}`;

  // 某些导出接口使用浏览器直开链接，无法自动附带自定义 Header。
  // 这里统一补 user_role 查询参数，确保后端能识别当前角色。
  const userRole = typeof window !== 'undefined'
    ? (localStorage.getItem('userRole') || 'sales')
    : 'sales';
  const separator = baseUrl.includes('?') ? '&' : '?';
  const finalUrl = baseUrl.includes('user_role=')
    ? baseUrl
    : `${baseUrl}${separator}user_role=${encodeURIComponent(userRole)}`;

  window.open(finalUrl, '_blank');
}


