"""
外部API密钥认证模块

通过环境变量 FBL_EXTERNAL_API_KEY 配置API密钥，
外部调用方在请求头中携带 X-API-Key 进行身份验证。

支持多密钥（逗号分隔），方便为不同调用方分配独立密钥。
"""

import os
import secrets
import logging
from fastapi import Security, HTTPException, Depends
from fastapi.security import APIKeyHeader

logger = logging.getLogger(__name__)

# API Key 请求头名称
API_KEY_HEADER_NAME = "X-API-Key"

# 从环境变量读取允许的API Key列表（逗号分隔，支持多个调用方）
_raw_keys = os.getenv("FBL_EXTERNAL_API_KEYS", "")
VALID_API_KEYS: set[str] = {
    k.strip() for k in _raw_keys.split(",") if k.strip()
}

if VALID_API_KEYS:
    logger.info(f"外部API认证已启用，已加载 {len(VALID_API_KEYS)} 个API Key")
else:
    logger.warning("未配置 FBL_EXTERNAL_API_KEYS 环境变量，外部API将拒绝所有请求")

# FastAPI Security 依赖
api_key_header = APIKeyHeader(name=API_KEY_HEADER_NAME, auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    """
    验证请求头中的 API Key。
    
    成功返回 API Key（可用于日志追踪），
    失败抛出 401/403 HTTPException。
    """
    if not api_key:
        logger.warning("外部API请求缺少 X-API-Key 请求头")
        raise HTTPException(
            status_code=401,
            detail={
                "success": False,
                "code": "MISSING_API_KEY",
                "message": "缺少身份验证信息，请在请求头中提供 X-API-Key"
            }
        )
    
    if not VALID_API_KEYS:
        logger.error("服务端未配置任何API Key (FBL_EXTERNAL_API_KEYS)")
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "code": "API_KEY_NOT_CONFIGURED",
                "message": "服务端未配置API密钥，请联系管理员"
            }
        )
    
    # 使用 secrets.compare_digest 防止时序攻击
    is_valid = any(
        secrets.compare_digest(api_key, valid_key)
        for valid_key in VALID_API_KEYS
    )
    
    if not is_valid:
        logger.warning(f"外部API请求使用了无效的API Key: {api_key[:8]}...")
        raise HTTPException(
            status_code=403,
            detail={
                "success": False,
                "code": "INVALID_API_KEY",
                "message": "API Key 无效或已过期"
            }
        )
    
    # 记录脱敏后的Key，方便追踪
    masked_key = f"{api_key[:8]}...{api_key[-4:]}" if len(api_key) > 12 else "***"
    logger.info(f"外部API认证通过: {masked_key}")
    
    return api_key


def generate_api_key(prefix: str = "fbl") -> str:
    """
    生成一个安全的 API Key。
    
    格式: {prefix}_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (共40字符)
    仅供管理员在命令行中生成密钥时使用。
    """
    random_part = secrets.token_hex(16)
    return f"{prefix}_{random_part}"
