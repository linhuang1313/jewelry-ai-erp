"""数据库迁移脚本 - 添加灵活支付字段"""
import sqlite3

def migrate():
    conn = sqlite3.connect('jewelry_erp.db')
    cursor = conn.cursor()
    
    # 检查列是否已存在
    cursor.execute("PRAGMA table_info(settlement_orders)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if 'payment_status' not in columns:
        cursor.execute("ALTER TABLE settlement_orders ADD COLUMN payment_status TEXT DEFAULT 'full'")
        print("Added payment_status column")
    else:
        print("payment_status column already exists")
    
    conn.commit()
    print("Migration completed")
    print("Columns:", columns + ['payment_status'] if 'payment_status' not in columns else columns)
    conn.close()

if __name__ == "__main__":
    migrate()

