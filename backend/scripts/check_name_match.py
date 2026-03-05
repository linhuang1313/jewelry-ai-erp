# -*- coding: utf-8 -*-
"""Diagnose product_name matching between location_inventory and product_codes."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
with engine.connect() as conn:
    print("=== location_inventory products WITHOUT matching product_codes ===")
    rows = conn.execute(text(
        "SELECT li.product_name, round(li.weight::numeric, 3) as weight "
        "FROM location_inventory li "
        "WHERE li.weight > 0 "
        "AND NOT EXISTS (SELECT 1 FROM product_codes pc WHERE pc.name = li.product_name) "
        "ORDER BY li.weight DESC LIMIT 30"
    )).fetchall()
    if rows:
        for r in rows:
            print(f"  [{r[0]}]  {r[1]}g")
        print(f"  Total unmatched: {len(rows)}")
    else:
        print("  ALL matched!")

    print("\n=== Sample product_codes (first 15) ===")
    codes = conn.execute(text(
        "SELECT code, name, code_type FROM product_codes ORDER BY code LIMIT 15"
    )).fetchall()
    for c in codes:
        print(f"  {c[0]:12s}  {c[1]:30s}  {c[2]}")

    print(f"\n=== Counts ===")
    li_count = conn.execute(text(
        "SELECT count(*) FROM location_inventory WHERE weight > 0"
    )).scalar()
    pc_count = conn.execute(text("SELECT count(*) FROM product_codes")).scalar()
    pc_names = conn.execute(text("SELECT count(DISTINCT name) FROM product_codes")).scalar()
    print(f"  location_inventory (weight>0): {li_count}")
    print(f"  product_codes total: {pc_count}")
    print(f"  product_codes distinct names: {pc_names}")

    print("\n=== Check specific codes (JPJC, WZJPJC) - repr() ===")
    for code in ["JPJC", "WZJPJC"]:
        row = conn.execute(text(
            "SELECT code, name, code_type, is_unique, is_used "
            "FROM product_codes WHERE code = :c"
        ), {"c": code}).fetchone()
        if row:
            print(f"  code={repr(row[0])}, name={repr(row[1])}, type={repr(row[2])}, is_unique={row[3]}, is_used={row[4]}")
        else:
            print(f"  {code}: NOT FOUND")

    print("\n=== product_codes with dirty code_type (spaces etc) ===")
    dirty = conn.execute(text(
        "SELECT code, code_type, length(code_type), length(trim(code_type)) "
        "FROM product_codes "
        "WHERE code_type != trim(code_type) OR code != trim(code) OR name != trim(name) "
        "LIMIT 20"
    )).fetchall()
    if dirty:
        for r in dirty:
            print(f"  code={repr(r[0])}, code_type={repr(r[1])}, len={r[2]}, trim_len={r[3]}")
    else:
        print("  No dirty data found")

    print("\n=== product_codes with NULL is_unique or is_used ===")
    null_count = conn.execute(text(
        "SELECT count(*) FROM product_codes WHERE is_unique IS NULL OR is_used IS NULL"
    )).scalar()
    print(f"  Count: {null_count}")

    print("\n=== Total predefined codes ===")
    pred_count = conn.execute(text(
        "SELECT count(*) FROM product_codes WHERE code_type = 'predefined'"
    )).scalar()
    pred_trim_count = conn.execute(text(
        "SELECT count(*) FROM product_codes WHERE trim(code_type) = 'predefined'"
    )).scalar()
    print(f"  code_type = 'predefined': {pred_count}")
    print(f"  trim(code_type) = 'predefined': {pred_trim_count}")
    if pred_count != pred_trim_count:
        print(f"  MISMATCH! {pred_trim_count - pred_count} records have spaces in code_type")
