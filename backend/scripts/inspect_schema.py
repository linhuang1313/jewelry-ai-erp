from sqlalchemy import create_engine, text

url = "postgresql://postgres:weiwenhao520@172.23.55.133/fbl_finance_data"
engine = create_engine(url)

try:
    with engine.connect() as conn:
        print("Connected to DB.")
        
        print("\n--- aa_account Schema ---")
        try:
            res = conn.execute(text("SELECT * FROM aa_account LIMIT 1"))
            print("Columns:", list(res.keys()))
            row = res.fetchone()
            if row:
                print("First row:", dict(row._mapping))
        except Exception as e:
            print(f"Error specific to aa_account: {e}")

        # Try to find class/type info
        tables_to_check = ['aa_accountclass', 'aa_accounttype', 'aa_trantype']
        for t in tables_to_check:
            print(f"\n--- {t} Schema ---")
            try:
                res = conn.execute(text(f"SELECT * FROM {t} LIMIT 1"))
                print("Columns:", list(res.keys()))
                row = res.fetchone()
                if row:
                    print("First row:", dict(row._mapping))
            except Exception as e:
                print(f"Table {t} error: {e}")

except Exception as e:
    print(f"Connection Error: {e}")
