# backend/app/services/gold_price_service.py
"""
金价服务 - 获取实时金价和市场趋势

功能：
1. 获取当前金价（支持API对接或手动配置）
2. 获取市场趋势
3. 将金价转换为区间标签
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


class GoldPriceService:
    """金价服务 - 获取实时金价和市场趋势"""
    
    # 缓存
    _cache = {
        "price": None,
        "trend": None,
        "updated_at": None
    }
    
    # 缓存过期时间（分钟）
    CACHE_EXPIRY_MINUTES = 5
    
    @classmethod
    async def get_current_price(cls) -> float:
        """
        获取当前金价（元/克），带缓存
        
        返回:
            当前金价，如果获取失败返回环境变量配置值或默认值
        """
        # 检查缓存是否有效
        if cls._cache["updated_at"] and \
           datetime.now() - cls._cache["updated_at"] < timedelta(minutes=cls.CACHE_EXPIRY_MINUTES):
            return cls._cache["price"]
        
        try:
            # 方案1：调用金价API（需要注册获取API Key）
            # 示例代码（取消注释后可用）：
            # import httpx
            # async with httpx.AsyncClient() as client:
            #     response = await client.get(
            #         "https://api.jijinhao.com/quoteCenter/history.htm",
            #         params={"code": "JO_52683", "style": "3"},
            #         timeout=5.0
            #     )
            #     if response.status_code == 200:
            #         data = response.json()
            #         price = float(data.get("price", 0))
            #         if price > 0:
            #             cls._cache["price"] = price
            #             cls._cache["updated_at"] = datetime.now()
            #             return price
            
            # 方案2：使用环境变量配置（当前默认方案）
            price = float(os.getenv("CURRENT_GOLD_PRICE", "1086"))
            
            cls._cache["price"] = price
            cls._cache["updated_at"] = datetime.now()
            
            logger.info(f"[GoldPrice] 当前金价: {price} 元/克")
            return price
            
        except Exception as e:
            logger.error(f"[GoldPrice] 获取金价失败: {e}")
            # 返回缓存值或默认值
            return cls._cache.get("price") or 1086.0
    
    @classmethod
    def get_current_price_sync(cls) -> float:
        """
        同步获取当前金价（用于非异步上下文）
        
        返回:
            当前金价
        """
        # 检查缓存
        if cls._cache["updated_at"] and \
           datetime.now() - cls._cache["updated_at"] < timedelta(minutes=cls.CACHE_EXPIRY_MINUTES):
            return cls._cache["price"]
        
        # 使用环境变量配置
        price = float(os.getenv("CURRENT_GOLD_PRICE", "1086"))
        cls._cache["price"] = price
        cls._cache["updated_at"] = datetime.now()
        
        return price
    
    @classmethod
    async def get_market_trend(cls) -> str:
        """
        获取市场趋势
        
        返回:
            "up" - 上涨
            "down" - 下跌
            "stable" - 平稳
        """
        # 检查缓存
        if cls._cache["trend"] and cls._cache["updated_at"] and \
           datetime.now() - cls._cache["updated_at"] < timedelta(minutes=cls.CACHE_EXPIRY_MINUTES):
            return cls._cache["trend"]
        
        try:
            # 方案1：对接金价历史数据API，计算7日趋势
            # 示例代码（取消注释后可用）：
            # import httpx
            # async with httpx.AsyncClient() as client:
            #     response = await client.get(
            #         "https://api.example.com/gold-history",
            #         params={"days": 7},
            #         timeout=5.0
            #     )
            #     if response.status_code == 200:
            #         data = response.json()
            #         # 计算趋势逻辑...
            #         trend = calculate_trend(data)
            #         cls._cache["trend"] = trend
            #         return trend
            
            # 方案2：使用环境变量配置（当前默认方案）
            trend = os.getenv("GOLD_MARKET_TREND", "up")
            
            cls._cache["trend"] = trend
            logger.info(f"[GoldPrice] 市场趋势: {trend}")
            return trend
            
        except Exception as e:
            logger.error(f"[GoldPrice] 获取市场趋势失败: {e}")
            return cls._cache.get("trend") or "stable"
    
    @classmethod
    def get_market_trend_sync(cls) -> str:
        """同步获取市场趋势"""
        if cls._cache["trend"]:
            return cls._cache["trend"]
        
        trend = os.getenv("GOLD_MARKET_TREND", "up")
        cls._cache["trend"] = trend
        return trend
    
    @classmethod
    def get_price_range_label(cls, price: float) -> str:
        """
        获取金价区间标签（2025-2026年标准）
        
        参数:
            price: 金价（元/克）
        
        返回:
            区间标签字符串
        """
        if not price or price <= 0:
            return "未知"
        
        if price < 900:
            return "低价区(<900)"
        elif price < 950:
            return "中低价区(900-950)"
        elif price < 1000:
            return "中价区(950-1000)"
        elif price < 1050:
            return "中高价区(1000-1050)"
        elif price < 1100:
            return "高价区(1050-1100)"
        else:
            return "超高价区(>1100)"
    
    @classmethod
    def get_trend_display(cls, trend: str) -> str:
        """
        获取趋势的中文显示
        
        参数:
            trend: 趋势代码 (up/down/stable)
        
        返回:
            中文显示字符串
        """
        trend_map = {
            "up": "上涨 📈",
            "down": "下跌 📉",
            "stable": "平稳 ➡️"
        }
        return trend_map.get(trend, trend)
    
    @classmethod
    def update_price(cls, price: float):
        """
        手动更新金价（供管理员使用）
        
        参数:
            price: 新的金价
        """
        cls._cache["price"] = price
        cls._cache["updated_at"] = datetime.now()
        logger.info(f"[GoldPrice] 金价已手动更新: {price} 元/克")
    
    @classmethod
    def update_trend(cls, trend: str):
        """
        手动更新市场趋势（供管理员使用）
        
        参数:
            trend: 新的趋势 (up/down/stable)
        """
        if trend not in ["up", "down", "stable"]:
            raise ValueError("趋势必须是 up/down/stable 之一")
        
        cls._cache["trend"] = trend
        cls._cache["updated_at"] = datetime.now()
        logger.info(f"[GoldPrice] 市场趋势已手动更新: {trend}")


# === 便捷函数 ===

async def get_gold_price() -> float:
    """获取当前金价"""
    return await GoldPriceService.get_current_price()


async def get_gold_trend() -> str:
    """获取市场趋势"""
    return await GoldPriceService.get_market_trend()


def get_gold_price_sync() -> float:
    """同步获取当前金价"""
    return GoldPriceService.get_current_price_sync()


def get_gold_trend_sync() -> str:
    """同步获取市场趋势"""
    return GoldPriceService.get_market_trend_sync()

