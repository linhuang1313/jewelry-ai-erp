"""
Fix duplicate location_inventory records.

For each (product_name, location_id) group with more than one row:
  1. SUM all weights
  2. Keep the row with the smallest id, update its weight to the sum
  3. Delete the remaining rows

Also attempts to create a UNIQUE INDEX afterwards to prevent recurrence.
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import create_engine, text

DB_URL = "postgresql://postgres:weiwenhao520@47.76.120.172/railway"
engine = create_engine(DB_URL)

with engine.begin() as conn:
    # Find all duplicate groups
    dupes = conn.execute(text(
        "SELECT product_name, location_id, COUNT(*) as cnt, "
        "       ROUND(COALESCE(SUM(weight), 0)::numeric, 4) as total_weight, "
        "       MIN(id) as keep_id "
        "FROM location_inventory "
        "GROUP BY product_name, location_id "
        "HAVING COUNT(*) > 1 "
        "ORDER BY cnt DESC"
    )).fetchall()

    if not dupes:
        print("No duplicate records found. Nothing to fix.")
        sys.exit(0)

    print(f"Found {len(dupes)} duplicate groups:\n")
    total_deleted = 0

    for row in dupes:
        pname, loc_id, cnt, total_w, keep_id = row
        print(f"  [{pname}] location_id={loc_id}: {cnt} rows, total_weight={total_w}, keeping id={keep_id}")

        # Update the kept row with the summed weight
        conn.execute(text(
            "UPDATE location_inventory SET weight = :w WHERE id = :id"
        ), {"w": float(total_w), "id": keep_id})

        # Delete all other rows in this group
        result = conn.execute(text(
            "DELETE FROM location_inventory "
            "WHERE product_name = :pn AND location_id = :lid AND id != :keep_id"
        ), {"pn": pname, "lid": loc_id, "keep_id": keep_id})

        deleted = result.rowcount
        total_deleted += deleted
        print(f"    -> updated id={keep_id} to weight={total_w}, deleted {deleted} duplicate rows")

    print(f"\nTotal: merged {len(dupes)} groups, deleted {total_deleted} duplicate rows.")

    # Verify no duplicates remain
    check = conn.execute(text(
        "SELECT product_name, location_id, COUNT(*) "
        "FROM location_inventory "
        "GROUP BY product_name, location_id "
        "HAVING COUNT(*) > 1"
    )).fetchall()

    if check:
        print(f"\nWARNING: {len(check)} duplicate groups still remain!")
        for r in check:
            print(f"  {r[0]}, location_id={r[1]}, count={r[2]}")
    else:
        print("\nVerified: no duplicates remain.")

    # Try to create unique index
    print("\nAttempting to create UNIQUE INDEX...")
    try:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_location_product "
            "ON location_inventory(product_name, location_id)"
        ))
        print("UNIQUE INDEX 'uq_location_product' created successfully.")
    except Exception as e:
        print(f"Failed to create UNIQUE INDEX: {e}")
        print("You may need to manually create it after verifying data.")

    # Final verification: check the specific product
    verify = conn.execute(text(
        "SELECT id, product_name, weight, location_id "
        "FROM location_inventory "
        "WHERE product_name = :name "
        "ORDER BY location_id, id"
    ), {"name": "镶嵌产品"}).fetchall()
    print(f"\nFinal state for '镶嵌产品':")
    for r in verify:
        print(f"  id={r[0]}, weight={r[2]}, location_id={r[3]}")
