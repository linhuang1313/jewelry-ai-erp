"""
百度智能云 OCR 模块
使用百度云通用文字识别 API 进行图片文字识别
"""
import os
import base64
import requests
import logging
from typing import Dict, Optional
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# 百度云 API 配置
BAIDU_API_KEY = os.getenv("BAIDU_OCR_API_KEY", "")
BAIDU_SECRET_KEY = os.getenv("BAIDU_OCR_SECRET_KEY", "")

# API 地址
TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic"  # 高精度版
OCR_GENERAL_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"  # 通用版（免费额度更多）

# 缓存 access_token
_access_token = None
_token_expires = 0


def is_ocr_configured() -> bool:
    """检查 OCR 是否已配置"""
    return bool(BAIDU_API_KEY and BAIDU_SECRET_KEY)


def get_access_token() -> str:
    """获取百度云 API access_token"""
    global _access_token, _token_expires
    
    import time
    current_time = time.time()
    
    # 如果 token 还有效，直接返回
    if _access_token and current_time < _token_expires - 60:
        return _access_token
    
    if not BAIDU_API_KEY or not BAIDU_SECRET_KEY:
        raise RuntimeError("百度云 OCR 未配置：请设置 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY 环境变量")
    
    try:
        params = {
            "grant_type": "client_credentials",
            "client_id": BAIDU_API_KEY,
            "client_secret": BAIDU_SECRET_KEY
        }
        response = requests.post(TOKEN_URL, params=params, timeout=10)
        result = response.json()
        
        if "access_token" in result:
            _access_token = result["access_token"]
            _token_expires = current_time + result.get("expires_in", 2592000)  # 默认30天
            logger.info("百度云 OCR access_token 获取成功")
            return _access_token
        else:
            raise RuntimeError(f"获取 access_token 失败: {result}")
    except requests.RequestException as e:
        raise RuntimeError(f"请求百度云 API 失败: {e}")


def recognize_image(image_path: str = None, image_bytes: bytes = None, use_accurate: bool = False) -> Dict:
    """
    识别图片中的文字
    
    Args:
        image_path: 图片文件路径
        image_bytes: 图片二进制数据
        use_accurate: 是否使用高精度版（消耗更多额度）
    
    Returns:
        识别结果字典
    """
    if not is_ocr_configured():
        raise RuntimeError("百度云 OCR 未配置：请设置 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY")
    
    # 获取图片数据
    if image_bytes:
        image_data = image_bytes
    elif image_path:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片文件不存在: {image_path}")
        with open(image_path, "rb") as f:
            image_data = f.read()
    else:
        raise ValueError("请提供 image_path 或 image_bytes")
    
    # Base64 编码
    image_base64 = base64.b64encode(image_data).decode("utf-8")
    
    # 获取 access_token
    access_token = get_access_token()
    
    # 选择 API
    ocr_url = OCR_URL if use_accurate else OCR_GENERAL_URL
    
    # 调用 OCR API
    try:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        params = {"access_token": access_token}
        data = {
            "image": image_base64,
            "language_type": "CHN_ENG",  # 中英文混合
            "detect_direction": "true",  # 检测图片方向
            "paragraph": "true",  # 段落输出
        }
        
        response = requests.post(
            ocr_url,
            headers=headers,
            params=params,
            data=data,
            timeout=30
        )
        result = response.json()
        
        if "error_code" in result:
            error_msg = result.get("error_msg", "未知错误")
            logger.error(f"百度云 OCR 识别失败: {error_msg}")
            raise RuntimeError(f"OCR 识别失败: {error_msg}")
        
        # 提取文字
        words_result = result.get("words_result", [])
        texts = [item.get("words", "") for item in words_result]
        full_text = "\n".join(texts)
        
        logger.info(f"百度云 OCR 识别完成，识别到 {len(texts)} 行文字")
        
        return {
            "success": True,
            "full_text": full_text,
            "line_count": len(texts),
            "words_result": words_result,
            "log_id": result.get("log_id")
        }
        
    except requests.RequestException as e:
        logger.error(f"百度云 OCR 请求失败: {e}")
        raise RuntimeError(f"OCR 请求失败: {e}")


def extract_text_from_image(image_path: str = None, image_bytes: bytes = None) -> str:
    """
    从图片中提取文字（简化接口）
    
    Returns:
        识别到的完整文本
    """
    result = recognize_image(image_path=image_path, image_bytes=image_bytes)
    return result.get("full_text", "")


def parse_inbound_sheet(image_path: str = None, image_bytes: bytes = None) -> Dict:
    """
    识别入库单图片并解析信息
    
    Returns:
        解析后的入库单信息
    """
    from .ai_parser import parse_user_message
    
    # 识别图片
    text = extract_text_from_image(image_path=image_path, image_bytes=image_bytes)
    
    if not text.strip():
        return {
            "success": False,
            "message": "未能识别到任何文字",
            "recognized_text": ""
        }
    
    # 使用 AI 解析
    enhanced_text = f"""这是一张入库单的图片识别结果，请提取入库信息：

{text}

请识别并提取商品信息（商品名称、重量、工费、供应商）。"""
    
    ai_result = parse_user_message(enhanced_text)
    
    return {
        "success": True,
        "recognized_text": text,
        "parsed_data": ai_result
    }

