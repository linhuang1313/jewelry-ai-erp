from app.tplus_database import tplus_engine
from sqlalchemy import text
import sys

# Set encoding to utf-8 for stdout
sys.stdout.reconfigure(encoding='utf-8')

def inspect_account_table():
    if not tplus_engine:
        print("Engine not initialized.")
        return

    try:
        with tplus_engine.connect() as conn:
            print("Columns for aa_account:")
            query = text("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'aa_account'
                ORDER BY ordinal_position;
            """)
            result = conn.execute(query)
            for row in result:
                print(f" - {row[0]} ({row[1]})")

            # Also check if there's any data in gl_entry for idaccount
            print("\nSample gl_entry idaccount vs code/name:")
            query = text("""
                SELECT idaccount, code, name 
                FROM gl_entry 
                LIMIT 5;
            """)
            result = conn.execute(query)
            for row in result:
                print(f" - idaccount: {row[0]}, code: {row[1]}, name: {row[2]}")
                
            # Sample aa_account
            print("\nSample aa_account data:")
            query = text("""
                SELECT id, code, name 
                FROM aa_account 
                LIMIT 5;
            """)
            result = conn.execute(query)
            for row in result:
                print(f" - id: {row[0]}, code: {row[1]}, name: {row[2]}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_account_table()
