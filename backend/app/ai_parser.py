import json
import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional
from openai import OpenAI
from dotenv import load_dotenv
from .schemas import AIResponse
from .ai_prompts import pre_classify, build_context, get_category_prompt

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# DeepSeek API 客户端（使用 OpenAI 兼容格式）
# 延迟初始化，避免在环境变量未设置时导致启动失败
_client = None

def get_client():
    """获取 DeepSeek API 客户端（延迟初始化）"""
    global _client
    if _client is None:
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            _env_path = Path(__file__).resolve().parent.parent / ".env"
            load_dotenv(_env_path, override=True)
            logger.info(f"重新加载 .env: {_env_path}, exists={_env_path.exists()}")
            api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPSEEK_API_KEY 环境变量未设置，无法使用 AI 解析功能")
        _client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com",
            timeout=60.0
        )
    return _client

def parse_user_message(message: str, conversation_history: Optional[List[dict]] = None, user_role: str = "manager", session_entities: Optional[Dict] = None) -> AIResponse:
    """使用 DeepSeek API 解析用户自然语言输入（分类 prompt 版本）
    
    Args:
        message: 用户当前输入的消息
        conversation_history: 最近的对话历史，格式为 [{"role": "user/assistant", "content": "..."}]
        user_role: 当前用户角色，用于辅助意图推断
        session_entities: 会话中记住的实体信息（最近操作结果等）
    """
    
    # Step 1: 预分类（传入对话历史以理解追问）
    category = pre_classify(message, conversation_history)
    logger.info(f"预分类结果: {category}, 消息: {message[:50]}, 角色: {user_role}")
    
    # Step 2: 构建上下文
    context = build_context(conversation_history, session_entities=session_entities)
    
    # Step 3: 获取分类 prompt（传入角色信息）
    prompt = get_category_prompt(category, message, context, user_role=user_role)
    
    max_retries = 3
    retry_count = 0
    content = ""  # 初始化变量，避免作用域问题
    
    while retry_count < max_retries:
        try:
            logger.info(f"调用 DeepSeek API 解析消息 (尝试 {retry_count + 1}/{max_retries}): {message}")
            response = get_client().chat.completions.create(
                model="deepseek-chat",
                max_tokens=800,  # 意图解析不需要太多token
                temperature=0.1,  # 低温度确保稳定的意图识别
                response_format={"type": "json_object"},  # 强制输出合法JSON
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的珠宝ERP系统AI助手。你需要理解用户的自然语言输入，准确识别用户意图，并提取相关信息。你擅长理解各种口语化表达和业务场景。请始终以JSON格式输出。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            content = response.choices[0].message.content.strip()
            logger.info(f"DeepSeek API 原始响应: {content}")
            
            # 提取JSON部分（去除可能的markdown代码块标记）
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            
            # 尝试找到JSON对象
            start_idx = content.find('{')
            end_idx = content.rfind('}')
            if start_idx != -1 and end_idx != -1:
                content = content[start_idx:end_idx+1]
            
            data = json.loads(content)
            logger.info(f"解析后的数据: {data}")
            
            # 处理products数组
            if 'products' in data and isinstance(data['products'], list):
                # 确保每个商品的数值类型正确
                for product in data['products']:
                    if 'weight' in product and product['weight'] is not None:
                        try:
                            product['weight'] = float(product['weight'])
                        except (ValueError, TypeError):
                            logger.warning(f"无法转换weight为数字: {product.get('weight')}")
                            product['weight'] = None
                    
                    if 'labor_cost' in product and product['labor_cost'] is not None:
                        try:
                            product['labor_cost'] = float(product['labor_cost'])
                        except (ValueError, TypeError):
                            logger.warning(f"无法转换labor_cost为数字: {product.get('labor_cost')}")
                            product['labor_cost'] = None
            
            # 向后兼容：如果没有products但有单个商品字段，转换为products数组
            if 'products' not in data or not data['products']:
                if 'product_name' in data and data.get('product_name'):
                    data['products'] = [{
                        'product_name': data.get('product_name'),
                        'weight': data.get('weight'),
                        'labor_cost': data.get('labor_cost'),
                        'supplier': data.get('supplier')
                    }]
            
            # 确保weight和labor_cost是数字类型（向后兼容）
            if 'weight' in data and data['weight'] is not None:
                try:
                    data['weight'] = float(data['weight'])
                except (ValueError, TypeError):
                    logger.warning(f"无法转换weight为数字: {data.get('weight')}")
                    data['weight'] = None
            
            if 'labor_cost' in data and data['labor_cost'] is not None:
                try:
                    data['labor_cost'] = float(data['labor_cost'])
                except (ValueError, TypeError):
                    logger.warning(f"无法转换labor_cost为数字: {data.get('labor_cost')}")
                    data['labor_cost'] = None
            
            logger.info(f"[成功] Claude API调用成功，解析完成")
            return AIResponse(**data)
        
        except json.JSONDecodeError as e:
            logger.error(f"JSON解析错误 (尝试 {retry_count + 1}/{max_retries}): {e}, 原始内容: {content}")
            retry_count += 1
            if retry_count >= max_retries:
                logger.error(f"JSON解析失败，已达到最大重试次数，使用备用解析器")
                return fallback_parser(message)
            continue
        
        except Exception as e:
            logger.error(f"AI解析出错 (尝试 {retry_count + 1}/{max_retries}): {e}, 错误类型: {type(e).__name__}")
            retry_count += 1
            if retry_count >= max_retries:
                logger.error(f"API调用失败，已达到最大重试次数，使用备用解析器")
                return fallback_parser(message)
            # 等待一下再重试
            import time
            time.sleep(1)
            continue
    
    # 如果所有重试都失败，使用备用解析器
    logger.warning(f"所有重试都失败，使用备用解析器")
    return fallback_parser(message)

def fallback_parser(message: str) -> AIResponse:
    """简单的规则匹配作为备用方案"""
    logger.info(f"使用备用解析器处理: {message}")
    
    # 提取重量（数字+克）
    weight = None
    weight_match = re.search(r'(\d+(?:\.\d+)?)\s*克', message)
    if weight_match:
        weight = float(weight_match.group(1))
    
    # 提取工费（工费+数字+元）
    labor_cost = None
    labor_match = re.search(r'工费\s*(\d+(?:\.\d+)?)\s*元', message)
    if labor_match:
        labor_cost = float(labor_match.group(1))
    
    # 提取供应商（供应商是XXX 或 供应商：XXX）
    supplier = None
    supplier_match = re.search(r'供应商[是：:]\s*([^，,。.\n]+)', message)
    if supplier_match:
        supplier = supplier_match.group(1).strip()
    
    # 提取商品名称（通常在重量之前）
    product_name = None
    if weight_match:
        before_weight = message[:weight_match.start()].strip()
        # 移除常见的入库相关词汇
        product_name = before_weight.replace('帮我做个入库', '').replace('入库', '').strip()
        if not product_name or len(product_name) < 2:
            # 如果提取失败，尝试从整个消息中提取
            parts = message.split()
            for part in parts:
                if '克' not in part and '工费' not in part and '供应商' not in part and '入库' not in part:
                    product_name = part
                    break
    
    # 优先检测退货关键词（退、退货、退给、退回）
    if "退" in message or "退货" in message or "退给" in message or "退回" in message:
        return AIResponse(
            action="退货",
            product_name=product_name or "未知商品",
            weight=weight,
            labor_cost=labor_cost,
            supplier=supplier
        )
    elif "入库" in message or "入" in message:
        return AIResponse(
            action="入库",
            product_name=product_name or "未知商品",
            weight=weight,
            labor_cost=labor_cost,
            supplier=supplier
        )
    elif "查询" in message or "库存" in message:
        return AIResponse(action="查询库存", product_name=product_name)
    else:
        return AIResponse(action="未知")

