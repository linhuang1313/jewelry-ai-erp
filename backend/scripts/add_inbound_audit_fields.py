"""
为 inbound_orders 表补充审核字段
"""
import sqlite3
import os


def column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def main():
    db_path = os.getenv("DB_PATH", "app.db")
    if not os.path.exists(db_path):
        print(f"数据库文件不存在: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    if not column_exists(cursor, "inbound_orders", "is_audited"):
        cursor.execute("ALTER TABLE inbound_orders ADD COLUMN is_audited BOOLEAN DEFAULT 0")
        print("已添加字段: is_audited")
    else:
        print("字段已存在: is_audited")

    if not column_exists(cursor, "inbound_orders", "audited_by"):
        cursor.execute("ALTER TABLE inbound_orders ADD COLUMN audited_by VARCHAR(50)")
        print("已添加字段: audited_by")
    else:
        print("字段已存在: audited_by")

    if not column_exists(cursor, "inbound_orders", "audited_at"):
        cursor.execute("ALTER TABLE inbound_orders ADD COLUMN audited_at DATETIME")
        print("已添加字段: audited_at")
    else:
        print("字段已存在: audited_at")

    conn.commit()
    conn.close()
    print("处理完成")


if __name__ == "__main__":
    main()
