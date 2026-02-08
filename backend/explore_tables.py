from sqlalchemy import create_engine, inspect, text
import os

# Database connection settings
# Use the same connection string as the application
DATABASE_URL = "postgresql://postgres:weiwenhao520@172.23.55.133/tplus_data"

def list_tables():
    try:
        engine = create_engine(DATABASE_URL)
        conn = engine.connect()
        print("Successfully connected to the database!")
        
        # Query to list all tables in the public schema
        query = text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        
        result = conn.execute(query)
        tables = [row[0] for row in result.fetchall()]
        
        # Write tables to file
        with open("tables.txt", "w", encoding="utf-8") as f:
            for t in tables:
                f.write(t + "\n")

        print(f"Found {len(tables)} tables. Saved to tables.txt")

        print("\nPossible Voucher Tables (containing 'voucher', 'doc', 'gl', 'fi_'):")
        possible_tables = [t for t in tables if any(k in t.lower() for k in ['voucher', 'doc', 'gl', 'fi_'])]
        for t in possible_tables:
            print(f" - {t}")
            
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_tables()
