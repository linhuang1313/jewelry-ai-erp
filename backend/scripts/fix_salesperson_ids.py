"""Fix duplicate salesperson IDs in remote database."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import create_engine, text

DB_URL = "postgresql://postgres:weiwenhao520@47.76.120.172/railway"
engine = create_engine(DB_URL)

def diagnose():
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, name, status, create_time FROM salespersons ORDER BY id, name"
        )).fetchall()
        print(f"Total records: {len(rows)}")
        
        seen_ids = {}
        duplicates = []
        for r in rows:
            print(f"  id={r[0]}, name={r[1]}, status={r[2]}")
            if r[0] in seen_ids:
                duplicates.append((r[0], r[1], seen_ids[r[0]]))
            else:
                seen_ids[r[0]] = r[1]
        
        if duplicates:
            print(f"\nDuplicate IDs found: {len(duplicates)}")
            for dup_id, name2, name1 in duplicates:
                print(f"  id={dup_id}: '{name1}' and '{name2}'")
        else:
            print("\nNo duplicate IDs found.")
        
        # Check for duplicate names
        name_counts = {}
        for r in rows:
            if r[2] == 'active':
                name_counts[r[1]] = name_counts.get(r[1], 0) + 1
        dup_names = {n: c for n, c in name_counts.items() if c > 1}
        if dup_names:
            print(f"\nDuplicate names: {dup_names}")
        else:
            print("\nNo duplicate names.")
        
        return duplicates

def fix():
    with engine.begin() as conn:
        # Step 1: Reset sequence to max id
        conn.execute(text(
            "SELECT setval('salespersons_id_seq', (SELECT COALESCE(MAX(id), 1) FROM salespersons))"
        ))
        print("Step 1: Sequence reset to max id")
        
        # Step 2: Find all records, group by id
        rows = conn.execute(text(
            "SELECT id, name, status, ctid FROM salespersons ORDER BY id, ctid"
        )).fetchall()
        
        seen_ids = set()
        to_fix = []
        for r in rows:
            if r[0] in seen_ids:
                to_fix.append((r[0], r[1], r[3]))  # id, name, ctid
            else:
                seen_ids.add(r[0])
        
        print(f"Step 2: Found {len(to_fix)} records needing new IDs")
        
        # Step 3: Assign new IDs using ctid for precise targeting
        for old_id, name, ctid in to_fix:
            result = conn.execute(text(
                "UPDATE salespersons SET id = nextval('salespersons_id_seq') "
                "WHERE ctid = :ctid RETURNING id"
            ), {"ctid": ctid})
            new_id = result.fetchone()[0]
            print(f"  '{name}': id {old_id} -> {new_id}")
        
        # Step 4: Verify
        rows = conn.execute(text(
            "SELECT id, name, status FROM salespersons WHERE status = 'active' ORDER BY id"
        )).fetchall()
        print(f"\nAfter fix - Active salespersons ({len(rows)}):")
        for r in rows:
            print(f"  id={r[0]}, name={r[1]}")

if __name__ == "__main__":
    print("=== DIAGNOSE ===")
    dupes = diagnose()
    
    if dupes:
        print("\n=== FIXING ===")
        fix()
        print("\nDone!")
    else:
        print("\nNothing to fix.")
