# backend/app/models/behavior_log.py
"""
行为决策日志模型 - 记录用户决策行为用于AI学习和建议增强
"""

from sqlalchemy import Column, Integer, String, Float, Text, DateTime, JSON
from sqlalchemy.sql import func
from ..database import Base


class BehaviorDecisionLog(Base):
    """
    行为决策日志表 - 记录每次操作的决策依据
    
    用途：
    1. 记录用户的决策行为和上下文
    2. 通过LLM提取决策逻辑
    3. 存储到向量数据库用于相似性检索
    4. 为AI建议提供历史经验参考
    """
    __tablename__ = "behavior_decision_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # === 操作基础信息 ===
    action_type = Column(String(50), index=True, nullable=False)  # 操作类型: settlement/gold_receipt/gold_payment/withdrawal
    session_id = Column(String(50), index=True)   # 关联会话ID
    user_id = Column(String(100), index=True)     # 操作者ID
    user_role = Column(String(20), index=True)    # 操作者角色
    
    # === 客户信息 ===
    customer_id = Column(Integer, index=True, nullable=True)  # 客户ID
    customer_name = Column(String(100), nullable=True)        # 客户名称
    
    # === 市场/环境上下文 ===
    gold_price = Column(Float, nullable=True)           # 当时金价 (元/克)
    market_trend = Column(String(20), nullable=True)    # 市场趋势: up/down/stable
    
    # === 操作详情 ===
    operation_details = Column(JSON, nullable=True)  # 操作具体数据，如金额、克重、支付方式等
    
    # === LLM提取的决策依据 ===
    decision_reasoning = Column(Text, nullable=True)     # LLM提取的决策逻辑描述
    key_factors = Column(JSON, nullable=True)            # 关键决策因素列表
    confidence_score = Column(Float, nullable=True)      # 决策置信度 0-1
    
    # === 向量索引 ===
    pinecone_id = Column(String(100), nullable=True, index=True)  # Pinecone中的向量ID
    embedding_text = Column(Text, nullable=True)                   # 用于生成embedding的文本
    
    # === 时间戳 ===
    created_at = Column(DateTime, server_default=func.now(), index=True)  # 创建时间
    
    def __repr__(self):
        return f"<BehaviorDecisionLog(id={self.id}, action={self.action_type}, customer={self.customer_name})>"

