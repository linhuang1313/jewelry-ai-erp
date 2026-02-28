"""Check all tables in remote database for duplicate primary key IDs."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from sqlalchemy import create_engine, text, inspect

DB_URL = "postgresql://postgres:weiwenhao520@47.76.120.172/railway"
engine = create_engine(DB_URL)

def check_all_tables():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"Checking {len(tables)} tables for duplicate IDs...\n")
    
    issues = []
    with engine.connect() as conn:
        for table in sorted(tables):
            columns = [col['name'] for col in inspector.get_columns(table)]
            if 'id' not in columns:
                continue
            
            result = conn.execute(text(f"""
                SELECT id, COUNT(*) as cnt 
                FROM "{table}" 
                GROUP BY id 
                HAVING COUNT(*) > 1
                ORDER BY id
            """))
            dupes = result.fetchall()
            
            if dupes:
                total_dupes = sum(d[1] - 1 for d in dupes)
                print(f"[DUPLICATE] {table}: {len(dupes)} duplicate IDs ({total_dupes} extra rows)")
                for d in dupes:
                    print(f"    id={d[0]}: {d[1]} rows")
                issues.append(table)
            else:
                row_count = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
                print(f"  [OK] {table} ({row_count} rows)")
    
    print(f"\n{'='*50}")
    if issues:
        print(f"FOUND ISSUES IN {len(issues)} TABLE(S): {', '.join(issues)}")
    else:
        print("ALL TABLES OK - No duplicate IDs found.")

if __name__ == "__main__":
    check_all_tables()
