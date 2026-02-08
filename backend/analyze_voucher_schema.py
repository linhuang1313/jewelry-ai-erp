
import os
from sqlalchemy import create_engine, inspect, text
from dotenv import load_dotenv

import urllib.parse

# Construct database URL
password = urllib.parse.quote_plus("weiwenhao520")
DATABASE_URL = f"postgresql://postgres:{password}@172.23.55.133/fbl_finance_data"

def analyze_schema():
    try:
        engine = create_engine(DATABASE_URL)
        inspector = inspect(engine)
        
        tables = ['gl_doc', 'gl_entry', 'aa_account']
        
        with open("schema_analysis.txt", "w", encoding="utf-8") as f:
            f.write(f"Analyzing tables: {tables}\n")
            
            for table_name in tables:
                f.write(f"\n--- Table: {table_name} ---\n")
                if not inspector.has_table(table_name):
                    f.write(f"Table {table_name} does not exist.\n")
                    continue
                    
                columns = inspector.get_columns(table_name)
                for col in columns:
                    f.write(f"Column: {col['name']} | Type: {col['type']} | Nullable: {col['nullable']} | Default: {col.get('default')}\n")
                    
                pk = inspector.get_pk_constraint(table_name)
                f.write(f"Primary Key: {pk}\n")

    except Exception as e:
        print(f"Error analyzing schema: {e}")

if __name__ == "__main__":
    analyze_schema()
