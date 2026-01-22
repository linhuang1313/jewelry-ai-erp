# backend/app/services/behavior_logger.py
"""
行为记录器服务 - 记录并学习用户决策模式

功能：
1. 记录用户操作决策到数据库和向量库
2. 使用LLM提取决策依据
3. 检索相似历史决策用于增强AI建议
"""

import os
import json
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from openai import OpenAI
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# === 配置 ===
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # 用于 Embedding
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "jewelry-erp-decisions")

# LLM 客户端（延迟初始化）
_llm_client = None

def get_llm_client():
    """获取 DeepSeek LLM 客户端（延迟初始化）"""
    global _llm_client
    if _llm_client is None:
        if not DEEPSEEK_API_KEY:
            logger.warning("[LLM] 未配置 DEEPSEEK_API_KEY，LLM 功能不可用")
            return None
        _llm_client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
    return _llm_client

# Embedding 客户端（延迟初始化）
_embedding_client = None

def get_embedding_client():
    """获取 OpenAI Embedding 客户端（延迟初始化）"""
    global _embedding_client
    if _embedding_client is None and OPENAI_API_KEY:
        _embedding_client = OpenAI(api_key=OPENAI_API_KEY)
    return _embedding_client

# Pinecone 客户端（延迟初始化）
_pinecone_index = None


def get_pinecone_index():
    """获取 Pinecone 索引（单例模式）"""
    global _pinecone_index
    if _pinecone_index is None:
        if not PINECONE_API_KEY:
            logger.warning("[Pinecone] 未配置 PINECONE_API_KEY，向量功能不可用")
            return None
        try:
            from pinecone import Pinecone
            pc = Pinecone(api_key=PINECONE_API_KEY)
            _pinecone_index = pc.Index(PINECONE_INDEX_NAME)
            logger.info(f"[Pinecone] 已连接索引: {PINECONE_INDEX_NAME}")
        except Exception as e:
            logger.error(f"[Pinecone] 连接失败: {e}")
            return None
    return _pinecone_index


class BehaviorLoggerService:
    """行为记录器服务 - 记录并学习用户决策模式"""
    
    NAMESPACE = "jewelry_decisions"
    
    def __init__(self, db_session: Session):
        self.db = db_session
        self.index = get_pinecone_index()
    
    # ================================================================
    #                    存储到 Pinecone（完整实现）
    # ================================================================
    
    async def _store_to_pinecone(
        self,
        embedding_text: str,
        metadata: Dict[str, Any]
    ) -> str:
        """
        将决策向量存储到 Pinecone
        
        参数:
            embedding_text: 用于生成向量的文本描述
            metadata: 关联的结构化元数据
        
        返回:
            pinecone_id: 向量的唯一标识符
        """
        if not self.index:
            logger.warning("[Pinecone] 索引未初始化，跳过向量存储")
            return f"skipped_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        if not embedding_client:
            logger.warning("[Pinecone] Embedding 客户端未初始化，跳过向量存储")
            return f"no_embedding_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        try:
            # ========== Step 1: 生成 Embedding 向量 ==========
            logger.info(f"[Pinecone] 开始生成 embedding，文本长度: {len(embedding_text)}")
            
            client = get_embedding_client()
            if not client:
                logger.warning("[Pinecone] Embedding 客户端未初始化，跳过向量存储")
                return None
            
            embedding_response = client.embeddings.create(
                model="text-embedding-3-small",  # 1536维，性价比高
                input=embedding_text,
                encoding_format="float"
            )
            embedding_vector = embedding_response.data[0].embedding
            
            logger.info(f"[Pinecone] Embedding 生成成功，维度: {len(embedding_vector)}")
            
            # ========== Step 2: 生成唯一 ID ==========
            timestamp_str = datetime.now().strftime('%Y%m%d%H%M%S%f')
            content_hash = hashlib.md5(embedding_text.encode('utf-8')).hexdigest()[:8]
            pinecone_id = f"decision_{timestamp_str}_{content_hash}"
            
            # ========== Step 3: 清理和验证 Metadata ==========
            clean_metadata = self._sanitize_metadata(metadata)
            
            # ========== Step 4: Upsert 到 Pinecone ==========
            upsert_response = self.index.upsert(
                vectors=[
                    {
                        "id": pinecone_id,
                        "values": embedding_vector,
                        "metadata": clean_metadata
                    }
                ],
                namespace=self.NAMESPACE
            )
            
            upserted_count = upsert_response.get("upserted_count", 0)
            logger.info(f"[Pinecone] 存储成功: id={pinecone_id}, upserted={upserted_count}")
            
            return pinecone_id
            
        except Exception as e:
            logger.error(f"[Pinecone] 存储失败: {e}", exc_info=True)
            return f"store_failed_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    def _sanitize_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """清理 metadata，确保符合 Pinecone 要求"""
        
        def safe_str(val, max_len=500):
            if val is None:
                return ""
            return str(val)[:max_len]
        
        def safe_float(val):
            try:
                return float(val) if val is not None else 0.0
            except:
                return 0.0
        
        def safe_int(val):
            try:
                return int(val) if val is not None else 0
            except:
                return 0
        
        def safe_list(val, max_items=5):
            if not val:
                return []
            if isinstance(val, list):
                return [str(item)[:100] for item in val[:max_items]]
            return []
        
        return {
            # 操作类型
            "action_type": safe_str(metadata.get("action_type")),
            
            # 客户信息
            "customer_id": safe_int(metadata.get("customer_id")),
            "customer_name": safe_str(metadata.get("customer_name"), 100),
            
            # 市场环境
            "gold_price": safe_float(metadata.get("gold_price")),
            "gold_price_range": self._get_price_range(metadata.get("gold_price")),
            "market_trend": safe_str(metadata.get("market_trend"), 20),
            
            # 时间信息
            "timestamp": safe_str(metadata.get("timestamp")),
            "date": datetime.now().strftime("%Y-%m-%d"),
            
            # 决策内容
            "reasoning": safe_str(metadata.get("reasoning"), 500),
            "key_factors": safe_list(metadata.get("key_factors")),
            
            # 操作者
            "user_role": safe_str(metadata.get("user_role"), 20),
            "user_id": safe_str(metadata.get("user_id"), 50),
            
            # 操作详情摘要
            "operation_summary": safe_str(metadata.get("operation_summary"), 200),
        }
    
    def _get_price_range(self, price) -> str:
        """将金价转换为区间标签（2025-2026年标准）"""
        try:
            price = float(price) if price else 0
        except:
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
    #                完整的日志记录方法
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
        """
        记录一次决策行为到数据库和向量库
        
        参数:
            action_type: 操作类型 (settlement/gold_receipt/gold_payment/withdrawal)
            session_id: 会话ID
            user_id: 用户ID
            user_role: 用户角色
            operation_details: 操作详情 (金额、克重、支付方式等)
            customer_id: 客户ID
            customer_name: 客户名称
            gold_price: 当前金价
            market_trend: 市场趋势
        """
        try:
            # Step 1: 构建上下文
            context = self._build_context(
                action_type=action_type,
                operation_details=operation_details,
                customer_name=customer_name,
                gold_price=gold_price,
                market_trend=market_trend
            )
            
            # Step 2: LLM 提取决策依据
            reasoning_result = await self._extract_decision_reasoning(context)
            
            # Step 3: 生成 Embedding 文本
            embedding_text = self._generate_embedding_text(
                action_type=action_type,
                customer_name=customer_name,
                gold_price=gold_price,
                reasoning=reasoning_result.get("reasoning", ""),
                key_factors=reasoning_result.get("key_factors", []),
                operation_summary=json.dumps(operation_details, ensure_ascii=False)[:200]
            )
            
            # Step 4: 存储到 Pinecone
            pinecone_id = await self._store_to_pinecone(
                embedding_text=embedding_text,
                metadata={
                    "action_type": action_type,
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "gold_price": gold_price,
                    "market_trend": market_trend,
                    "timestamp": datetime.now().isoformat(),
                    "reasoning": reasoning_result.get("reasoning", ""),
                    "key_factors": reasoning_result.get("key_factors", []),
                    "user_role": user_role,
                    "user_id": user_id,
                    "operation_summary": json.dumps(operation_details, ensure_ascii=False)[:200]
                }
            )
            
            # Step 5: 存储到关系数据库
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
                pinecone_id=pinecone_id,
                embedding_text=embedding_text
            )
            
            self.db.add(log_entry)
            self.db.commit()
            
            logger.info(f"[BehaviorLogger] 决策已记录: action={action_type}, customer={customer_name}")
            
            return {
                "success": True,
                "log_id": log_entry.id,
                "pinecone_id": pinecone_id,
                "reasoning": reasoning_result.get("reasoning")
            }
            
        except Exception as e:
            logger.error(f"[BehaviorLogger] 记录失败: {e}", exc_info=True)
            self.db.rollback()
            return {"success": False, "error": str(e)}
    
    def _build_context(self, action_type, operation_details, customer_name, gold_price, market_trend):
        """构建操作上下文描述"""
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
操作详情：{json.dumps(operation_details, ensure_ascii=False, indent=2)}
"""
    
    async def _extract_decision_reasoning(self, context: str) -> Dict[str, Any]:
        """使用 LLM 提取决策依据"""
        prompt = f"""你是珠宝行业决策分析专家。根据以下操作信息，分析决策的可能原因和关键因素。

{context}

请返回 JSON 格式：
{{"reasoning": "决策逻辑描述（50-100字）", "key_factors": ["因素1", "因素2", "因素3"], "confidence": 0.8}}

只返回 JSON，不要其他文字。"""
        
        try:
            client = get_llm_client()
            if not client:
                logger.warning("[LLM] 客户端未初始化，跳过决策依据提取")
                return {"reasoning": "LLM 未配置", "key_factors": [], "confidence": 0.0}
            
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=500
            )
            result_text = response.choices[0].message.content.strip()
            
            # 清理 JSON
            if result_text.startswith("```"):
                parts = result_text.split("```")
                if len(parts) >= 2:
                    result_text = parts[1].lstrip("json").strip()
            
            return json.loads(result_text)
        except Exception as e:
            logger.error(f"[BehaviorLogger] LLM提取失败: {e}")
            return {"reasoning": "无法分析", "key_factors": [], "confidence": 0.0}
    
    def _generate_embedding_text(self, action_type, customer_name, gold_price, reasoning, key_factors, operation_summary=""):
        """生成用于向量化的文本"""
        factors_text = "、".join(key_factors) if key_factors else "无"
        return f"""
操作：{action_type}
客户：{customer_name or '通用'}
金价区间：{self._get_price_range(gold_price)}
决策逻辑：{reasoning}
关键因素：{factors_text}
摘要：{operation_summary}
""".strip()


# ================================================================
#      检索历史决策上下文（完整实现 - 客户优先 + 全局回退）
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
    获取历史决策上下文，用于增强建议 Agent
    
    检索策略（两阶段）：
    1. 优先匹配同一客户的历史记录
    2. 如果客户记录少于 min_customer_records 条，放开限制搜索全库
    
    参数:
        db: 数据库会话
        action_type: 操作类型
        customer_name: 客户名称
        customer_id: 客户ID
        gold_price: 当前金价
        additional_context: 额外上下文
        top_k: 返回条数
        min_customer_records: 客户记录最少条数阈值
    
    返回:
        格式化的历史决策参考文本（包含匹配度分数）
    """
    
    index = get_pinecone_index()
    if not index:
        logger.warning("[DecisionContext] Pinecone 索引未初始化")
        return ""
    
    if not embedding_client:
        logger.warning("[DecisionContext] Embedding 客户端未初始化")
        return ""
    
    try:
        service = BehaviorLoggerService(db)
        
        # ========== Step 1: 构建查询向量 ==========
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
        client = get_embedding_client()
        if not client:
            logger.warning("[Pinecone] Embedding 客户端未初始化，无法查询相似决策")
            return []
        
        query_response = client.embeddings.create(
            model="text-embedding-3-small",
            input=query_text,
            encoding_format="float"
        )
        query_vector = query_response.data[0].embedding
        
        # ========== Step 2: 阶段一 - 优先匹配同一客户 ==========
        customer_matches = []
        
        if customer_name:
            logger.info(f"[DecisionContext] 阶段1: 优先搜索客户 '{customer_name}' 的历史记录")
            
            customer_filter = {
                "$and": [
                    {"action_type": {"$eq": action_type}},
                    {"customer_name": {"$eq": customer_name}}
                ]
            }
            
            customer_results = index.query(
                vector=query_vector,
                top_k=top_k,
                include_metadata=True,
                namespace=BehaviorLoggerService.NAMESPACE,
                filter=customer_filter
            )
            
            customer_matches = customer_results.get("matches", [])
            logger.info(f"[DecisionContext] 客户专属记录: {len(customer_matches)} 条")
        
        # ========== Step 3: 阶段二 - 全局回退（如果客户记录不足）==========
        global_matches = []
        need_global_search = len(customer_matches) < min_customer_records
        
        if need_global_search:
            remaining_needed = top_k - len(customer_matches)
            
            logger.info(f"[DecisionContext] 阶段2: 客户记录不足({len(customer_matches)}<{min_customer_records})，扩展搜索全局相似场景")
            
            global_filter = {"action_type": {"$eq": action_type}}
            
            global_results = index.query(
                vector=query_vector,
                top_k=remaining_needed + 5,
                include_metadata=True,
                namespace=BehaviorLoggerService.NAMESPACE,
                filter=global_filter
            )
            
            # 去重：排除已经在客户匹配中的记录
            customer_ids = {m.get("id") for m in customer_matches}
            for match in global_results.get("matches", []):
                if match.get("id") not in customer_ids:
                    global_matches.append(match)
                    if len(global_matches) >= remaining_needed:
                        break
            
            logger.info(f"[DecisionContext] 全局补充记录: {len(global_matches)} 条")
        
        # ========== Step 4: 合并结果并智能排序 ==========
        all_matches = []
        
        for match in customer_matches:
            match["_source"] = "customer"
            match["_priority_boost"] = 0.1
            all_matches.append(match)
        
        for match in global_matches:
            match["_source"] = "global"
            match["_priority_boost"] = 0.0
            all_matches.append(match)
        
        # 计算综合得分
        scored_results = []
        for match in all_matches:
            meta = match.get("metadata", {})
            base_score = match.get("score", 0)
            priority_boost = match.get("_priority_boost", 0)
            source = match.get("_source", "unknown")
            
            # 金价相似度加成
            price_boost = 0
            if gold_price and meta.get("gold_price"):
                try:
                    price_diff = abs(gold_price - float(meta.get("gold_price", 0)))
                    if price_diff < 10:
                        price_boost = 0.05
                    elif price_diff < 30:
                        price_boost = 0.03
                    elif price_diff < 50:
                        price_boost = 0.01
                except:
                    pass
            
            final_score = base_score + priority_boost + price_boost
            
            scored_results.append({
                "id": match.get("id"),
                "score": final_score,
                "original_score": base_score,
                "source": source,
                "metadata": meta
            })
        
        scored_results.sort(key=lambda x: x["score"], reverse=True)
        top_results = scored_results[:top_k]
        
        if not top_results:
            logger.info(f"[DecisionContext] 未找到相关历史决策")
            return ""
        
        # ========== Step 5: 格式化输出（包含匹配度分数）==========
        lines = [
            "=" * 60,
            "  历史决策经验参考",
            "=" * 60,
        ]
        
        customer_count = sum(1 for r in top_results if r["source"] == "customer")
        global_count = sum(1 for r in top_results if r["source"] == "global")
        
        if customer_count > 0 and global_count > 0:
            lines.append(f"  检索策略: {customer_count}条客户专属 + {global_count}条相似场景")
        elif customer_count > 0:
            lines.append(f"  检索策略: {customer_count}条客户「{customer_name}」专属历史记录")
        else:
            lines.append(f"  检索策略: {global_count}条全局相似经营场景")
        
        lines.append("-" * 60)
        
        for i, result in enumerate(top_results, 1):
            meta = result["metadata"]
            score = result["score"]
            original_score = result["original_score"]
            source = result["source"]
            
            # 匹配度等级
            if score >= 0.9:
                match_level = "极高"
            elif score >= 0.8:
                match_level = "较高"
            elif score >= 0.7:
                match_level = "中等"
            else:
                match_level = "参考"
            
            source_label = "客户专属" if source == "customer" else "全局相似"
            
            # 时间解析
            timestamp = meta.get("timestamp", "")
            try:
                dt = datetime.fromisoformat(timestamp)
                time_str = dt.strftime("%Y-%m-%d")
            except:
                time_str = meta.get("date", "未知")
            
            lines.append(f"\n【案例 {i}】匹配度: {score:.0%} ({match_level}) | 来源: {source_label}")
            lines.append(f"  向量相似度: {original_score:.4f}")
            
            if meta.get("customer_name"):
                lines.append(f"  客户：{meta['customer_name']}")
            
            lines.append(f"  时间：{time_str}")
            
            if meta.get("gold_price"):
                lines.append(f"  当时金价：{meta['gold_price']} 元/克")
            
            if meta.get("market_trend"):
                trend_map = {"up": "上涨", "down": "下跌", "stable": "平稳"}
                lines.append(f"  市场趋势：{trend_map.get(meta['market_trend'], meta['market_trend'])}")
            
            if meta.get("reasoning"):
                lines.append(f"  决策逻辑：{meta['reasoning']}")
            
            if meta.get("key_factors"):
                factors = meta["key_factors"]
                if isinstance(factors, list) and factors:
                    lines.append(f"  关键因素：{'、'.join(factors)}")
        
        lines.append("\n" + "=" * 60)
        lines.append("  提示：匹配度>=80%的案例参考价值较高")
        lines.append("  请结合当前市场环境和客户特点综合判断")
        lines.append("=" * 60)
        
        formatted_output = "\n".join(lines)
        
        logger.info(f"[DecisionContext] 已生成上下文: {len(top_results)}条, 客户={customer_count}, 全局={global_count}")
        
        return formatted_output
        
    except Exception as e:
        logger.error(f"[DecisionContext] 检索失败: {e}", exc_info=True)
        return ""

