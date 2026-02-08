from sqlalchemy import create_engine, text
import os
import urllib.parse

# Construct database URL
password = urllib.parse.quote_plus("weiwenhao520")
DATABASE_URL = f"postgresql://postgres:{password}@172.23.55.133/fbl_finance_data"

def check_schema():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        try:
            # 1. Check if AA_DocType table exists
            print("Checking AA_DocType table...")
            result = connection.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_name = 'aa_doctype'"))
            exists = result.scalar()
            print(f"AA_DocType exists: {exists}")

            if exists:
                # 2. Check columns of AA_DocType
                print("\nColumns in AA_DocType:")
                result = connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'aa_doctype'"))
                for row in result:
                    print(f"- {row[0]}")
                
                # 3. Sample data from AA_DocType
                print("\nSample data from AA_DocType:")
                result = connection.execute(text("SELECT * FROM aa_doctype LIMIT 3"))
                for row in result:
                    print(row)

            # 4. Check for iddoctype in gl_doc
            print("\nChecking for iddoctype in gl_doc...")
            result = connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'gl_doc' AND column_name = 'iddoctype'"))
            col_exists = result.scalar()
            print(f"iddoctype column exists in gl_doc: {bool(col_exists)}")
            
            if not col_exists:
                 print("\nListing all columns in gl_doc to find type-related column:")
                 result = connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'gl_doc'"))
                 for row in result:
                     print(f"- {row[0]}")

        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    check_schema()
