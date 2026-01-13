"""
数据库数据清理脚本
删除孤立数据、无效外键记录
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import sessionmaker
from sqlalchemy import inspect
from app.database import engine
from app.models import (
    InboundOrder, InboundDetail, Inventory, Supplier, Customer,
    SalesOrder, SalesDetail, SettlementOrder, Location, LocationInventory,
    InventoryTransfer, ReturnOrder, GoldMaterialTransaction,
    CustomerGoldDeposit, CustomerGoldDepositTransaction, CustomerTransaction,
    CustomerWithdrawal, CustomerTransfer
)
from app.models.finance import AccountReceivable, PaymentRecord, ReminderRecord, ReconciliationStatement

SessionLocal = sessionmaker(bind=engine)


def get_existing_tables():
    """获取数据库中已存在的表"""
    inspector = inspect(engine)
    return set(inspector.get_table_names())


def cleanup_orphaned_records():
    """删除孤立数据"""
    db = SessionLocal()
    deleted_count = 0
    existing_tables = get_existing_tables()
    
    try:
        # 1. 删除 InboundDetail 的孤立数据
        if 'inbound_details' in existing_tables and 'inbound_orders' in existing_tables:
            orphaned_details = db.query(InboundDetail).filter(
                ~InboundDetail.order_id.in_(db.query(InboundOrder.id))
            ).all()
            for d in orphaned_details:
                db.delete(d)
                deleted_count += 1
            if orphaned_details:
                print(f"  - 删除 {len(orphaned_details)} 条孤立的入库明细（无效 order_id）")
        
        # 2. 删除 SalesDetail 的孤立数据
        if 'sales_details' in existing_tables and 'sales_orders' in existing_tables:
            orphaned_sales_details = db.query(SalesDetail).filter(
                ~SalesDetail.order_id.in_(db.query(SalesOrder.id))
            ).all()
            for d in orphaned_sales_details:
                db.delete(d)
                deleted_count += 1
            if orphaned_sales_details:
                print(f"  - 删除 {len(orphaned_sales_details)} 条孤立的销售明细（无效 order_id）")
        
        # 3. 删除 SettlementOrder 的孤立数据
        if 'settlement_orders' in existing_tables and 'sales_orders' in existing_tables:
            orphaned_settlements = db.query(SettlementOrder).filter(
                ~SettlementOrder.sales_order_id.in_(db.query(SalesOrder.id))
            ).all()
            for s in orphaned_settlements:
                db.delete(s)
                deleted_count += 1
            if orphaned_settlements:
                print(f"  - 删除 {len(orphaned_settlements)} 条孤立的结算单（无效 sales_order_id）")
        
        # 4. 删除 LocationInventory 的孤立数据
        if 'location_inventory' in existing_tables and 'locations' in existing_tables:
            orphaned_location_inventory = db.query(LocationInventory).filter(
                ~LocationInventory.location_id.in_(db.query(Location.id))
            ).all()
            for li in orphaned_location_inventory:
                db.delete(li)
                deleted_count += 1
            if orphaned_location_inventory:
                print(f"  - 删除 {len(orphaned_location_inventory)} 条孤立的分仓库存（无效 location_id）")
        
        # 5. 删除 InventoryTransfer 的孤立数据
        if 'inventory_transfers' in existing_tables and 'locations' in existing_tables:
            orphaned_transfers_from = db.query(InventoryTransfer).filter(
                ~InventoryTransfer.from_location_id.in_(db.query(Location.id))
            ).all()
            for t in orphaned_transfers_from:
                db.delete(t)
                deleted_count += 1
            if orphaned_transfers_from:
                print(f"  - 删除 {len(orphaned_transfers_from)} 条孤立的转移单（无效 from_location_id）")
            
            orphaned_transfers_to = db.query(InventoryTransfer).filter(
                ~InventoryTransfer.to_location_id.in_(db.query(Location.id))
            ).all()
            for t in orphaned_transfers_to:
                db.delete(t)
                deleted_count += 1
            if orphaned_transfers_to:
                print(f"  - 删除 {len(orphaned_transfers_to)} 条孤立的转移单（无效 to_location_id）")
        
        # 6. 删除 ReturnOrder 的孤立数据
        if 'return_orders' in existing_tables:
            if 'locations' in existing_tables:
                orphaned_returns_location = db.query(ReturnOrder).filter(
                    ReturnOrder.from_location_id.isnot(None),
                    ~ReturnOrder.from_location_id.in_(db.query(Location.id))
                ).all()
                for r in orphaned_returns_location:
                    db.delete(r)
                    deleted_count += 1
                if orphaned_returns_location:
                    print(f"  - 删除 {len(orphaned_returns_location)} 条孤立的退货单（无效 from_location_id）")
            
            if 'suppliers' in existing_tables:
                orphaned_returns_supplier = db.query(ReturnOrder).filter(
                    ReturnOrder.supplier_id.isnot(None),
                    ~ReturnOrder.supplier_id.in_(db.query(Supplier.id))
                ).all()
                for r in orphaned_returns_supplier:
                    db.delete(r)
                    deleted_count += 1
                if orphaned_returns_supplier:
                    print(f"  - 删除 {len(orphaned_returns_supplier)} 条孤立的退货单（无效 supplier_id）")
        
        # 7. 删除 GoldMaterialTransaction 的孤立数据
        if 'gold_material_transactions' in existing_tables:
            if 'settlement_orders' in existing_tables:
                orphaned_gold_settlement = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.settlement_order_id.isnot(None),
                    ~GoldMaterialTransaction.settlement_order_id.in_(db.query(SettlementOrder.id))
                ).all()
                for g in orphaned_gold_settlement:
                    db.delete(g)
                    deleted_count += 1
                if orphaned_gold_settlement:
                    print(f"  - 删除 {len(orphaned_gold_settlement)} 条孤立的金料流转（无效 settlement_order_id）")
            
            if 'customers' in existing_tables:
                orphaned_gold_customer = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.customer_id.isnot(None),
                    ~GoldMaterialTransaction.customer_id.in_(db.query(Customer.id))
                ).all()
                for g in orphaned_gold_customer:
                    db.delete(g)
                    deleted_count += 1
                if orphaned_gold_customer:
                    print(f"  - 删除 {len(orphaned_gold_customer)} 条孤立的金料流转（无效 customer_id）")
            
            if 'suppliers' in existing_tables:
                orphaned_gold_supplier = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.supplier_id.isnot(None),
                    ~GoldMaterialTransaction.supplier_id.in_(db.query(Supplier.id))
                ).all()
                for g in orphaned_gold_supplier:
                    db.delete(g)
                    deleted_count += 1
                if orphaned_gold_supplier:
                    print(f"  - 删除 {len(orphaned_gold_supplier)} 条孤立的金料流转（无效 supplier_id）")
        
        # 8. 删除 CustomerGoldDeposit 的孤立数据
        if 'customer_gold_deposits' in existing_tables and 'customers' in existing_tables:
            orphaned_deposits = db.query(CustomerGoldDeposit).filter(
                ~CustomerGoldDeposit.customer_id.in_(db.query(Customer.id))
            ).all()
            for d in orphaned_deposits:
                db.delete(d)
                deleted_count += 1
            if orphaned_deposits:
                print(f"  - 删除 {len(orphaned_deposits)} 条孤立的客户存料（无效 customer_id）")
        
        # 9. 删除 CustomerGoldDepositTransaction 的孤立数据
        if 'customer_gold_deposit_transactions' in existing_tables and 'customers' in existing_tables:
            orphaned_deposit_trans = db.query(CustomerGoldDepositTransaction).filter(
                ~CustomerGoldDepositTransaction.customer_id.in_(db.query(Customer.id))
            ).all()
            for dt in orphaned_deposit_trans:
                db.delete(dt)
                deleted_count += 1
            if orphaned_deposit_trans:
                print(f"  - 删除 {len(orphaned_deposit_trans)} 条孤立的存料交易（无效 customer_id）")
        
        # 10. 删除 CustomerTransaction 的孤立数据
        if 'customer_transactions' in existing_tables and 'customers' in existing_tables:
            orphaned_customer_trans = db.query(CustomerTransaction).filter(
                ~CustomerTransaction.customer_id.in_(db.query(Customer.id))
            ).all()
            for ct in orphaned_customer_trans:
                db.delete(ct)
                deleted_count += 1
            if orphaned_customer_trans:
                print(f"  - 删除 {len(orphaned_customer_trans)} 条孤立的客户交易（无效 customer_id）")
        
        # 11. 删除 CustomerWithdrawal 的孤立数据
        if 'customer_withdrawals' in existing_tables and 'customers' in existing_tables:
            orphaned_withdrawals = db.query(CustomerWithdrawal).filter(
                ~CustomerWithdrawal.customer_id.in_(db.query(Customer.id))
            ).all()
            for w in orphaned_withdrawals:
                db.delete(w)
                deleted_count += 1
            if orphaned_withdrawals:
                print(f"  - 删除 {len(orphaned_withdrawals)} 条孤立的取料单（无效 customer_id）")
        
        # 12. 删除 CustomerTransfer 的孤立数据
        if 'customer_transfers' in existing_tables and 'customers' in existing_tables:
            orphaned_transfers_from_cust = db.query(CustomerTransfer).filter(
                ~CustomerTransfer.from_customer_id.in_(db.query(Customer.id))
            ).all()
            for t in orphaned_transfers_from_cust:
                db.delete(t)
                deleted_count += 1
            if orphaned_transfers_from_cust:
                print(f"  - 删除 {len(orphaned_transfers_from_cust)} 条孤立的转料单（无效 from_customer_id）")
            
            orphaned_transfers_to_cust = db.query(CustomerTransfer).filter(
                ~CustomerTransfer.to_customer_id.in_(db.query(Customer.id))
            ).all()
            for t in orphaned_transfers_to_cust:
                db.delete(t)
                deleted_count += 1
            if orphaned_transfers_to_cust:
                print(f"  - 删除 {len(orphaned_transfers_to_cust)} 条孤立的转料单（无效 to_customer_id）")
        
        # 13. 删除财务相关孤立数据
        if 'account_receivables' in existing_tables:
            if 'sales_orders' in existing_tables:
                orphaned_ar_sales = db.query(AccountReceivable).filter(
                    ~AccountReceivable.sales_order_id.in_(db.query(SalesOrder.id))
                ).all()
                for ar in orphaned_ar_sales:
                    db.delete(ar)
                    deleted_count += 1
                if orphaned_ar_sales:
                    print(f"  - 删除 {len(orphaned_ar_sales)} 条孤立的应收账款（无效 sales_order_id）")
            
            if 'customers' in existing_tables:
                orphaned_ar_customer = db.query(AccountReceivable).filter(
                    ~AccountReceivable.customer_id.in_(db.query(Customer.id))
                ).all()
                for ar in orphaned_ar_customer:
                    db.delete(ar)
                    deleted_count += 1
                if orphaned_ar_customer:
                    print(f"  - 删除 {len(orphaned_ar_customer)} 条孤立的应收账款（无效 customer_id）")
        
        if 'payment_records' in existing_tables:
            if 'account_receivables' in existing_tables:
                orphaned_payments_ar = db.query(PaymentRecord).filter(
                    ~PaymentRecord.account_receivable_id.in_(db.query(AccountReceivable.id))
                ).all()
                for p in orphaned_payments_ar:
                    db.delete(p)
                    deleted_count += 1
                if orphaned_payments_ar:
                    print(f"  - 删除 {len(orphaned_payments_ar)} 条孤立的收款记录（无效 account_receivable_id）")
            
            if 'customers' in existing_tables:
                orphaned_payments_customer = db.query(PaymentRecord).filter(
                    ~PaymentRecord.customer_id.in_(db.query(Customer.id))
                ).all()
                for p in orphaned_payments_customer:
                    db.delete(p)
                    deleted_count += 1
                if orphaned_payments_customer:
                    print(f"  - 删除 {len(orphaned_payments_customer)} 条孤立的收款记录（无效 customer_id）")
        
        if 'reminder_records' in existing_tables:
            if 'account_receivables' in existing_tables:
                orphaned_reminders_ar = db.query(ReminderRecord).filter(
                    ~ReminderRecord.account_receivable_id.in_(db.query(AccountReceivable.id))
                ).all()
                for r in orphaned_reminders_ar:
                    db.delete(r)
                    deleted_count += 1
                if orphaned_reminders_ar:
                    print(f"  - 删除 {len(orphaned_reminders_ar)} 条孤立的催款记录（无效 account_receivable_id）")
            
            if 'customers' in existing_tables:
                orphaned_reminders_customer = db.query(ReminderRecord).filter(
                    ~ReminderRecord.customer_id.in_(db.query(Customer.id))
                ).all()
                for r in orphaned_reminders_customer:
                    db.delete(r)
                    deleted_count += 1
                if orphaned_reminders_customer:
                    print(f"  - 删除 {len(orphaned_reminders_customer)} 条孤立的催款记录（无效 customer_id）")
        
        if 'reconciliation_statements' in existing_tables and 'customers' in existing_tables:
            orphaned_recon_customer = db.query(ReconciliationStatement).filter(
                ~ReconciliationStatement.customer_id.in_(db.query(Customer.id))
            ).all()
            for r in orphaned_recon_customer:
                db.delete(r)
                deleted_count += 1
            if orphaned_recon_customer:
                print(f"  - 删除 {len(orphaned_recon_customer)} 条孤立的对账单（无效 customer_id）")
        
        db.commit()
        
    except Exception as e:
        db.rollback()
        print(f"清理孤立数据时出错：{e}")
        raise
    finally:
        db.close()
    
    return deleted_count


def cleanup_invalid_data():
    """处理无效数据（负数等）- 仅报告，不删除"""
    db = SessionLocal()
    fixed_count = 0
    existing_tables = get_existing_tables()
    
    try:
        # 检查并报告负数重量（不删除，只报告）
        if 'inventory' in existing_tables:
            negative_weight_inventory = db.query(Inventory).filter(
                Inventory.total_weight < 0
            ).all()
            if negative_weight_inventory:
                print(f"  [WARN] 发现 {len(negative_weight_inventory)} 条负数库存（需手动处理）：")
                for inv in negative_weight_inventory[:5]:
                    print(f"      - {inv.product_name}: {inv.total_weight}g")
        
        if 'location_inventory' in existing_tables:
            negative_weight_location = db.query(LocationInventory).filter(
                LocationInventory.weight < 0
            ).all()
            if negative_weight_location:
                print(f"  [WARN] 发现 {len(negative_weight_location)} 条负数分仓库存（需手动处理）：")
                for li in negative_weight_location[:5]:
                    print(f"      - 位置ID {li.location_id}, 商品: {li.product_name}: {li.weight}g")
        
    finally:
        db.close()
    
    return fixed_count


def main():
    """主函数"""
    print("=" * 80)
    print("数据库清理工具")
    print("=" * 80)
    print()
    
    existing_tables = get_existing_tables()
    print(f"发现 {len(existing_tables)} 个表")
    print()
    
    print("正在清理孤立数据...")
    orphaned_count = cleanup_orphaned_records()
    if orphaned_count == 0:
        print("  没有发现孤立数据")
    else:
        print(f"  共删除 {orphaned_count} 条孤立数据")
    
    print()
    print("正在检查无效数据...")
    invalid_count = cleanup_invalid_data()
    
    print()
    print("=" * 80)
    print(f"清理完成！共删除 {orphaned_count} 条记录")
    print("=" * 80)


if __name__ == "__main__":
    main()
