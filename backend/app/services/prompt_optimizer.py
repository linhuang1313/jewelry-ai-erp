# -*- coding: utf-8 -*-
"""
AI 提示词优化服务
使用 DeepSeek API 对用户的图像生成提示词进行智能优化
"""
import json
import logging
import os
from typing import List, Optional

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPSEEK_API_KEY 未设置")
        _client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com", timeout=60.0)
    return _client


OPTIMIZER_SYSTEM_PROMPT = """\
你是一位专业的AI图像生成提示词专家，擅长珠宝产品设计领域。
你的任务是优化 Stable Diffusion / ComfyUI 的提示词，生成高质量珠宝产品图像。

优化原则:
1. 补充缺失细节：材质质感、光照方向、拍摄视角、背景环境
2. 添加质量词：masterpiece, best quality, 8k, photorealistic, studio lighting
3. 调整关键词权重：使用 (keyword:weight) 语法突出重点
4. 根据珠宝类型添加专业描述词（金属光泽、宝石折射、抛光质感等）
5. 保持用户原始创意意图
6. 输出英文提示词（ComfyUI 生态标准）

请以 JSON 格式回复:
{
  "optimized_prompt": "完整的优化后正向提示词（英文）",
  "negative_prompt": "建议的反向提示词（英文）",
  "explanation": "中文说明做了哪些优化",
  "style_tags": ["适用的风格标签"],
  "suggested_params": {
    "steps": 30,
    "cfg": 7.5,
    "width": 1024,
    "height": 1024,
    "sampler_name": "euler_ancestral"
  }
}"""


async def optimize_prompt(
    user_prompt: str,
    product_type: str = "",
    material: str = "",
    style: str = "",
    conversation_history: Optional[List[dict]] = None,
) -> dict:
    """优化用户输入的提示词

    Returns:
        {"success": True, "data": {...}} 或 {"success": False, "error": "..."}
    """
    context_parts = []
    if product_type:
        context_parts.append(f"产品类型: {product_type}")
    if material:
        context_parts.append(f"材质: {material}")
    if style:
        context_parts.append(f"风格: {style}")
    context = "\n".join(context_parts) if context_parts else "未指定"

    messages = [{"role": "system", "content": OPTIMIZER_SYSTEM_PROMPT}]
    if conversation_history:
        messages.extend(conversation_history[-6:])

    messages.append({
        "role": "user",
        "content": f"产品配置:\n{context}\n\n用户提示词:\n{user_prompt}\n\n请优化这个提示词。",
    })

    try:
        response = _get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=1500,
            temperature=0.7,
            response_format={"type": "json_object"},
            messages=messages,
        )
        result = json.loads(response.choices[0].message.content.strip())
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"提示词优化失败: {e}")
        return {"success": False, "error": str(e)}


async def translate_prompt(text: str, target_lang: str = "en") -> dict:
    """将提示词翻译为目标语言"""
    try:
        response = _get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=500,
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"Translate the following image generation prompt to {target_lang}. "
                        "Keep technical terms and style keywords intact. "
                        "Output only the translated text."
                    ),
                },
                {"role": "user", "content": text},
            ],
        )
        translated = response.choices[0].message.content.strip()
        return {"success": True, "translated": translated}
    except Exception as e:
        logger.error(f"提示词翻译失败: {e}")
        return {"success": False, "error": str(e)}
