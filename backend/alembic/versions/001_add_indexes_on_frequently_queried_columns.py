"""Add indexes on frequently queried created_at / due_date columns

Revision ID: 001
Revises: 
Create Date: 2026-02-24
"""
from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_settlement_orders_created_at", "settlement_orders", ["created_at"]),
    ("ix_inventory_transfer_orders_created_at", "inventory_transfer_orders", ["created_at"]),
    ("ix_gold_material_transactions_created_at", "gold_material_transactions", ["created_at"]),
    ("ix_customer_transactions_created_at", "customer_transactions", ["created_at"]),
    ("ix_loan_orders_created_at", "loan_orders", ["created_at"]),
    ("ix_loan_returns_created_at", "loan_returns", ["created_at"]),
    ("ix_sales_return_settlements_created_at", "sales_return_settlements", ["created_at"]),
    ("ix_account_receivables_due_date", "account_receivables", ["due_date"]),
    ("ix_account_payables_due_date", "account_payables", ["due_date"]),
    ("ix_account_payables_create_time", "account_payables", ["create_time"]),
    ("ix_supplier_payments_create_time", "supplier_payments", ["create_time"]),
    ("ix_customer_gold_transfers_create_time", "customer_gold_transfers", ["create_time"]),
    ("ix_deposit_settlements_created_at", "deposit_settlements", ["created_at"]),
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns, if_not_exists=True)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table, if_exists=True)
