from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
import logging
import os

# 梵贝琳财务系统数据库配置 (PostgreSQL)
# 用户提供的连接信息: postgresql://postgres:weiwenhao520@172.23.55.133/fbl_finance_data
# 优先从环境变量获取，如果没有则使用默认硬编码值（用于本地开发）
FBL_DATABASE_URL = os.getenv(
    "FBL_DATABASE_URL", 
    "postgresql://postgres:weiwenhao520@172.23.55.133/fbl_finance_data"
)

logger = logging.getLogger(__name__)

# 创建 FBL 数据库引擎
try:
    fbl_engine = create_engine(
        FBL_DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True
    )
    logger.info(f"梵贝琳财务数据库引擎创建成功: {FBL_DATABASE_URL.split('@')[-1]}")
except Exception as e:
    logger.error(f"梵贝琳财务数据库引擎创建失败: {e}")
    fbl_engine = None

# 创建 SessionLocal
FBLSessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=fbl_engine
) if fbl_engine else None

def get_fbl_db():
    """虽然是外部数据库，但在FastAPI中作为依赖项使用时，
    通常建议使用yield模式来确保会话正确关闭。
    """
    if FBLSessionLocal is None:
        logger.error("梵贝琳数据库连接未初始化")
        raise Exception("梵贝琳数据库连接未初始化")

    db = FBLSessionLocal()
    try:
        yield db
    finally:
        db.close()
