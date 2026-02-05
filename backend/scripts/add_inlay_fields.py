"""
为 inbound_details 表添加镶嵌入库相关字段 (PostgreSQL 版本)
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
    if 'inbound_details' not in tables:
        print("错误: inbound_details 表不存在")
        return
    
    print("检查 inbound_details 表的列...")
    
    # 需要添加的镶嵌相关字段
    inlay_fields = [
        ("main_stone_weight", "FLOAT"),           # 主石重
        ("main_stone_count", "INTEGER"),          # 主石粒数
        ("main_stone_price", "FLOAT"),            # 主石单价
        ("main_stone_amount", "FLOAT"),           # 主石额
        ("sub_stone_weight", "FLOAT"),            # 副石重
        ("sub_stone_count", "INTEGER"),           # 副石粒数
        ("sub_stone_price", "FLOAT"),             # 副石单价
        ("sub_stone_amount", "FLOAT"),            # 副石额
        ("stone_setting_fee", "FLOAT"),           # 镶石费
        ("total_amount", "FLOAT"),                # 总金额
        ("main_stone_mark", "VARCHAR(50)"),       # 主石字印
        ("sub_stone_mark", "VARCHAR(50)"),        # 副石字印
        ("pearl_weight", "FLOAT"),                # 珍珠重
        ("bearing_weight", "FLOAT"),              # 轴承重
        ("sale_labor_cost", "FLOAT"),             # 销售克工费
        ("sale_piece_labor_cost", "FLOAT"),       # 销售件工费
    ]
    
    with engine.connect() as conn:
        for field_name, field_type in inlay_fields:
            if not column_exists(inspector, "inbound_details", field_name):
                print(f"添加字段: {field_name}...")
                conn.execute(text(f"""
                    ALTER TABLE inbound_details 
                    ADD COLUMN {field_name} {field_type}
                """))
                conn.commit()
                print(f"✓ 已添加字段: {field_name}")
            else:
                print(f"✓ 字段已存在: {field_name}")
    
    print("\n✅ 镶嵌入库字段迁移完成！")


if __name__ == "__main__":
    main()
