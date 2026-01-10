"""
OCR识别模块：使用PaddleOCR识别入库单图片
注意：OCR功能在云端部署时被禁用（依赖包太大）
"""
import os
from typing import Optional, Dict, List
import logging

logger = logging.getLogger(__name__)

# 尝试导入 OCR 相关依赖（云端部署时可能不可用）
OCR_AVAILABLE = False
try:
    import numpy as np
    import cv2
    OCR_AVAILABLE = True
except ImportError as e:
    logger.warning(f"OCR 依赖不可用（numpy/cv2 未安装）: {e}")
    logger.warning("OCR 功能已禁用，请在本地运行以使用图片识别功能")

# 初始化OCR引擎（单例模式）
ocr_engine = None
_ocr_init_attempted = False  # 标记是否已尝试初始化

def get_ocr_engine():
    """获取OCR引擎（单例模式，避免重复加载模型）"""
    global ocr_engine, _ocr_init_attempted
    
    # 检查 OCR 依赖是否可用
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR 功能不可用：numpy/cv2 未安装。请在本地运行以使用图片识别功能。")
    
    if ocr_engine is not None:
        return ocr_engine
        
    if _ocr_init_attempted:
        # 如果已经尝试过初始化但失败了，不再重试
        raise RuntimeError("OCR引擎初始化已失败，请重启服务后重试")
    
    _ocr_init_attempted = True
    
    try:
        import sys
        logger.info(f"Python版本: {sys.version}")
        logger.info(f"Python路径: {sys.executable}")
        logger.info("正在初始化PaddleOCR引擎（首次使用需要下载模型，可能需要几分钟）...")
        
        # 设置环境变量，禁用 PaddleX 的某些检查
        os.environ['PADDLEX_DISABLE_INITIALIZATION'] = '1'
        os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'
        
        # 先检查 paddle 模块是否可用
        try:
            import paddle
            logger.info(f"paddle 模块已导入，路径: {paddle.__file__}")
            logger.info(f"paddle 版本: {paddle.__version__}")
        except ImportError as paddle_error:
            error_msg = (
                f"缺少 paddlepaddle 依赖。\n"
                f"当前Python版本: {sys.version}\n"
                f"当前Python路径: {sys.executable}\n"
                f"请使用 Python 3.10 运行以下命令安装：\n"
                f"py -3.10 -m pip install paddlepaddle\n"
                f"如果安装失败，请访问 https://www.paddlepaddle.org.cn/install/quick 查看安装指南\n"
                f"原始错误：{paddle_error}"
            )
            logger.error(error_msg)
            raise ImportError(error_msg) from paddle_error
        
        from paddleocr import PaddleOCR
        import logging
        
        # 关闭PaddleOCR的日志输出（减少控制台噪音）
        logging.getLogger('ppocr').setLevel(logging.ERROR)
        logging.getLogger('paddle').setLevel(logging.ERROR)
        
        # 使用最简单的初始化方式，只指定语言（最稳定，兼容所有版本）
        ocr_engine = PaddleOCR(lang='ch', use_angle_cls=True, use_gpu=False)
        logger.info("PaddleOCR引擎初始化完成")
        
    except ImportError:
        # 重新抛出 ImportError，让调用者知道是依赖问题
        raise
    except Exception as e:
        error_str = str(e)
        # 处理 PaddleX 重复初始化的问题
        if "already been initialized" in error_str or "Reinitialization is not supported" in error_str:
            logger.warning("PaddleX 已初始化，尝试重用现有引擎...")
            # 尝试直接使用 PaddleOCR（不触发 PaddleX 初始化）
            try:
                from paddleocr import PaddleOCR
                # 使用 show_log=False 减少日志
                ocr_engine = PaddleOCR(lang='ch', use_angle_cls=True, use_gpu=False, show_log=False)
                logger.info("PaddleOCR引擎重用成功")
            except Exception as retry_error:
                logger.error(f"重用OCR引擎失败: {retry_error}")
                raise RuntimeError(
                    "PaddleX 重复初始化问题。请完全重启后端服务（不使用 --reload）：\n"
                    "1. 关闭当前服务\n"
                    "2. 运行: python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
                ) from retry_error
        else:
            logger.error(f"PaddleOCR初始化失败：{e}", exc_info=True)
            raise
            
    return ocr_engine

def preprocess_image(image_path: str) -> np.ndarray:
    """
    图片预处理：提高OCR识别准确率
    - 灰度化
    - 二值化
    - 去噪
    """
    try:
        # 检查文件是否存在
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片文件不存在：{image_path}")
        
        # 检查文件扩展名
        valid_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']
        file_ext = os.path.splitext(image_path)[1].lower()
        if file_ext not in valid_extensions:
            raise ValueError(f"不支持的图片格式：{file_ext}。支持的格式：{', '.join(valid_extensions)}")
        
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"无法读取图片：{image_path}。请检查文件是否损坏或格式是否正确。")
        
        # 检查图片是否为空
        if img.size == 0:
            raise ValueError(f"图片文件为空：{image_path}")
        
        # 转为灰度图
        if len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img
        
        # 二值化（提高文字对比度）
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # 去噪
        denoised = cv2.fastNlMeansDenoising(binary, None, 10, 7, 21)
        
        return denoised
    except FileNotFoundError:
        logger.error(f"图片文件不存在：{image_path}")
        raise
    except ValueError as e:
        logger.error(f"图片格式错误：{e}")
        raise
    except Exception as e:
        logger.error(f"图片预处理失败：{e}", exc_info=True)
        raise

def extract_text_from_image(image_path: str, return_details: bool = False):
    """
    从图片中提取文字
    
    Args:
        image_path: 图片文件路径
        return_details: 是否返回详细信息（包含位置和置信度）
        
    Returns:
        如果 return_details=False: 识别出的完整文本（多行，用换行符分隔）
        如果 return_details=True: 包含文字、位置、置信度的字典
    """
    try:
        # 预处理图片
        processed_img = preprocess_image(image_path)
        
        # OCR识别
        ocr = get_ocr_engine()
        result = ocr.ocr(processed_img, cls=True)
        
        # 提取所有文字
        texts = []
        details = []
        if result and result[0]:
            for line in result[0]:
                if line and len(line) >= 2:
                    # line[0] 是位置坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                    # line[1] 是 (文字内容, 置信度)
                    position = line[0]
                    text = line[1][0]  # 文字内容
                    confidence = line[1][1]  # 置信度
                    
                    if confidence > 0.5:  # 只保留置信度>0.5的文字
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
        logger.debug(f"OCR识别结果：{full_text[:200]}...")
        return full_text
    
    except Exception as e:
        logger.error(f"OCR识别出错：{e}", exc_info=True)
        raise

def parse_inbound_sheet_text(text: str) -> Dict:
    """
    解析识别出的文本，提取入库信息
    使用现有的AI解析逻辑（复用ai_parser）
    
    Args:
        text: OCR识别出的文本
        
    Returns:
        AIResponse对象
    """
    from .ai_parser import parse_user_message
    
    # 构建增强提示，让AI理解这是从图片识别出的入库单
    enhanced_text = f"""这是一张入库单的图片识别结果，请提取入库信息：

{text}

请识别并提取：
1. 供应商名称
2. 商品信息（商品名称、重量、工费等）
3. 如果有多个商品，请全部列出

重要规则：
- 每张入库单只能有一个供应商
- 如果识别出多个供应商，请只使用第一个或最明确的供应商
- 商品信息要完整：商品名称、重量（克）、工费（元/克）、供应商

请返回JSON格式的入库信息。"""
    
    return parse_user_message(enhanced_text)
