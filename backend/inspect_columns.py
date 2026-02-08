from app.tplus_database import tplus_engine
from sqlalchemy import text
import sys

# Set encoding to utf-8 for stdout
sys.stdout.reconfigure(encoding='utf-8')

def inspect_columns():
    if not tplus_engine:
        print("Engine not initialized.")
        return

    try:
        with tplus_engine.connect() as conn:
            with open("columns.txt", "w", encoding="utf-8") as f:
                # Query columns for gl_doc
                f.write("Columns for gl_doc:\n")
                query = text("""
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = 'gl_doc'
                    ORDER BY ordinal_position;
                """)
                result = conn.execute(query)
                for row in result:
                    f.write(f" - {row[0]} ({row[1]})\n")

                f.write("\nColumns for gl_entry:\n")
                query = text("""
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = 'gl_entry'
                    ORDER BY ordinal_position;
                """)
                result = conn.execute(query)
                for row in result:
                    f.write(f" - {row[0]} ({row[1]})\n")
            
            print("Saved columns to columns.txt")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_columns()
