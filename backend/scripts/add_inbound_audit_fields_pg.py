"""
为 inbound_orders 表补充审核字段 (PostgreSQL 版本)
用于生产环境数据库迁移
"""
import os
import sys

# 添加 backend 目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, inspect
from dotenv import load_dotenv

load_dotenv()


def get_database_url():
    """获取数据库连接URL"""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("错误: 未设置 DATABASE_URL 环境变量")
        sys.exit(1)
    
    # Railway PostgreSQL 使用 postgres:// 但 SQLAlchemy 需要 postgresql://
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    
    return database_url


def column_exists(inspector, table: str, column: str) -> bool:
    """检查列是否存在"""
    columns = [col['name'] for col in inspector.get_columns(table)]
    return column in columns


def main():
    database_url = get_database_url()
    print(f"连接到数据库...")
    
    engine = create_engine(database_url)
    inspector = inspect(engine)
    
    # 检查表是否存在
    tables = inspector.get_table_names()
    if 'inbound_orders' not in tables:
        print("错误: inbound_orders 表不存在")
        return
    
    print("检查 inbound_orders 表的列...")
    
    with engine.connect() as conn:
        # 添加 is_audited 字段
        if not column_exists(inspector, "inbound_orders", "is_audited"):
            print("添加字段: is_audited...")
            conn.execute(text("""
                ALTER TABLE inbound_orders 
                ADD COLUMN is_audited BOOLEAN DEFAULT FALSE
            """))
            conn.commit()
            print("✓ 已添加字段: is_audited")
        else:
            print("✓ 字段已存在: is_audited")
        
        # 添加 audited_by 字段
        if not column_exists(inspector, "inbound_orders", "audited_by"):
            print("添加字段: audited_by...")
            conn.execute(text("""
                ALTER TABLE inbound_orders 
                ADD COLUMN audited_by VARCHAR(50)
            """))
            conn.commit()
            print("✓ 已添加字段: audited_by")
        else:
            print("✓ 字段已存在: audited_by")
        
        # 添加 audited_at 字段
        if not column_exists(inspector, "inbound_orders", "audited_at"):
            print("添加字段: audited_at...")
            conn.execute(text("""
                ALTER TABLE inbound_orders 
                ADD COLUMN audited_at TIMESTAMP WITH TIME ZONE
            """))
            conn.commit()
            print("✓ 已添加字段: audited_at")
        else:
            print("✓ 字段已存在: audited_at")
        
        # 为 is_audited 创建索引（如果不存在）
        try:
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_inbound_orders_is_audited 
                ON inbound_orders (is_audited)
            """))
            conn.commit()
            print("✓ 索引创建/已存在: ix_inbound_orders_is_audited")
        except Exception as e:
            print(f"索引创建跳过: {e}")
    
    print("\n✅ 数据库迁移完成！")


if __name__ == "__main__":
    main()
