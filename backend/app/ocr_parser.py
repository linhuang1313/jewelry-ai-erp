"""
OCR识别模块：使用PaddleOCR识别入库单图片
注意：OCR功能在云端部署时被禁用（依赖包太大）
"""
import os
from typing import Optional, Dict, List, Any
import logging

logger = logging.getLogger(__name__)

# 尝试导入 OCR 相关依赖（云端部署时可能不可用）
OCR_AVAILABLE = False
np = None
cv2 = None

try:
    import numpy as np
    import cv2
    OCR_AVAILABLE = True
    logger.info("OCR 依赖已加载（numpy/cv2）")
except ImportError as e:
    logger.warning(f"OCR 依赖不可用（numpy/cv2 未安装）: {e}")
    logger.warning("OCR 功能已禁用，请在本地运行以使用图片识别功能")

# 初始化OCR引擎（单例模式）
ocr_engine = None
_ocr_init_attempted = False


def get_ocr_engine():
    """获取OCR引擎（单例模式，避免重复加载模型）"""
    global ocr_engine, _ocr_init_attempted
    
    # 检查 OCR 依赖是否可用
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR 功能不可用：numpy/cv2 未安装。请在本地运行以使用图片识别功能。")
    
    if ocr_engine is not None:
        return ocr_engine
        
    if _ocr_init_attempted:
        raise RuntimeError("OCR引擎初始化已失败，请重启服务后重试")
    
    _ocr_init_attempted = True
    
    try:
        import sys
        logger.info(f"Python版本: {sys.version}")
        logger.info("正在初始化PaddleOCR引擎...")
        
        os.environ['PADDLEX_DISABLE_INITIALIZATION'] = '1'
        os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
        
        try:
            import paddle
            logger.info(f"paddle 版本: {paddle.__version__}")
        except ImportError as paddle_error:
            raise ImportError(f"缺少 paddlepaddle 依赖: {paddle_error}") from paddle_error
        
        from paddleocr import PaddleOCR
        import logging as log_module
        
        log_module.getLogger('ppocr').setLevel(log_module.ERROR)
        log_module.getLogger('paddle').setLevel(log_module.ERROR)
        
        ocr_engine = PaddleOCR(lang='ch', use_angle_cls=True, use_gpu=False)
        logger.info("PaddleOCR引擎初始化完成")
        
    except ImportError:
        raise
    except Exception as e:
        error_str = str(e)
        if "already been initialized" in error_str or "Reinitialization is not supported" in error_str:
            logger.warning("PaddleX 已初始化，尝试重用...")
            try:
                from paddleocr import PaddleOCR
                ocr_engine = PaddleOCR(lang='ch', use_angle_cls=True, use_gpu=False, show_log=False)
                logger.info("PaddleOCR引擎重用成功")
            except Exception as retry_error:
                raise RuntimeError(f"重用OCR引擎失败: {retry_error}") from retry_error
        else:
            logger.error(f"PaddleOCR初始化失败：{e}", exc_info=True)
            raise
            
    return ocr_engine


def preprocess_image(image_path: str) -> Any:
    """图片预处理：提高OCR识别准确率"""
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR 功能不可用")
    
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"图片文件不存在：{image_path}")
    
    valid_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']
    file_ext = os.path.splitext(image_path)[1].lower()
    if file_ext not in valid_extensions:
        raise ValueError(f"不支持的图片格式：{file_ext}")
    
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"无法读取图片：{image_path}")
    
    if img.size == 0:
        raise ValueError(f"图片文件为空：{image_path}")
    
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img
    
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    denoised = cv2.fastNlMeansDenoising(binary, None, 10, 7, 21)
    
    return denoised


def extract_text_from_image(image_path: str, return_details: bool = False):
    """从图片中提取文字"""
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR 功能不可用：依赖未安装")
    
    try:
        processed_img = preprocess_image(image_path)
        ocr = get_ocr_engine()
        result = ocr.ocr(processed_img, cls=True)
        
        texts = []
        details = []
        if result and result[0]:
            for line in result[0]:
                if line and len(line) >= 2:
                    position = line[0]
                    text = line[1][0]
                    confidence = line[1][1]
                    
                    if confidence > 0.5:
                        texts.append(text)
                        if return_details:
                            details.append({
                                "text": text,
                                "confidence": float(confidence),
                                "position": position
                            })
        
        if return_details:
            return {
                "full_text": "\n".join(texts),
                "line_count": len(texts),
                "details": details
            }
        
        full_text = "\n".join(texts)
        logger.info(f"OCR识别完成，识别到 {len(texts)} 行文字")
        return full_text
    
    except Exception as e:
        logger.error(f"OCR识别出错：{e}", exc_info=True)
        raise


def parse_inbound_sheet_text(text: str) -> Dict:
    """解析识别出的文本，提取入库信息"""
    from .ai_parser import parse_user_message
    
    enhanced_text = f"""这是一张入库单的图片识别结果，请提取入库信息：

{text}

请识别并提取商品信息（商品名称、重量、工费、供应商）。"""
    
    return parse_user_message(enhanced_text)
