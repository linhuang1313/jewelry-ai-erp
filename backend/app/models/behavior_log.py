# backend/app/models/behavior_log.py
"""
行为决策日志模型 - 记录用户决策行为用于AI学习和建议增强
使用 pgvector 存储向量，替代外部向量数据库
"""

from sqlalchemy import Column, Integer, String, Float, Numeric, Text, DateTime, JSON, Index
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
from ..database import Base

EMBEDDING_DIM = 1024  # 阿里云 text-embedding-v3 维度


class BehaviorDecisionLog(Base):
    """
    行为决策日志表 - 记录每次操作的决策依据
    向量列直接存储在 PostgreSQL 中（pgvector 扩展）
    """
    __tablename__ = "behavior_decision_logs"

    id = Column(Integer, primary_key=True, index=True)

    # === 操作基础信息 ===
    action_type = Column(String(50), index=True, nullable=False)
    session_id = Column(String(50), index=True)
    user_id = Column(String(100), index=True)
    user_role = Column(String(20), index=True)

    # === 客户信息 ===
    customer_id = Column(Integer, index=True, nullable=True)
    customer_name = Column(String(100), nullable=True)

    # === 市场/环境上下文 ===
    gold_price = Column(Numeric(14, 2), nullable=True)
    market_trend = Column(String(20), nullable=True)

    # === 操作详情 ===
    operation_details = Column(JSON, nullable=True)

    # === LLM提取的决策依据 ===
    decision_reasoning = Column(Text, nullable=True)
    key_factors = Column(JSON, nullable=True)
    confidence_score = Column(Numeric(5, 4), nullable=True)

    # === 向量索引（pgvector） ===
    embedding = Column(Vector(EMBEDDING_DIM), nullable=True)
    embedding_text = Column(Text, nullable=True)

    # === 时间戳 ===
    created_at = Column(DateTime, server_default=func.now(), index=True)

    __table_args__ = (
        Index(
            'ix_behavior_embedding_hnsw',
            'embedding',
            postgresql_using='hnsw',
            postgresql_with={'m': 16, 'ef_construction': 64},
            postgresql_ops={'embedding': 'vector_cosine_ops'}
        ),
    )

    def __repr__(self):
        return f"<BehaviorDecisionLog(id={self.id}, action={self.action_type}, customer={self.customer_name})>"
