"""
数据库迁移脚本：为 inbound_details 表添加 product_code 字段
"""
import os
import sys

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text

def migrate():
    # 获取数据库连接
    database_url = os.getenv("DATABASE_URL")
    
    if not database_url:
        print("错误：未找到 DATABASE_URL 环境变量")
        return False
    
    # 处理 Railway 的 postgres:// URL
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    
    engine = create_engine(database_url)
    
    try:
        with engine.connect() as conn:
            # 检查列是否已存在
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'inbound_details' AND column_name = 'product_code'
            """))
            
            if result.fetchone():
                print("product_code 列已存在，无需迁移")
                return True
            
            # 添加 product_code 列
            print("正在添加 product_code 列到 inbound_details 表...")
            conn.execute(text("""
                ALTER TABLE inbound_details 
                ADD COLUMN product_code VARCHAR(20) NULL
            """))
            conn.commit()
            
            print("✅ 迁移成功：已添加 product_code 列")
            return True
            
    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        return False

if __name__ == "__main__":
    migrate()


