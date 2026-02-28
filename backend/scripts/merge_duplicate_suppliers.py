"""
合并重复供应商：找出同名 active 供应商，保留最早创建的，迁移关联数据，停用多余记录。
默认 dry-run 模式，加 --execute 参数才会真正执行。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

RELATED_TABLES = [
    "inbound_details",
    "return_orders",
    "gold_material_transactions",
    "gold_purchase_orders",
    "account_payables",
    "supplier_payments",
    "supplier_gold_transactions",
]


def get_database_url():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("错误: 未设置 DATABASE_URL 环境变量")
        sys.exit(1)
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    return database_url


def find_duplicates(conn):
    """找出所有同名 active 供应商组"""
    rows = conn.execute(text("""
        SELECT name, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
        FROM suppliers
        WHERE status = 'active'
        GROUP BY name
        HAVING count(*) > 1
    """)).fetchall()
    return rows


def merge_group(conn, name, ids, execute=False):
    """合并一组重复供应商，保留 ids[0]，迁移其余"""
    keep_id = ids[0]
    dup_ids = ids[1:]
    print(f"\n{'='*60}")
    print(f"供应商: {name}")
    print(f"  保留 ID: {keep_id}")
    print(f"  合并 ID: {dup_ids}")

    for dup_id in dup_ids:
        for table in RELATED_TABLES:
            result = conn.execute(text(
                f"SELECT count(*) FROM {table} WHERE supplier_id = :dup_id"
            ), {"dup_id": dup_id})
            count = result.scalar()
            if count > 0:
                print(f"  [{table}] {count} 条记录 supplier_id {dup_id} -> {keep_id}")
                if execute:
                    conn.execute(text(
                        f"UPDATE {table} SET supplier_id = :keep_id WHERE supplier_id = :dup_id"
                    ), {"keep_id": keep_id, "dup_id": dup_id})

        # supplier_gold_accounts: merge balances then delete duplicate
        acct = conn.execute(text(
            "SELECT id, current_balance, total_received, total_paid "
            "FROM supplier_gold_accounts WHERE supplier_id = :dup_id"
        ), {"dup_id": dup_id}).fetchone()
        if acct:
            print(f"  [supplier_gold_accounts] 合并金料账户 (余额: {acct.current_balance})")
            if execute:
                conn.execute(text("""
                    UPDATE supplier_gold_accounts SET
                        current_balance = current_balance + :bal,
                        total_received = total_received + :recv,
                        total_paid = total_paid + :paid
                    WHERE supplier_id = :keep_id
                """), {
                    "bal": float(acct.current_balance or 0),
                    "recv": float(acct.total_received or 0),
                    "paid": float(acct.total_paid or 0),
                    "keep_id": keep_id,
                })
                conn.execute(text(
                    "DELETE FROM supplier_gold_accounts WHERE supplier_id = :dup_id"
                ), {"dup_id": dup_id})

        # Merge supplier statistics into the kept record
        dup_stats = conn.execute(text(
            "SELECT total_supply_weight, total_supply_amount, total_supply_count "
            "FROM suppliers WHERE id = :dup_id"
        ), {"dup_id": dup_id}).fetchone()
        if dup_stats:
            print(f"  [suppliers] 合并统计: 重量+{dup_stats.total_supply_weight}, "
                  f"金额+{dup_stats.total_supply_amount}, 次数+{dup_stats.total_supply_count}")
            if execute:
                conn.execute(text("""
                    UPDATE suppliers SET
                        total_supply_weight = COALESCE(total_supply_weight, 0) + :w,
                        total_supply_amount = COALESCE(total_supply_amount, 0) + :a,
                        total_supply_count = COALESCE(total_supply_count, 0) + :c
                    WHERE id = :keep_id
                """), {
                    "w": float(dup_stats.total_supply_weight or 0),
                    "a": float(dup_stats.total_supply_amount or 0),
                    "c": int(dup_stats.total_supply_count or 0),
                    "keep_id": keep_id,
                })

        # Deactivate the duplicate
        print(f"  [suppliers] 停用 ID {dup_id}")
        if execute:
            conn.execute(text(
                "UPDATE suppliers SET status = 'inactive' WHERE id = :dup_id"
            ), {"dup_id": dup_id})


def find_duplicate_payables(conn):
    """找出 account_payables 中同一 (inbound_order_id, supplier_id) 有多条记录的组"""
    rows = conn.execute(text("""
        SELECT inbound_order_id, supplier_id,
               array_agg(id ORDER BY id) AS ids, count(*) AS cnt
        FROM account_payables
        WHERE inbound_order_id IS NOT NULL
        GROUP BY inbound_order_id, supplier_id
        HAVING count(*) > 1
    """)).fetchall()
    return rows


def dedup_payables(conn, execute=False):
    """去重 account_payables：同一 (inbound_order_id, supplier_id) 只保留最早的一条"""
    duplicates = find_duplicate_payables(conn)
    if not duplicates:
        print("\n没有发现重复的应付账款记录。")
        return

    print(f"\n发现 {len(duplicates)} 组重复应付账款:")
    total_deleted = 0
    for row in duplicates:
        ids = list(row.ids)
        keep_id = ids[0]
        dup_ids = ids[1:]
        print(f"  入库单ID={row.inbound_order_id}, 供应商ID={row.supplier_id}: "
              f"保留 {keep_id}, 删除 {dup_ids}")
        if execute:
            for dup_id in dup_ids:
                conn.execute(text(
                    "DELETE FROM account_payables WHERE id = :dup_id"
                ), {"dup_id": dup_id})
            total_deleted += len(dup_ids)

    if execute:
        print(f"\n已删除 {total_deleted} 条重复应付账款。")
    else:
        print(f"\n以上为预览，加 --execute 参数执行实际删除。")


def dedup_location_inventory(conn, execute=False):
    """去重 location_inventory：同一 (product_name, location_id) 只保留一条，合并重量"""
    rows = conn.execute(text("""
        SELECT product_name, location_id,
               array_agg(id ORDER BY id) AS ids,
               count(*) AS cnt,
               sum(weight) AS total_weight
        FROM location_inventory
        GROUP BY product_name, location_id
        HAVING count(*) > 1
    """)).fetchall()

    if not rows:
        print("\n没有发现重复的分仓库存记录。")
        return

    print(f"\n发现 {len(rows)} 组重复分仓库存:")
    total_deleted = 0
    for row in rows:
        ids = list(row.ids)
        keep_id = ids[0]
        dup_ids = ids[1:]
        print(f"  商品={row.product_name}, 位置ID={row.location_id}: "
              f"{row.cnt} 条 -> 合并为 {float(row.total_weight):.4f}g, 保留 {keep_id}, 删除 {dup_ids}")
        if execute:
            conn.execute(text(
                "UPDATE location_inventory SET weight = :w WHERE id = :keep_id"
            ), {"w": float(row.total_weight), "keep_id": keep_id})
            for dup_id in dup_ids:
                conn.execute(text(
                    "DELETE FROM location_inventory WHERE id = :dup_id"
                ), {"dup_id": dup_id})
            total_deleted += len(dup_ids)

    if execute:
        print(f"\n已合并 {total_deleted} 条重复分仓库存。")
    else:
        print(f"\n以上为预览，加 --execute 参数执行。")


def dedup_inventory(conn, execute=False):
    """去重 inventory：同一 product_name 只保留一条，合并重量"""
    rows = conn.execute(text("""
        SELECT product_name,
               array_agg(id ORDER BY id) AS ids,
               count(*) AS cnt,
               sum(total_weight) AS total_weight
        FROM inventory
        GROUP BY product_name
        HAVING count(*) > 1
    """)).fetchall()

    if not rows:
        print("\n没有发现重复的总库存记录。")
        return

    print(f"\n发现 {len(rows)} 组重复总库存:")
    total_deleted = 0
    for row in rows:
        ids = list(row.ids)
        keep_id = ids[0]
        dup_ids = ids[1:]
        print(f"  商品={row.product_name}: {row.cnt} 条 -> 合并为 {float(row.total_weight):.4f}g, "
              f"保留 {keep_id}, 删除 {dup_ids}")
        if execute:
            conn.execute(text(
                "UPDATE inventory SET total_weight = :w WHERE id = :keep_id"
            ), {"w": float(row.total_weight), "keep_id": keep_id})
            for dup_id in dup_ids:
                conn.execute(text(
                    "DELETE FROM inventory WHERE id = :dup_id"
                ), {"dup_id": dup_id})
            total_deleted += len(dup_ids)

    if execute:
        print(f"\n已合并 {total_deleted} 条重复总库存。")
    else:
        print(f"\n以上为预览，加 --execute 参数执行。")


def main():
    execute = "--execute" in sys.argv
    mode = "执行模式" if execute else "预览模式 (dry-run)"
    print(f"数据清理工具 - {mode}")
    print("=" * 60)

    engine = create_engine(get_database_url())

    with engine.begin() as conn:
        # Part 1: 合并重复供应商
        print("\n[1/4] 检查重复供应商...")
        duplicates = find_duplicates(conn)
        if not duplicates:
            print("没有发现重复的 active 供应商。")
        else:
            print(f"发现 {len(duplicates)} 组重复供应商:")
            for row in duplicates:
                print(f"  - {row.name}: {row.cnt} 条 (IDs: {list(row.ids)})")
            for row in duplicates:
                merge_group(conn, row.name, list(row.ids), execute=execute)
            if execute:
                print(f"\n已合并 {len(duplicates)} 组重复供应商。")
            else:
                print(f"\n以上为预览，加 --execute 参数执行实际合并。")

        # Part 2: 去重应付账款
        print(f"\n[2/4] 检查重复应付账款...")
        dedup_payables(conn, execute=execute)

        # Part 3: 去重分仓库存
        print(f"\n[3/4] 检查重复分仓库存...")
        dedup_location_inventory(conn, execute=execute)

        # Part 4: 去重总库存
        print(f"\n[4/4] 检查重复总库存...")
        dedup_inventory(conn, execute=execute)


if __name__ == "__main__":
    main()
