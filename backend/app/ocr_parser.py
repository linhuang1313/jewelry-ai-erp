"""
OCR识别模块：已废弃，使用百度云OCR替代
保留此文件用于向后兼容
"""
import logging
from typing import Dict

logger = logging.getLogger(__name__)

# 本地 OCR 功能已禁用，使用百度云 OCR
OCR_AVAILABLE = False


def get_ocr_engine():
    """获取OCR引擎（已废弃）"""
    raise RuntimeError("本地 OCR 功能已禁用，请使用百度云 OCR")


def preprocess_image(image_path: str):
    """图片预处理（已废弃）"""
    raise RuntimeError("本地 OCR 功能已禁用，请使用百度云 OCR")


def extract_text_from_image(image_path: str, return_details: bool = False):
    """从图片中提取文字（已废弃）"""
    raise RuntimeError("本地 OCR 功能已禁用，请使用百度云 OCR")


def parse_inbound_sheet_text(text: str) -> Dict:
    """解析识别出的文本，提取入库信息"""
    from .ai_parser import parse_user_message
    
    enhanced_text = f"""这是一张入库单的图片识别结果，请提取入库信息：

{text}

请识别并提取商品信息（商品名称、重量、工费、供应商）。"""
    
    return parse_user_message(enhanced_text)

