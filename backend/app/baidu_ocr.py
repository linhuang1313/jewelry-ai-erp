"""
百度智能云 OCR 模块
使用百度云文字识别 API 进行图片文字识别
支持通用文字识别和表格识别
"""
import os
import base64
import requests
import logging
import json
from pathlib import Path
from typing import Dict, Optional, List
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

# 百度云 API 配置
BAIDU_API_KEY = os.getenv("BAIDU_OCR_API_KEY", "")
BAIDU_SECRET_KEY = os.getenv("BAIDU_OCR_SECRET_KEY", "")

# API 地址
TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic"  # 高精度版
OCR_GENERAL_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"  # 通用版
OCR_TABLE_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/table"  # 表格识别（同步）
OCR_FORM_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/form"  # 表单识别

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


def recognize_table(image_path: str = None, image_bytes: bytes = None) -> Dict:
    """
    识别表格图片，保持表格结构
    
    Args:
        image_path: 图片文件路径
        image_bytes: 图片二进制数据
    
    Returns:
        识别结果字典，包含表格结构化数据
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
    
    # 调用表格识别 API
    try:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        params = {"access_token": access_token}
        data = {
            "image": image_base64,
        }
        
        response = requests.post(
            OCR_TABLE_URL,
            headers=headers,
            params=params,
            data=data,
            timeout=60  # 表格识别可能需要更长时间
        )
        result = response.json()
        
        if "error_code" in result:
            error_msg = result.get("error_msg", "未知错误")
            logger.error(f"百度云表格识别失败: {error_msg}")
            # 如果表格识别失败，回退到通用识别
            logger.info("回退到通用文字识别...")
            return recognize_image(image_bytes=image_data)
        
        # 解析表格结果
        tables_result = result.get("tables_result", [])
        forms_result = result.get("forms_result", [])
        
        # 构建格式化的文本输出
        formatted_lines = []
        
        # 处理表格数据
        for table in tables_result:
            body = table.get("body", [])
            if body:
                # 按行号分组
                rows = {}
                for cell in body:
                    row_idx = cell.get("row_start", 0)
                    if row_idx not in rows:
                        rows[row_idx] = []
                    rows[row_idx].append({
                        "col": cell.get("col_start", 0),
                        "text": cell.get("words", "")
                    })
                
                # 按行输出，列用制表符分隔
                for row_idx in sorted(rows.keys()):
                    cells = sorted(rows[row_idx], key=lambda x: x["col"])
                    row_text = "\t".join([c["text"] for c in cells])
                    formatted_lines.append(row_text)
        
        # 处理表单数据（如果有）
        for form in forms_result:
            for item in form:
                key = item.get("word_name", "")
                value = item.get("word", "")
                if key or value:
                    formatted_lines.append(f"{key}: {value}")
        
        # 如果没有识别到表格，回退到通用识别
        if not formatted_lines:
            logger.info("未识别到表格结构，回退到通用文字识别...")
            return recognize_image(image_bytes=image_data)
        
        full_text = "\n".join(formatted_lines)
        
        logger.info(f"百度云表格识别完成，识别到 {len(formatted_lines)} 行数据")
        
        return {
            "success": True,
            "full_text": full_text,
            "line_count": len(formatted_lines),
            "tables_result": tables_result,
            "forms_result": forms_result,
            "log_id": result.get("log_id"),
            "is_table": True
        }
        
    except requests.RequestException as e:
        logger.error(f"百度云表格识别请求失败: {e}")
        raise RuntimeError(f"表格识别请求失败: {e}")


def extract_text_from_image(image_path: str = None, image_bytes: bytes = None, use_table: bool = True) -> str:
    """
    从图片中提取文字（智能选择识别方式）
    
    Args:
        image_path: 图片文件路径
        image_bytes: 图片二进制数据
        use_table: 是否优先使用表格识别（默认True，适用于单据类图片）
    
    Returns:
        识别到的完整文本
    """
    if use_table:
        # 优先尝试表格识别
        try:
            result = recognize_table(image_path=image_path, image_bytes=image_bytes)
            return result.get("full_text", "")
        except Exception as e:
            logger.warning(f"表格识别失败，回退到通用识别: {e}")
    
    # 使用通用识别
    result = recognize_image(image_path=image_path, image_bytes=image_bytes)
    return result.get("full_text", "")


def parse_payment_proof(image_path: str = None, image_bytes: bytes = None) -> Dict:
    """
    识别转账截图并提取收款信息（付款人、金额、银行、流水号等）
    
    流程：百度 OCR 识别文字 -> DeepSeek 结构化提取
    """
    text = extract_text_from_image(image_path=image_path, image_bytes=image_bytes, use_table=False)
    
    if not text.strip():
        return {
            "success": False,
            "message": "未能识别到任何文字",
            "recognized_text": ""
        }
    
    import json as _json
    from openai import OpenAI
    import os
    
    client = OpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
        timeout=60.0
    )
    
    prompt = f"""你是一个银行转账截图信息提取助手。以下是从一张银行转账截图中 OCR 识别出的文字内容。
请从中提取以下信息，以 JSON 格式返回：

OCR 识别内容：
---
{text}
---

请提取并返回 JSON（只返回 JSON，不要其他内容）：
{{
  "payer_name": "付款人姓名（转出方/付款方的名字，如果是公司则写公司名）",
  "payee_name": "收款人姓名（收款方/转入方的名字）",
  "amount": 金额数字（纯数字，不带单位，如 8000.00）,
  "bank_name": "银行名称（如：中国工商银行、招商银行等）",
  "transfer_time": "转账时间（如：2026-02-17 22:31:57，尽量保持原始格式）",
  "transfer_no": "交易流水号/订单号/参考号（如果有的话）",
  "remark": "转账备注/附言（如果有的话）",
  "confidence": "high/medium/low（你对提取结果的信心程度）"
}}

注意：
- 如果某个字段无法识别，设为 null
- amount 必须是数字类型，不是字符串
- 优先识别付款人（payer_name），这通常是我们的客户
- 常见的转账截图来源：微信转账、支付宝转账、银行APP转账、网银转账回单"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            max_tokens=500,
            temperature=0.1,
            messages=[
                {"role": "system", "content": "你是一个精确的银行转账信息提取工具，只返回 JSON。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        result_text = response.choices[0].message.content.strip()
        parsed = _json.loads(result_text)
        
        return {
            "success": True,
            "recognized_text": text,
            "parsed_data": parsed
        }
    except Exception as e:
        logger.error(f"DeepSeek 解析转账截图失败: {e}")
        return {
            "success": True,
            "recognized_text": text,
            "parsed_data": None,
            "parse_error": str(e)
        }


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

