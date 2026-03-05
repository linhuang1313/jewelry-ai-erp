import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.fbl_database import get_fbl_db
from sqlalchemy import text

def add_unit_column():
    db = next(get_fbl_db())
    try:
        print("Checking if 'unit' column exists in 'gl_entry'...")
        # Check if column exists
        check_query = text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='gl_entry' AND column_name='unit'
        """)
        result = db.execute(check_query).fetchone()
        
        if result:
            print("Column 'unit' already exists.")
        else:
            print("Column 'unit' missing. Adding it...")
            db.execute(text("ALTER TABLE gl_entry ADD COLUMN unit VARCHAR(50)"))
            db.commit()
            print("Column 'unit' added successfully.")
            
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    add_unit_column()
