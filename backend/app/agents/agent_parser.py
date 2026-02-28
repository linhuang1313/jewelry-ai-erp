"""Agent 感知的消息解析器

替代 ai_parser.parse_user_message()，使用 Agent 的专属 Prompt 进行解析。
当角色有注册的 Agent 时使用此解析器，否则 fallback 到旧的 parse_user_message()。
"""

import json
import logging
from typing import Dict, List, Optional

from ..schemas import AIResponse
from ..ai_prompts import build_context
from ..ai_parser import get_client, fallback_parser
from .base import BaseAgent

logger = logging.getLogger(__name__)


def parse_with_agent(
    agent: BaseAgent,
    message: str,
    conversation_history: Optional[List[dict]] = None,
    session_entities: Optional[Dict] = None,
) -> AIResponse:
    """使用指定 Agent 的专属 Prompt 解析用户消息。

    流程：
      1. Agent.classify() → category
      2. build_context() → context（复用旧架构的上下文构建）
      3. Agent.get_prompt(category, message, context) → prompt
      4. DeepSeek API → JSON → AIResponse

    与旧 parse_user_message() 的区别：
      - classify 使用 Agent 专属分类器（更窄的分类范围，更精准）
      - prompt 使用 Agent 专属模板（更少的 action/示例，更少的 token）
    """
    # Step 1: Agent 专属分类
    category = agent.classify(message, conversation_history)
    logger.info(f"[AgentParser] Agent={agent.role_id}, category={category}, msg={message[:50]}")

    # Step 2: 构建上下文（复用旧架构）
    context = build_context(conversation_history, session_entities=session_entities)

    # Step 3: Agent 专属 Prompt
    prompt = agent.get_prompt(category, message, context)

    # Step 4: 调用 DeepSeek API
    max_retries = 3
    retry_count = 0
    content = ""

    while retry_count < max_retries:
        try:
            logger.info(f"[AgentParser] 调用 DeepSeek API (尝试 {retry_count + 1}/{max_retries})")
            response = get_client().chat.completions.create(
                model="deepseek-chat",
                max_tokens=800,
                temperature=0.1,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "system",
                        "content": agent.system_prompt + " 请始终以JSON格式输出。",
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
            )

            content = response.choices[0].message.content.strip()
            logger.info(f"[AgentParser] API 响应: {content[:200]}")

            # 提取 JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            start_idx = content.find("{")
            end_idx = content.rfind("}")
            if start_idx != -1 and end_idx != -1:
                content = content[start_idx : end_idx + 1]

            data = json.loads(content)

            # 数值类型修正（复用旧逻辑）
            _fix_numeric_fields(data)

            logger.info(f"[AgentParser] 解析成功: action={data.get('action')}")
            return AIResponse(**data)

        except json.JSONDecodeError as e:
            logger.error(f"[AgentParser] JSON 解析错误 (尝试 {retry_count + 1}): {e}")
            retry_count += 1
            if retry_count >= max_retries:
                return fallback_parser(message)
            continue

        except Exception as e:
            logger.error(f"[AgentParser] API 调用失败 (尝试 {retry_count + 1}): {e}")
            retry_count += 1
            if retry_count >= max_retries:
                return fallback_parser(message)
            import time
            time.sleep(1)
            continue

    return fallback_parser(message)


def _fix_numeric_fields(data: dict) -> None:
    """修正 AI 返回的数值字段类型"""
    if isinstance(data.get("products"), list):
        for product in data["products"]:
            for field in ("weight", "labor_cost", "piece_labor_cost"):
                if field in product and product[field] is not None:
                    try:
                        product[field] = float(product[field])
                    except (ValueError, TypeError):
                        product[field] = None

    for field in ("weight", "labor_cost"):
        if field in data and data[field] is not None:
            try:
                data[field] = float(data[field])
            except (ValueError, TypeError):
                data[field] = None

    if "products" not in data or not data["products"]:
        if "product_name" in data and data.get("product_name"):
            data["products"] = [
                {
                    "product_name": data.get("product_name"),
                    "weight": data.get("weight"),
                    "labor_cost": data.get("labor_cost"),
                    "supplier": data.get("supplier"),
                }
            ]
