"""
Migration 001: Float → Numeric + LocationInventory UniqueConstraint

Converts all FLOAT/DOUBLE PRECISION columns to NUMERIC with appropriate
precision for financial accuracy in the jewelry ERP system.

Usage:
    cd backend
    python -m migrations.001_float_to_numeric

This script is idempotent — safe to run multiple times.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text, inspect

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is required")
    sys.exit(1)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

COLUMN_MIGRATIONS = [
    # (table, column, new_type)
    # ─── inbound_details ───
    ("inbound_details", "weight", "NUMERIC(12,4)"),
    ("inbound_details", "labor_cost", "NUMERIC(10,2)"),
    ("inbound_details", "piece_labor_cost", "NUMERIC(10,2)"),
    ("inbound_details", "total_cost", "NUMERIC(14,2)"),
    ("inbound_details", "main_stone_weight", "NUMERIC(10,4)"),
    ("inbound_details", "main_stone_price", "NUMERIC(14,2)"),
    ("inbound_details", "main_stone_amount", "NUMERIC(14,2)"),
    ("inbound_details", "sub_stone_weight", "NUMERIC(10,4)"),
    ("inbound_details", "sub_stone_price", "NUMERIC(14,2)"),
    ("inbound_details", "sub_stone_amount", "NUMERIC(14,2)"),
    ("inbound_details", "stone_setting_fee", "NUMERIC(14,2)"),
    ("inbound_details", "total_amount", "NUMERIC(14,2)"),
    ("inbound_details", "pearl_weight", "NUMERIC(12,4)"),
    ("inbound_details", "bearing_weight", "NUMERIC(12,4)"),
    ("inbound_details", "sale_labor_cost", "NUMERIC(10,2)"),
    ("inbound_details", "sale_piece_labor_cost", "NUMERIC(10,2)"),

    # ─── inventory ───
    ("inventory", "total_weight", "NUMERIC(12,4)"),

    # ─── suppliers ───
    ("suppliers", "total_supply_amount", "NUMERIC(14,2)"),
    ("suppliers", "total_supply_weight", "NUMERIC(12,4)"),

    # ─── customers ───
    ("customers", "total_purchase_amount", "NUMERIC(14,2)"),
    ("customers", "total_purchase_weight", "NUMERIC(12,4)"),

    # ─── sales_orders ───
    ("sales_orders", "total_labor_cost", "NUMERIC(14,2)"),
    ("sales_orders", "total_weight", "NUMERIC(12,4)"),

    # ─── sales_details ───
    ("sales_details", "weight", "NUMERIC(12,4)"),
    ("sales_details", "labor_cost", "NUMERIC(10,2)"),
    ("sales_details", "piece_labor_cost", "NUMERIC(10,2)"),
    ("sales_details", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── settlement_orders ───
    ("settlement_orders", "gold_price", "NUMERIC(14,2)"),
    ("settlement_orders", "physical_gold_weight", "NUMERIC(12,4)"),
    ("settlement_orders", "gold_payment_weight", "NUMERIC(12,4)"),
    ("settlement_orders", "cash_payment_weight", "NUMERIC(12,4)"),
    ("settlement_orders", "total_weight", "NUMERIC(12,4)"),
    ("settlement_orders", "material_amount", "NUMERIC(14,2)"),
    ("settlement_orders", "labor_amount", "NUMERIC(14,2)"),
    ("settlement_orders", "total_amount", "NUMERIC(14,2)"),
    ("settlement_orders", "previous_cash_debt", "NUMERIC(14,2)"),
    ("settlement_orders", "previous_gold_debt", "NUMERIC(14,2)"),
    ("settlement_orders", "gold_deposit_balance", "NUMERIC(14,2)"),
    ("settlement_orders", "cash_deposit_balance", "NUMERIC(14,2)"),
    ("settlement_orders", "payment_difference", "NUMERIC(14,2)"),

    # ─── location_inventory ───
    ("location_inventory", "weight", "NUMERIC(12,4)"),

    # ─── inventory_transfers ───
    ("inventory_transfers", "weight", "NUMERIC(12,4)"),
    ("inventory_transfers", "actual_weight", "NUMERIC(12,4)"),
    ("inventory_transfers", "weight_diff", "NUMERIC(12,4)"),

    # ─── inventory_transfer_items ───
    ("inventory_transfer_items", "weight", "NUMERIC(12,4)"),
    ("inventory_transfer_items", "actual_weight", "NUMERIC(12,4)"),
    ("inventory_transfer_items", "weight_diff", "NUMERIC(12,4)"),

    # ─── inventory_alert_settings ───
    ("inventory_alert_settings", "min_weight", "NUMERIC(12,4)"),

    # ─── return_orders ───
    ("return_orders", "return_weight", "NUMERIC(12,4)"),
    ("return_orders", "total_weight", "NUMERIC(12,4)"),
    ("return_orders", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── return_order_details ───
    ("return_order_details", "return_weight", "NUMERIC(12,4)"),
    ("return_order_details", "labor_cost", "NUMERIC(10,2)"),
    ("return_order_details", "piece_labor_cost", "NUMERIC(10,2)"),
    ("return_order_details", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── gold_material_transactions ───
    ("gold_material_transactions", "gold_weight", "NUMERIC(12,4)"),

    # ─── customer_gold_deposits ───
    ("customer_gold_deposits", "current_balance", "NUMERIC(14,2)"),
    ("customer_gold_deposits", "total_deposited", "NUMERIC(14,2)"),
    ("customer_gold_deposits", "total_used", "NUMERIC(14,2)"),

    # ─── customer_gold_deposit_transactions ───
    ("customer_gold_deposit_transactions", "amount", "NUMERIC(14,2)"),
    ("customer_gold_deposit_transactions", "balance_before", "NUMERIC(14,2)"),
    ("customer_gold_deposit_transactions", "balance_after", "NUMERIC(14,2)"),

    # ─── customer_transactions ───
    ("customer_transactions", "amount", "NUMERIC(14,2)"),
    ("customer_transactions", "gold_weight", "NUMERIC(12,4)"),
    ("customer_transactions", "gold_due_before", "NUMERIC(14,2)"),
    ("customer_transactions", "gold_due_after", "NUMERIC(14,2)"),

    # ─── customer_withdrawals ───
    ("customer_withdrawals", "gold_weight", "NUMERIC(12,4)"),

    # ─── customer_transfers ───
    ("customer_transfers", "gold_weight", "NUMERIC(12,4)"),

    # ─── supplier_gold_accounts ───
    ("supplier_gold_accounts", "current_balance", "NUMERIC(14,2)"),
    ("supplier_gold_accounts", "total_received", "NUMERIC(14,2)"),
    ("supplier_gold_accounts", "total_paid", "NUMERIC(14,2)"),

    # ─── supplier_gold_transactions ───
    ("supplier_gold_transactions", "gold_weight", "NUMERIC(12,4)"),
    ("supplier_gold_transactions", "balance_before", "NUMERIC(14,2)"),
    ("supplier_gold_transactions", "balance_after", "NUMERIC(14,2)"),

    # ─── loan_orders ───
    ("loan_orders", "weight", "NUMERIC(12,4)"),
    ("loan_orders", "labor_cost", "NUMERIC(10,2)"),
    ("loan_orders", "total_weight", "NUMERIC(12,4)"),
    ("loan_orders", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── loan_details ───
    ("loan_details", "weight", "NUMERIC(12,4)"),
    ("loan_details", "labor_cost", "NUMERIC(10,2)"),
    ("loan_details", "piece_labor_cost", "NUMERIC(10,2)"),
    ("loan_details", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── loan_returns ───
    ("loan_returns", "total_weight", "NUMERIC(12,4)"),
    ("loan_returns", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── loan_return_details ───
    ("loan_return_details", "weight", "NUMERIC(12,4)"),
    ("loan_return_details", "labor_cost", "NUMERIC(10,2)"),
    ("loan_return_details", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── sales_return_orders ───
    ("sales_return_orders", "total_weight", "NUMERIC(12,4)"),
    ("sales_return_orders", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── sales_return_details ───
    ("sales_return_details", "weight", "NUMERIC(12,4)"),
    ("sales_return_details", "labor_cost", "NUMERIC(10,2)"),
    ("sales_return_details", "piece_labor_cost", "NUMERIC(10,2)"),
    ("sales_return_details", "total_labor_cost", "NUMERIC(14,2)"),

    # ─── sales_return_settlements ───
    ("sales_return_settlements", "gold_price", "NUMERIC(14,2)"),
    ("sales_return_settlements", "physical_gold_weight", "NUMERIC(12,4)"),
    ("sales_return_settlements", "gold_payment_weight", "NUMERIC(12,4)"),
    ("sales_return_settlements", "cash_payment_weight", "NUMERIC(12,4)"),
    ("sales_return_settlements", "total_weight", "NUMERIC(12,4)"),
    ("sales_return_settlements", "material_amount", "NUMERIC(14,2)"),
    ("sales_return_settlements", "labor_amount", "NUMERIC(14,2)"),
    ("sales_return_settlements", "total_amount", "NUMERIC(14,2)"),

    # ─── account_receivables (finance.py) ───
    ("account_receivables", "total_amount", "NUMERIC(14,2)"),
    ("account_receivables", "received_amount", "NUMERIC(14,2)"),
    ("account_receivables", "unpaid_amount", "NUMERIC(14,2)"),

    # ─── payment_records (finance.py) ───
    ("payment_records", "amount", "NUMERIC(14,2)"),
    ("payment_records", "gold_amount", "NUMERIC(14,2)"),
    ("payment_records", "labor_amount", "NUMERIC(14,2)"),
    ("payment_records", "handling_fee", "NUMERIC(10,2)"),
    ("payment_records", "exchange_rate", "NUMERIC(10,6)"),

    # ─── reminder_records (finance.py) ───
    ("reminder_records", "promised_amount", "NUMERIC(14,2)"),

    # ─── gold_receipts (finance.py) ───
    ("gold_receipts", "gold_weight", "NUMERIC(12,4)"),

    # ─── reconciliation_statements (finance.py) ───
    ("reconciliation_statements", "opening_balance", "NUMERIC(14,2)"),
    ("reconciliation_statements", "period_sales_amount", "NUMERIC(14,2)"),
    ("reconciliation_statements", "period_payment_amount", "NUMERIC(14,2)"),
    ("reconciliation_statements", "closing_balance", "NUMERIC(14,2)"),

    # ─── bank_accounts (finance.py) ───
    ("bank_accounts", "initial_balance", "NUMERIC(14,2)"),
    ("bank_accounts", "current_balance", "NUMERIC(14,2)"),

    # ─── account_payables (finance.py) ───
    ("account_payables", "total_amount", "NUMERIC(14,2)"),
    ("account_payables", "paid_amount", "NUMERIC(14,2)"),
    ("account_payables", "unpaid_amount", "NUMERIC(14,2)"),

    # ─── supplier_payments (finance.py) ───
    ("supplier_payments", "amount", "NUMERIC(14,2)"),

    # ─── cash_flows (finance.py) ───
    ("cash_flows", "amount", "NUMERIC(14,2)"),
    ("cash_flows", "balance_before", "NUMERIC(14,2)"),
    ("cash_flows", "balance_after", "NUMERIC(14,2)"),

    # ─── expenses (finance.py) ───
    ("expenses", "amount", "NUMERIC(14,2)"),

    # ─── customer_gold_transfers (finance.py) ───
    ("customer_gold_transfers", "gold_weight", "NUMERIC(12,4)"),

    # ─── deposit_settlements (finance.py) ───
    ("deposit_settlements", "gold_weight", "NUMERIC(12,4)"),
    ("deposit_settlements", "gold_price", "NUMERIC(14,2)"),
    ("deposit_settlements", "total_amount", "NUMERIC(14,2)"),

    # ─── behavior_decision_logs ───
    ("behavior_decision_logs", "gold_price", "NUMERIC(14,2)"),
    ("behavior_decision_logs", "confidence_score", "NUMERIC(5,4)"),
]


def run_migration():
    engine = create_engine(DATABASE_URL)
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())

    converted = 0
    skipped = 0
    errors = 0

    with engine.begin() as conn:
        for table, column, new_type in COLUMN_MIGRATIONS:
            if table not in existing_tables:
                print(f"  SKIP  {table}.{column} — table does not exist")
                skipped += 1
                continue

            columns = {c["name"]: c for c in insp.get_columns(table)}
            if column not in columns:
                print(f"  SKIP  {table}.{column} — column does not exist")
                skipped += 1
                continue

            col_type = str(columns[column]["type"]).upper()
            if "NUMERIC" in col_type or "DECIMAL" in col_type:
                skipped += 1
                continue

            try:
                sql = f'ALTER TABLE {table} ALTER COLUMN "{column}" TYPE {new_type} USING "{column}"::{new_type}'
                conn.execute(text(sql))
                print(f"  OK    {table}.{column}: {col_type} → {new_type}")
                converted += 1
            except Exception as e:
                print(f"  ERROR {table}.{column}: {e}")
                errors += 1

        # UniqueConstraint for location_inventory
        if "location_inventory" in existing_tables:
            try:
                existing_constraints = insp.get_unique_constraints("location_inventory")
                constraint_names = [c["name"] for c in existing_constraints]
                if "uq_location_product" not in constraint_names:
                    conn.execute(text(
                        "DELETE FROM location_inventory a USING location_inventory b "
                        "WHERE a.id < b.id "
                        "AND a.product_name = b.product_name "
                        "AND a.location_id = b.location_id"
                    ))
                    conn.execute(text(
                        "ALTER TABLE location_inventory "
                        "ADD CONSTRAINT uq_location_product UNIQUE (product_name, location_id)"
                    ))
                    print("  OK    location_inventory: added UniqueConstraint(product_name, location_id)")
                else:
                    print("  SKIP  location_inventory: uq_location_product already exists")
            except Exception as e:
                print(f"  ERROR location_inventory UniqueConstraint: {e}")
                errors += 1

    print(f"\nMigration complete: {converted} converted, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    print("=" * 60)
    print("Migration 001: Float → Numeric + UniqueConstraint")
    print("=" * 60)
    run_migration()
