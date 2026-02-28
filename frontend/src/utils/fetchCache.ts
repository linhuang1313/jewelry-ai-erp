import db from './db';

/**
 * 带有本地 IndexedDB 缓存功能的请求封装，适用于需要实现“秒开”的大数据量列表请求。
 * 
 * @param url 请求地址
 * @param options fetch 选项
 * @param onCacheHit 缓存命中时的回调函数（用于立即更新 UI）
 * @returns 返回网络请求的最新 JSON 数据
 */
export async function fetchWithCacheJson<T = any>(
    url: string,
    options: RequestInit = {},
    onCacheHit?: (data: T) => void
): Promise<T> {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';

    // 1. 如果是 GET 请求且提供了回调，则异步读取缓存并立即通知
    if (isGet && onCacheHit) {
        db.apiCache.get(url).then(cached => {
            if (cached && cached.data) {
                // 确保回调不抛出异常影响主流程
                try {
                    onCacheHit(cached.data);
                } catch (err) {
                    console.error('onCacheHit error:', err);
                }
            }
        }).catch(e => console.warn('Cache read error:', e));
    }

    // 2. 发起真实网络请求
    const controller = new AbortController();
    // 设置 15 秒超时
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        // 3. 成功后更新缓存
        if (isGet) {
            db.apiCache.put({ key: url, data, timestamp: Date.now() })
                .catch(e => console.warn('Cache write error:', e));
        }

        return data;
    } catch (error: any) {
        clearTimeout(timeoutId);

        // 网络请求失败时，尝试降级使用缓存（即使没传 onCacheHit）
        if (isGet) {
            try {
                const cached = await db.apiCache.get(url);
                if (cached && cached.data) {
                    console.log(`Network failed for ${url}, falling back to cache.`);
                    return cached.data;
                }
            } catch (e) {
                // 忽略缓存读取错误
            }
        }

        if (error.name === 'AbortError') {
            throw new Error('请求超时，请检查网络后重试');
        }
        throw error;
    }
}
