from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

# 获取数据库URL，优先使用环境变量中的PostgreSQL连接
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./jewelry_erp.db")

# Railway PostgreSQL 使用 postgres:// 但 SQLAlchemy 需要 postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 根据数据库类型配置连接参数
connect_args = {}
if "sqlite" in DATABASE_URL:
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL, 
    connect_args=connect_args,
    pool_size=10,           # 常驻连接数
    max_overflow=20,        # 溢出连接数
    pool_timeout=30,        # 等待连接超时时间
    pool_recycle=1800,      # 30分钟回收连接，防止数据库断开
    pool_pre_ping=True      # 使用前检查连接是否有效
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)


