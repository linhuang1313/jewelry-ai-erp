from sqlalchemy import create_engine, text
import sys

sys.stdout = open("db_schema.txt", "w", encoding="utf-8")

DB_URL = "postgresql://postgres:weiwenhao520@172.23.55.133/fbl_finance_data"

try:
    engine = create_engine(DB_URL)
    conn = engine.connect()
except Exception as e:
    print(f"Connection Failed: {e}")
    sys.exit(1)

# List all aa_ tables
print("--- Tables starting with aa_ ---")
query = text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'aa_%'")
rows = conn.execute(query).fetchall()
for row in rows:
    print(row[0])

# Check aa_account columns
print("\n--- aa_account columns ---")
query = text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'aa_account'")
rows = conn.execute(query).fetchall()
for row in rows:
    print(f"{row[0]}: {row[1]}")

# Check aa_doctype columns
print("\n--- aa_doctype columns ---")
query = text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'aa_doctype'")
rows = conn.execute(query).fetchall()
for row in rows:
    print(f"{row[0]}: {row[1]}")

# Check aa_partner columns
print("\n--- aa_partner columns ---")
query = text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'aa_partner'")
rows = conn.execute(query).fetchall()
for row in rows:
    print(f"{row[0]}: {row[1]}")

conn.close()
