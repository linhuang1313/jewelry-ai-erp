"""数据库迁移脚本：添加supplier_id列和suppliers表"""
import sys
import os

# 添加backend目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text, inspect
from dotenv import load_dotenv

# 导入模型
from app.models import Base, Supplier, InboundDetail
from app.database import engine

load_dotenv()

def migrate():
    """执行数据库迁移"""
    print("开始数据库迁移...")
    
    with engine.connect() as conn:
        # 1. 先创建suppliers表（如果不存在）
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        if 'suppliers' not in tables:
            print("创建suppliers表...")
            Base.metadata.create_all(bind=engine, tables=[Supplier.__table__])
            print("[OK] suppliers表创建成功")
        else:
            print("[OK] suppliers表已存在")
        
        # 2. 检查inbound_details表是否有supplier_id列
        if 'inbound_details' in tables:
            columns = [col['name'] for col in inspector.get_columns('inbound_details')]
            
            if 'supplier_id' not in columns:
                print("添加supplier_id列到inbound_details表...")
                try:
                    # SQLite的ALTER TABLE ADD COLUMN
                    conn.execute(text("""
                        ALTER TABLE inbound_details 
                        ADD COLUMN supplier_id INTEGER
                    """))
                    conn.commit()
                    print("[OK] supplier_id列添加成功")
                except Exception as e:
                    print(f"[ERROR] 添加列失败: {e}")
                    print("SQLite可能不支持某些ALTER操作，尝试重建表...")
                    rebuild_table(conn)
            else:
                print("[OK] supplier_id列已存在")
        else:
            print("inbound_details表不存在，将在下次启动时自动创建")
    
    print("\n数据库迁移完成！")

def rebuild_table(conn):
    """重建inbound_details表（SQLite不支持某些ALTER操作）"""
    print("开始重建inbound_details表...")
    
    try:
        # 1. 创建新表
        conn.execute(text("""
            CREATE TABLE inbound_details_new (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL,
                product_name VARCHAR(200) NOT NULL,
                product_category VARCHAR(100),
                weight FLOAT NOT NULL,
                labor_cost FLOAT NOT NULL,
                supplier VARCHAR(100),
                supplier_id INTEGER,
                total_cost FLOAT NOT NULL,
                FOREIGN KEY(order_id) REFERENCES inbound_orders(id),
                FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
            )
        """))
        
        # 2. 复制数据
        conn.execute(text("""
            INSERT INTO inbound_details_new 
            (id, order_id, product_name, product_category, weight, labor_cost, supplier, total_cost)
            SELECT id, order_id, product_name, product_category, weight, labor_cost, supplier, total_cost
            FROM inbound_details
        """))
        
        # 3. 删除旧表
        conn.execute(text("DROP TABLE inbound_details"))
        
        # 4. 重命名新表
        conn.execute(text("ALTER TABLE inbound_details_new RENAME TO inbound_details"))
        
        conn.commit()
        print("[OK] 表重建成功")
    except Exception as e:
        print(f"[ERROR] 重建表失败: {e}")
        conn.rollback()
        raise

if __name__ == "__main__":
    migrate()

