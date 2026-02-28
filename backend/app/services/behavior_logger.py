# backend/app/services/behavior_logger.py
"""
行为记录器服务 - 记录并学习用户决策模式

架构：
- 向量存储：PostgreSQL + pgvector（本地，无需外部服务）
- Embedding：阿里云百炼 text-embedding-v3（1024维，中文优化）
- LLM：DeepSeek（决策依据提取）
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from openai import OpenAI
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

# === 配置 ===
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
ALIYUN_EMBEDDING_API_KEY = os.getenv("ALIYUN_EMBEDDING_API_KEY")

# LLM 客户端（延迟初始化）
_llm_client = None


def get_llm_client():
    """获取 DeepSeek LLM 客户端"""
    global _llm_client
    if _llm_client is None:
        if not DEEPSEEK_API_KEY:
            logger.warning("[LLM] 未配置 DEEPSEEK_API_KEY")
            return None
        _llm_client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com", timeout=60.0)
    return _llm_client


# Embedding 客户端（延迟初始化）
_embedding_client = None


def get_embedding_client():
    """获取阿里云百炼 Embedding 客户端"""
    global _embedding_client
    if _embedding_client is None:
        if not ALIYUN_EMBEDDING_API_KEY:
            logger.warning("[Embedding] 未配置 ALIYUN_EMBEDDING_API_KEY")
            return None
        _embedding_client = OpenAI(
            api_key=ALIYUN_EMBEDDING_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            timeout=30.0
        )
    return _embedding_client


def generate_embedding(text: str) -> Optional[List[float]]:
    """调用阿里云百炼生成 1024 维向量"""
    client = get_embedding_client()
    if not client:
        return None
    try:
        response = client.embeddings.create(
            model="text-embedding-v3",
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"[Embedding] 生成失败: {e}")
        return None


class BehaviorLoggerService:
    """行为记录器 - pgvector 本地向量存储"""

    def __init__(self, db_session: Session):
        self.db = db_session

    # ================================================================
    #                    记录决策
    # ================================================================

    async def log_decision(
        self,
        action_type: str,
        session_id: str,
        user_id: str,
        user_role: str,
        operation_details: Dict[str, Any],
        customer_id: Optional[int] = None,
        customer_name: Optional[str] = None,
        gold_price: Optional[float] = None,
        market_trend: Optional[str] = None
    ) -> Dict[str, Any]:
        """记录一次决策行为到数据库（含向量）"""
        try:
            context = self._build_context(
                action_type=action_type,
                operation_details=operation_details,
                customer_name=customer_name,
                gold_price=gold_price,
                market_trend=market_trend
            )

            reasoning_result = await self._extract_decision_reasoning(context)

            embedding_text = self._generate_embedding_text(
                action_type=action_type,
                customer_name=customer_name,
                gold_price=gold_price,
                reasoning=reasoning_result.get("reasoning", ""),
                key_factors=reasoning_result.get("key_factors", []),
                operation_summary=json.dumps(operation_details, ensure_ascii=False)[:200]
            )

            embedding_vector = generate_embedding(embedding_text)

            from ..models.behavior_log import BehaviorDecisionLog

            log_entry = BehaviorDecisionLog(
                action_type=action_type,
                session_id=session_id,
                user_id=user_id,
                user_role=user_role,
                customer_id=customer_id,
                customer_name=customer_name,
                gold_price=gold_price,
                market_trend=market_trend,
                operation_details=operation_details,
                decision_reasoning=reasoning_result.get("reasoning"),
                key_factors=reasoning_result.get("key_factors"),
                confidence_score=reasoning_result.get("confidence", 0.8),
                embedding=embedding_vector,
                embedding_text=embedding_text
            )

            self.db.add(log_entry)
            self.db.commit()

            logger.info(
                f"[BehaviorLogger] 决策已记录: action={action_type}, "
                f"customer={customer_name}, has_vector={embedding_vector is not None}"
            )

            return {
                "success": True,
                "log_id": log_entry.id,
                "has_embedding": embedding_vector is not None,
                "reasoning": reasoning_result.get("reasoning")
            }

        except Exception as e:
            logger.error(f"[BehaviorLogger] 记录失败: {e}", exc_info=True)
            self.db.rollback()
            return {"success": False, "error": str(e)}

    # ================================================================
    #                    辅助方法
    # ================================================================

    def _build_context(self, action_type, operation_details, customer_name, gold_price, market_trend):
        action_names = {
            "settlement": "结算确认",
            "gold_receipt": "收料登记",
            "gold_payment": "付料登记",
            "withdrawal": "客户提料"
        }
        return f"""
操作类型：{action_names.get(action_type, action_type)}
客户：{customer_name or '未知'}
当前金价：{gold_price or '未知'} 元/克
市场趋势：{market_trend or '未知'}
操作时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}
操作详情：{json.dumps(operation_details, ensure_ascii=False, indent=2, default=str)}
"""

    async def _extract_decision_reasoning(self, context: str) -> Dict[str, Any]:
        """使用 DeepSeek 提取决策依据"""
        prompt = f"""你是珠宝行业决策分析专家。根据以下操作信息，分析决策的可能原因和关键因素。

{context}

请返回 JSON 格式：
{{"reasoning": "决策逻辑描述（50-100字）", "key_factors": ["因素1", "因素2", "因素3"], "confidence": 0.8}}

只返回 JSON，不要其他文字。"""

        try:
            client = get_llm_client()
            if not client:
                return {"reasoning": "LLM 未配置", "key_factors": [], "confidence": 0.0}

            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=500
            )
            result_text = response.choices[0].message.content.strip()

            if result_text.startswith("```"):
                parts = result_text.split("```")
                if len(parts) >= 2:
                    result_text = parts[1].lstrip("json").strip()

            return json.loads(result_text)
        except Exception as e:
            logger.error(f"[BehaviorLogger] LLM提取失败: {e}")
            return {"reasoning": "无法分析", "key_factors": [], "confidence": 0.0}

    def _generate_embedding_text(self, action_type, customer_name, gold_price, reasoning, key_factors, operation_summary=""):
        factors_text = "、".join(key_factors) if key_factors else "无"
        return f"""操作：{action_type}
客户：{customer_name or '通用'}
金价区间：{self._get_price_range(gold_price)}
决策逻辑：{reasoning}
关键因素：{factors_text}
摘要：{operation_summary}""".strip()

    @staticmethod
    def _get_price_range(price) -> str:
        try:
            price = float(price) if price else 0
        except (ValueError, TypeError):
            return "未知"

        if price <= 0:
            return "未知"
        elif price < 900:
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


# ================================================================
#      检索历史决策上下文（pgvector 余弦相似度）
# ================================================================

async def get_decision_context_for_suggestion(
    db: Session,
    action_type: str,
    customer_name: Optional[str] = None,
    customer_id: Optional[int] = None,
    gold_price: Optional[float] = None,
    additional_context: Optional[str] = None,
    top_k: int = 3,
    min_customer_records: int = 2
) -> str:
    """
    检索策略（两阶段）：
    1. 优先匹配同一客户的历史记录
    2. 客户记录不足时，放开限制搜索全库
    """
    try:
        service = BehaviorLoggerService(db)

        # 构建查询文本
        query_parts = [f"操作类型：{action_type}"]
        if customer_name:
            query_parts.append(f"客户：{customer_name}")
        if gold_price:
            query_parts.append(f"金价区间：{service._get_price_range(gold_price)}")
            query_parts.append(f"当前金价：{gold_price}元/克")
        if additional_context:
            query_parts.append(f"场景：{additional_context}")

        query_text = "\n".join(query_parts)

        # 生成查询向量
        query_vector = generate_embedding(query_text)
        if query_vector is None:
            logger.warning("[DecisionContext] 无法生成查询向量")
            return ""

        # 阶段一：优先匹配同一客户
        customer_results = []
        if customer_name:
            customer_results = _search_similar(
                db, query_vector, action_type,
                customer_name=customer_name, limit=top_k
            )
            logger.info(f"[DecisionContext] 客户专属记录: {len(customer_results)} 条")

        # 阶段二：全局回退
        global_results = []
        if len(customer_results) < min_customer_records:
            remaining = top_k - len(customer_results)
            exclude_ids = [r["id"] for r in customer_results]
            global_results = _search_similar(
                db, query_vector, action_type,
                limit=remaining + 5, exclude_ids=exclude_ids
            )
            global_results = global_results[:remaining]
            logger.info(f"[DecisionContext] 全局补充记录: {len(global_results)} 条")

        # 合并并格式化
        all_results = []
        for r in customer_results:
            r["source"] = "customer"
            all_results.append(r)
        for r in global_results:
            r["source"] = "global"
            all_results.append(r)

        if not all_results:
            return ""

        return _format_context(all_results, customer_name, gold_price)

    except Exception as e:
        logger.error(f"[DecisionContext] 检索失败: {e}", exc_info=True)
        return ""


def _search_similar(
    db: Session,
    query_vector: List[float],
    action_type: str,
    customer_name: Optional[str] = None,
    limit: int = 5,
    exclude_ids: Optional[List[int]] = None
) -> List[Dict]:
    """使用 pgvector 余弦相似度检索"""
    from ..models.behavior_log import BehaviorDecisionLog

    vector_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    conditions = ["action_type = :action_type", "embedding IS NOT NULL"]
    params: Dict[str, Any] = {"action_type": action_type, "limit": limit, "query_vec": vector_str}

    if customer_name:
        conditions.append("customer_name = :customer_name")
        params["customer_name"] = customer_name

    if exclude_ids:
        conditions.append("id != ALL(:exclude_ids)")
        params["exclude_ids"] = exclude_ids

    where_clause = " AND ".join(conditions)

    # Use CAST() instead of :: to avoid conflict with SQLAlchemy's :param syntax
    sql = text(f"""
        SELECT id, action_type, customer_name, customer_id, gold_price,
               market_trend, decision_reasoning, key_factors,
               created_at,
               1 - (embedding <=> CAST(:query_vec AS vector)) AS similarity
        FROM behavior_decision_logs
        WHERE {where_clause}
        ORDER BY embedding <=> CAST(:query_vec AS vector)
        LIMIT :limit
    """)

    rows = db.execute(sql, params).fetchall()

    results = []
    for row in rows:
        results.append({
            "id": row[0],
            "action_type": row[1],
            "customer_name": row[2],
            "customer_id": row[3],
            "gold_price": row[4],
            "market_trend": row[5],
            "reasoning": row[6],
            "key_factors": row[7],
            "created_at": row[8],
            "similarity": float(row[9]) if row[9] else 0.0
        })

    return results


def _format_context(
    results: List[Dict],
    customer_name: Optional[str],
    gold_price: Optional[float]
) -> str:
    """格式化历史决策参考文本"""
    lines = [
        "=" * 60,
        "  历史决策经验参考",
        "=" * 60,
    ]

    customer_count = sum(1 for r in results if r["source"] == "customer")
    global_count = sum(1 for r in results if r["source"] == "global")

    if customer_count > 0 and global_count > 0:
        lines.append(f"  检索策略: {customer_count}条客户专属 + {global_count}条相似场景")
    elif customer_count > 0:
        lines.append(f"  检索策略: {customer_count}条客户「{customer_name}」专属历史记录")
    else:
        lines.append(f"  检索策略: {global_count}条全局相似经营场景")

    lines.append("-" * 60)

    for i, result in enumerate(results, 1):
        similarity = result.get("similarity", 0)

        if similarity >= 0.9:
            match_level = "极高"
        elif similarity >= 0.8:
            match_level = "较高"
        elif similarity >= 0.7:
            match_level = "中等"
        else:
            match_level = "参考"

        # 金价相似度加成
        price_boost = 0
        if gold_price and result.get("gold_price"):
            try:
                price_diff = abs(gold_price - float(result["gold_price"]))
                if price_diff < 10:
                    price_boost = 0.05
                elif price_diff < 30:
                    price_boost = 0.03
                elif price_diff < 50:
                    price_boost = 0.01
            except (ValueError, TypeError):
                pass

        display_score = similarity + price_boost
        source_label = "客户专属" if result["source"] == "customer" else "全局相似"

        time_str = "未知"
        if result.get("created_at"):
            try:
                time_str = result["created_at"].strftime("%Y-%m-%d")
            except (AttributeError, ValueError):
                pass

        lines.append(f"\n【案例 {i}】匹配度: {display_score:.0%} ({match_level}) | 来源: {source_label}")
        lines.append(f"  向量相似度: {similarity:.4f}")

        if result.get("customer_name"):
            lines.append(f"  客户：{result['customer_name']}")

        lines.append(f"  时间：{time_str}")

        if result.get("gold_price"):
            lines.append(f"  当时金价：{result['gold_price']} 元/克")

        if result.get("market_trend"):
            trend_map = {"up": "上涨", "down": "下跌", "stable": "平稳"}
            lines.append(f"  市场趋势：{trend_map.get(result['market_trend'], result['market_trend'])}")

        if result.get("reasoning"):
            lines.append(f"  决策逻辑：{result['reasoning']}")

        if result.get("key_factors"):
            factors = result["key_factors"]
            if isinstance(factors, list) and factors:
                lines.append(f"  关键因素：{'、'.join(factors)}")

    lines.append("\n" + "=" * 60)
    lines.append("  提示：匹配度>=80%的案例参考价值较高")
    lines.append("  请结合当前市场环境和客户特点综合判断")
    lines.append("=" * 60)

    return "\n".join(lines)


# ================================================================
#      Fire-and-forget 辅助函数（业务代码调用入口）
# ================================================================

import asyncio
import threading


def log_decision_background(
    action_type: str,
    user_role: str = "system",
    customer_id: Optional[int] = None,
    customer_name: Optional[str] = None,
    gold_price: Optional[float] = None,
    market_trend: Optional[str] = None,
    operation_details: Optional[Dict[str, Any]] = None,
    session_id: str = "auto",
    user_id: str = "system"
):
    """
    后台异步记录决策，不阻塞业务流程。
    在独立线程中运行，使用独立的 DB session。
    """
    def _run():
        from ..database import SessionLocal
        db = SessionLocal()
        try:
            service = BehaviorLoggerService(db)
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(service.log_decision(
                action_type=action_type,
                session_id=session_id,
                user_id=user_id,
                user_role=user_role,
                customer_id=customer_id,
                customer_name=customer_name,
                gold_price=gold_price,
                market_trend=market_trend,
                operation_details=operation_details or {}
            ))
            loop.close()
        except Exception as e:
            logger.error(f"[BehaviorLogger] 后台记录失败: {e}")
        finally:
            db.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()


async def get_customer_profile(
    db: Session,
    customer_id: int,
    customer_name: str,
    top_k: int = 5
) -> str:
    """
    生成客户画像：检索该客户的所有历史决策，用 LLM 总结为画像文本。
    返回空字符串表示数据不足。
    """
    try:
        sql = text("""
            SELECT action_type, gold_price, market_trend,
                   decision_reasoning, key_factors, created_at
            FROM behavior_decision_logs
            WHERE customer_id = :cid AND embedding IS NOT NULL
            ORDER BY created_at DESC
            LIMIT :limit
        """)
        rows = db.execute(sql, {"cid": customer_id, "limit": top_k}).fetchall()

        if len(rows) < 2:
            return ""

        records_text = []
        for row in rows:
            dt_str = row[5].strftime("%Y-%m-%d") if row[5] else "未知"
            factors = row[4] if isinstance(row[4], list) else []
            records_text.append(
                f"- {dt_str} | {row[0]} | 金价{row[1] or '?'}元 | "
                f"趋势{row[2] or '?'} | {row[3] or '无'} | "
                f"因素：{'、'.join(factors) if factors else '无'}"
            )

        prompt = f"""你是珠宝行业客户分析专家。根据以下客户「{customer_name}」的历史操作记录，
总结一段简洁的客户画像（80-150字），包括：偏好的结算方式、对金价的敏感度、交易频率特征。

历史记录：
{chr(10).join(records_text)}

只返回画像文本，不要标题或格式。"""

        client = get_llm_client()
        if not client:
            return ""

        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=300
        )
        profile = response.choices[0].message.content.strip()
        logger.info(f"[CustomerProfile] 已生成客户画像: {customer_name}, 长度={len(profile)}")
        return profile

    except Exception as e:
        logger.error(f"[CustomerProfile] 生成失败: {e}")
        return ""
