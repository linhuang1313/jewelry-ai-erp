# -*- coding: utf-8 -*-
"""
数据库连接模块
配置SQLAlchemy连接池和字符集参数，防止中文乱码
"""
from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker
import os
from dotenv import load_dotenv
from .utils.text_sanitizer import sanitize_session_instances

load_dotenv()

# 获取数据库URL，优先使用环境变量中的PostgreSQL连接
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./jewelry_erp.db")

# Railway PostgreSQL 使用 postgres:// 但 SQLAlchemy 需要 postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# PostgreSQL 连接参数 - 防止乱码的关键配置
connect_args = {}
if "sqlite" in DATABASE_URL:
    connect_args = {"check_same_thread": False}
elif "postgresql" in DATABASE_URL:
    # 添加字符集参数防止乱码
    connect_args = {
        "client_encoding": "UTF8",
        "application_name": "jewelry_erp"
    }

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


def _sanitize_before_flush(session: Session, flush_context, instances) -> None:
    sanitize_session_instances(session)


event.listen(Session, "before_flush", _sanitize_before_flush)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    _auto_migrate_inbound_orders()
    _auto_migrate_inbound_details()
    _auto_migrate_loan_details()
    _auto_migrate_loan_returns()
    _auto_migrate_payment_records()
    _auto_migrate_action_cards()
    _auto_migrate_transfer_items()
    _auto_migrate_return_order_details()


def _auto_migrate_inbound_orders():
    """Auto-add deleted_at column to inbound_orders if missing."""
    try:
        insp = inspect(engine)
        if 'inbound_orders' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('inbound_orders')}
        with engine.begin() as conn:
            if 'deleted_at' not in columns:
                conn.execute(text("ALTER TABLE inbound_orders ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_inbound_orders_deleted_at ON inbound_orders (deleted_at)"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate inbound_orders: {e}")


def _auto_migrate_inbound_details():
    """Auto-add standard_code/barcode columns to inbound_details if missing."""
    try:
        insp = inspect(engine)
        if 'inbound_details' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('inbound_details')}
        with engine.begin() as conn:
            if 'standard_code' not in columns:
                conn.execute(text("ALTER TABLE inbound_details ADD COLUMN standard_code VARCHAR(20)"))
            if 'barcode' not in columns:
                conn.execute(text("ALTER TABLE inbound_details ADD COLUMN barcode VARCHAR(50)"))
            # 将历史数据回填到 standard_code，保持兼容
            conn.execute(text("UPDATE inbound_details SET standard_code = product_code WHERE standard_code IS NULL AND product_code IS NOT NULL"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate inbound_details: {e}")


def _auto_migrate_loan_details():
    """Auto-add piece_count and piece_labor_cost columns to loan_details if missing."""
    try:
        insp = inspect(engine)
        if 'loan_details' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('loan_details')}
        with engine.begin() as conn:
            if 'piece_count' not in columns:
                conn.execute(text("ALTER TABLE loan_details ADD COLUMN piece_count INTEGER"))
            if 'piece_labor_cost' not in columns:
                conn.execute(text("ALTER TABLE loan_details ADD COLUMN piece_labor_cost FLOAT"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate loan_details: {e}")


def _auto_migrate_loan_returns():
    """Auto-add customer_id column to loan_returns if missing."""
    try:
        insp = inspect(engine)
        if 'loan_returns' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('loan_returns')}
        if 'customer_id' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE loan_returns ADD COLUMN customer_id INTEGER DEFAULT 0"))
                conn.execute(text("""
                    UPDATE loan_returns SET customer_id = lo.customer_id
                    FROM loan_orders lo WHERE loan_returns.loan_id = lo.id
                """))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate loan_returns: {e}")


def _auto_migrate_payment_records():
    """Auto-add receipt fields to payment_records if missing."""
    try:
        insp = inspect(engine)
        if 'payment_records' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('payment_records')}
        new_cols = {
            'gold_amount': 'FLOAT DEFAULT 0.0',
            'labor_amount': 'FLOAT DEFAULT 0.0',
            'receipt_reason': "VARCHAR(100) DEFAULT '货款'",
            'action_card_id': 'VARCHAR(50)',
            'reviewed_by': 'VARCHAR(50)',
        }
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in columns:
                    conn.execute(text(f"ALTER TABLE payment_records ADD COLUMN {col_name} {col_type}"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate payment_records: {e}")


def _auto_migrate_action_cards():
    """Auto-add business_result column to action_cards if missing."""
    try:
        insp = inspect(engine)
        if 'action_cards' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('action_cards')}
        if 'business_result' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE action_cards ADD COLUMN business_result JSON"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate action_cards: {e}")


def _auto_migrate_transfer_items():
    """Auto-add missing columns to inventory_transfer_items."""
    try:
        insp = inspect(engine)
        if 'inventory_transfer_items' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('inventory_transfer_items')}
        new_cols = {
            'product_code': 'VARCHAR(100)',
            'barcode': 'VARCHAR(50)',
            'labor_cost': 'FLOAT',
            'piece_count': 'INTEGER',
            'piece_labor_cost': 'FLOAT',
            'main_stone_weight': 'FLOAT',
            'main_stone_count': 'INTEGER',
            'sub_stone_weight': 'FLOAT',
            'sub_stone_count': 'INTEGER',
            'main_stone_mark': 'VARCHAR(50)',
            'sub_stone_mark': 'VARCHAR(50)',
            'pearl_weight': 'FLOAT',
            'bearing_weight': 'FLOAT',
            'sale_labor_cost': 'FLOAT',
            'sale_piece_labor_cost': 'FLOAT',
        }
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in columns:
                    conn.execute(text(f"ALTER TABLE inventory_transfer_items ADD COLUMN {col_name} {col_type}"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate inventory_transfer_items: {e}")


def _auto_migrate_return_order_details():
    """Auto-add missing columns to return_order_details."""
    try:
        insp = inspect(engine)
        if 'return_order_details' not in insp.get_table_names():
            return
        columns = {col['name'] for col in insp.get_columns('return_order_details')}
        new_cols = {
            'product_code': 'VARCHAR(100)',
            'main_stone_weight': 'NUMERIC(10,4)',
            'main_stone_count': 'INTEGER',
            'sub_stone_weight': 'NUMERIC(10,4)',
            'sub_stone_count': 'INTEGER',
            'main_stone_mark': 'VARCHAR(100)',
            'sub_stone_mark': 'VARCHAR(100)',
            'pearl_weight': 'NUMERIC(10,4)',
            'bearing_weight': 'NUMERIC(10,4)',
        }
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in columns:
                    conn.execute(text(f"ALTER TABLE return_order_details ADD COLUMN {col_name} {col_type}"))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Auto-migrate return_order_details: {e}")
