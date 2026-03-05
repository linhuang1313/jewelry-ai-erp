"""Fix duplicate IDs across all affected tables in remote database."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import create_engine, text, inspect

DB_URL = "postgresql://postgres:weiwenhao520@47.76.120.172/railway"
engine = create_engine(DB_URL)

TABLES_TO_FIX = [
    "product_codes",
    "suppliers",
    "account_receivables",
    "account_payables",
    "customer_transactions",
    "supplier_gold_transactions",
    "loan_order_logs",
    "order_status_logs",
]


def fix_table(conn, table_name):
    seq_name = f"{table_name}_id_seq"

    # Check if sequence exists
    seq_exists = conn.execute(text(
        "SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = :seq"
    ), {"seq": seq_name}).fetchone()

    if not seq_exists:
        print(f"  [SKIP] No sequence '{seq_name}' found, skipping")
        return 0

    # Reset sequence to max id
    conn.execute(text(f"SELECT setval('{seq_name}', (SELECT COALESCE(MAX(id), 1) FROM \"{table_name}\"))"))

    # Find duplicate IDs
    rows = conn.execute(text(
        f'SELECT id, ctid FROM "{table_name}" ORDER BY id, ctid'
    )).fetchall()

    seen_ids = set()
    to_fix = []
    for r in rows:
        if r[0] in seen_ids:
            to_fix.append((r[0], r[1]))
        else:
            seen_ids.add(r[0])

    if not to_fix:
        print(f"  [OK] No duplicates")
        return 0

    for old_id, ctid in to_fix:
        result = conn.execute(text(
            f'UPDATE "{table_name}" SET id = nextval(\'{seq_name}\') '
            f'WHERE ctid = :ctid RETURNING id'
        ), {"ctid": ctid})
        new_id = result.fetchone()[0]

    print(f"  [FIXED] {len(to_fix)} records reassigned new IDs")
    return len(to_fix)


def main():
    total_fixed = 0
    with engine.begin() as conn:
        for table in TABLES_TO_FIX:
            print(f"\n--- {table} ---")
            fixed = fix_table(conn, table)
            total_fixed += fixed

    print(f"\n{'='*50}")
    print(f"Total: {total_fixed} duplicate records fixed across {len(TABLES_TO_FIX)} tables")

    # Verify
    print(f"\n--- VERIFICATION ---")
    with engine.connect() as conn:
        all_clean = True
        for table in TABLES_TO_FIX:
            dupes = conn.execute(text(
                f'SELECT id, COUNT(*) FROM "{table}" GROUP BY id HAVING COUNT(*) > 1'
            )).fetchall()
            if dupes:
                print(f"  [STILL BROKEN] {table}: {len(dupes)} duplicate IDs remain")
                all_clean = False
            else:
                row_count = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
                print(f"  [OK] {table} ({row_count} rows, all unique)")

        if all_clean:
            print(f"\nAll {len(TABLES_TO_FIX)} tables verified clean.")
        else:
            print(f"\nSome tables still have issues!")


if __name__ == "__main__":
    main()
