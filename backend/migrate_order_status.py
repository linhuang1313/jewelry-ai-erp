"""
数据迁移脚本：将旧状态值映射为新的两步流程状态值
部署新代码时运行一次：python migrate_order_status.py

映射规则：
- 入库单: "已入库" → "confirmed"
- 销售单: "待结算"/"已结算" → "confirmed", "已取消" → "cancelled"
- 退货单: "completed"/"approved" → "confirmed", "pending" → "draft", "rejected" → "cancelled"
- 结算单: "pending" → "draft"
"""
import os
import sys

# 确保可以导入 app 模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()


def get_database_url():
    """获取数据库连接 URL"""
    url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
    if not url:
        # 本地 SQLite
        db_path = os.path.join(os.path.dirname(__file__), "jewelry_erp.db")
        url = f"sqlite:///{db_path}"
    return url


def migrate():
    url = get_database_url()
    engine = create_engine(url)

    migrations = [
        # 入库单
        ("inbound_orders", "已入库", "confirmed"),
        # 销售单
        ("sales_orders", "待结算", "confirmed"),
        ("sales_orders", "已结算", "confirmed"),
        ("sales_orders", "已取消", "cancelled"),
        # 退货单
        ("return_orders", "completed", "confirmed"),
        ("return_orders", "approved", "confirmed"),
        ("return_orders", "pending", "draft"),
        ("return_orders", "rejected", "cancelled"),
        # 结算单
        ("settlement_orders", "pending", "draft"),
    ]

    with engine.connect() as conn:
        for table, old_status, new_status in migrations:
            try:
                result = conn.execute(
                    text(f"UPDATE {table} SET status = :new WHERE status = :old"),
                    {"new": new_status, "old": old_status},
                )
                count = result.rowcount
                if count > 0:
                    print(f"  {table}: '{old_status}' -> '{new_status}' ({count} rows)")
                else:
                    print(f"  {table}: '{old_status}' -> '{new_status}' (no rows)")
            except Exception as e:
                print(f"  {table}: ERROR - {e}")

        conn.commit()

    print("\nDone! Migration complete.")


if __name__ == "__main__":
    print("=== Order Status Migration ===\n")
    migrate()
