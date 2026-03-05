from sqlalchemy import create_engine, text
import json
import os

FBL_DATABASE_URL = os.getenv("FBL_DATABASE_URL", "postgresql://postgres:weiwenhao520@127.0.0.1/fbl_finance_data")

try:
    engine = create_engine(FBL_DATABASE_URL)
    with engine.connect() as conn:
        query = text("""
            SELECT id, code, name 
            FROM aa_account 
            WHERE ("isEndNode" = 1) AND (disabled IS NULL OR disabled = 0)
            AND code LIKE '%40%'
        """)
        result = conn.execute(query)
        rows = [dict(row._mapping) for row in result]
        print(f"Total matching 400-like items: {len(rows)}")
        for r in rows:
            print(r)
except Exception as e:
    print(f"Database error: {e}")
