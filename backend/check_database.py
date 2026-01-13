"""
数据库数据一致性检查脚本
检查孤立数据、无效外键、数据不一致等问题
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


def check_orphaned_records():
    """检查孤立数据"""
    db = SessionLocal()
    issues = []
    existing_tables = get_existing_tables()
    
    try:
        # 1. 检查 InboundDetail 的孤立数据
        if 'inbound_details' in existing_tables and 'inbound_orders' in existing_tables:
            orphaned_details = db.query(InboundDetail).filter(
                ~InboundDetail.order_id.in_(db.query(InboundOrder.id))
            ).all()
            if orphaned_details:
                issues.append({
                    'type': '孤立数据',
                    'table': 'inbound_details',
                    'field': 'order_id',
                    'count': len(orphaned_details),
                    'ids': [d.id for d in orphaned_details[:10]],
                    'description': '入库明细的 order_id 指向不存在的入库单'
                })
            
            # 检查 supplier_id
            if 'suppliers' in existing_tables:
                orphaned_supplier_details = db.query(InboundDetail).filter(
                    InboundDetail.supplier_id.isnot(None),
                    ~InboundDetail.supplier_id.in_(db.query(Supplier.id))
                ).all()
                if orphaned_supplier_details:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'inbound_details',
                        'field': 'supplier_id',
                        'count': len(orphaned_supplier_details),
                        'ids': [d.id for d in orphaned_supplier_details[:10]],
                        'description': '入库明细的 supplier_id 指向不存在的供应商'
                    })
        
        # 2. 检查 SalesDetail 的孤立数据
        if 'sales_details' in existing_tables and 'sales_orders' in existing_tables:
            orphaned_sales_details = db.query(SalesDetail).filter(
                ~SalesDetail.order_id.in_(db.query(SalesOrder.id))
            ).all()
            if orphaned_sales_details:
                issues.append({
                    'type': '孤立数据',
                    'table': 'sales_details',
                    'field': 'order_id',
                    'count': len(orphaned_sales_details),
                    'ids': [d.id for d in orphaned_sales_details[:10]],
                    'description': '销售明细的 order_id 指向不存在的销售单'
                })
            
            # 检查 inventory_id
            if 'inventory' in existing_tables:
                orphaned_inventory_details = db.query(SalesDetail).filter(
                    SalesDetail.inventory_id.isnot(None),
                    ~SalesDetail.inventory_id.in_(db.query(Inventory.id))
                ).all()
                if orphaned_inventory_details:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'sales_details',
                        'field': 'inventory_id',
                        'count': len(orphaned_inventory_details),
                        'ids': [d.id for d in orphaned_inventory_details[:10]],
                        'description': '销售明细的 inventory_id 指向不存在的库存'
                    })
        
        # 3. 检查 SettlementOrder
        if 'settlement_orders' in existing_tables and 'sales_orders' in existing_tables:
            orphaned_settlements = db.query(SettlementOrder).filter(
                ~SettlementOrder.sales_order_id.in_(db.query(SalesOrder.id))
            ).all()
            if orphaned_settlements:
                issues.append({
                    'type': '孤立数据',
                    'table': 'settlement_orders',
                    'field': 'sales_order_id',
                    'count': len(orphaned_settlements),
                    'ids': [s.id for s in orphaned_settlements[:10]],
                    'description': '结算单的 sales_order_id 指向不存在的销售单'
                })
        
        # 4. 检查 LocationInventory
        if 'location_inventory' in existing_tables and 'locations' in existing_tables:
            orphaned_location_inventory = db.query(LocationInventory).filter(
                ~LocationInventory.location_id.in_(db.query(Location.id))
            ).all()
            if orphaned_location_inventory:
                issues.append({
                    'type': '孤立数据',
                    'table': 'location_inventory',
                    'field': 'location_id',
                    'count': len(orphaned_location_inventory),
                    'ids': [li.id for li in orphaned_location_inventory[:10]],
                    'description': '分仓库存的 location_id 指向不存在的位置'
                })
        
        # 5. 检查 InventoryTransfer
        if 'inventory_transfers' in existing_tables and 'locations' in existing_tables:
            orphaned_transfers_from = db.query(InventoryTransfer).filter(
                ~InventoryTransfer.from_location_id.in_(db.query(Location.id))
            ).all()
            if orphaned_transfers_from:
                issues.append({
                    'type': '孤立数据',
                    'table': 'inventory_transfers',
                    'field': 'from_location_id',
                    'count': len(orphaned_transfers_from),
                    'ids': [t.id for t in orphaned_transfers_from[:10]],
                    'description': '转移单的 from_location_id 指向不存在的位置'
                })
            
            orphaned_transfers_to = db.query(InventoryTransfer).filter(
                ~InventoryTransfer.to_location_id.in_(db.query(Location.id))
            ).all()
            if orphaned_transfers_to:
                issues.append({
                    'type': '孤立数据',
                    'table': 'inventory_transfers',
                    'field': 'to_location_id',
                    'count': len(orphaned_transfers_to),
                    'ids': [t.id for t in orphaned_transfers_to[:10]],
                    'description': '转移单的 to_location_id 指向不存在的位置'
                })
        
        # 6. 检查 ReturnOrder
        if 'return_orders' in existing_tables:
            if 'locations' in existing_tables:
                orphaned_returns_location = db.query(ReturnOrder).filter(
                    ReturnOrder.from_location_id.isnot(None),
                    ~ReturnOrder.from_location_id.in_(db.query(Location.id))
                ).all()
                if orphaned_returns_location:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'return_orders',
                        'field': 'from_location_id',
                        'count': len(orphaned_returns_location),
                        'ids': [r.id for r in orphaned_returns_location[:10]],
                        'description': '退货单的 from_location_id 指向不存在的位置'
                    })
            
            if 'suppliers' in existing_tables:
                orphaned_returns_supplier = db.query(ReturnOrder).filter(
                    ReturnOrder.supplier_id.isnot(None),
                    ~ReturnOrder.supplier_id.in_(db.query(Supplier.id))
                ).all()
                if orphaned_returns_supplier:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'return_orders',
                        'field': 'supplier_id',
                        'count': len(orphaned_returns_supplier),
                        'ids': [r.id for r in orphaned_returns_supplier[:10]],
                        'description': '退货单的 supplier_id 指向不存在的供应商'
                    })
            
            if 'inbound_orders' in existing_tables:
                orphaned_returns_inbound = db.query(ReturnOrder).filter(
                    ReturnOrder.inbound_order_id.isnot(None),
                    ~ReturnOrder.inbound_order_id.in_(db.query(InboundOrder.id))
                ).all()
                if orphaned_returns_inbound:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'return_orders',
                        'field': 'inbound_order_id',
                        'count': len(orphaned_returns_inbound),
                        'ids': [r.id for r in orphaned_returns_inbound[:10]],
                        'description': '退货单的 inbound_order_id 指向不存在的入库单'
                    })
        
        # 7. 检查 GoldMaterialTransaction
        if 'gold_material_transactions' in existing_tables:
            if 'settlement_orders' in existing_tables:
                orphaned_gold_settlement = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.settlement_order_id.isnot(None),
                    ~GoldMaterialTransaction.settlement_order_id.in_(db.query(SettlementOrder.id))
                ).all()
                if orphaned_gold_settlement:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'gold_material_transactions',
                        'field': 'settlement_order_id',
                        'count': len(orphaned_gold_settlement),
                        'ids': [g.id for g in orphaned_gold_settlement[:10]],
                        'description': '金料流转的 settlement_order_id 指向不存在的结算单'
                    })
            
            if 'inbound_orders' in existing_tables:
                orphaned_gold_inbound = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.inbound_order_id.isnot(None),
                    ~GoldMaterialTransaction.inbound_order_id.in_(db.query(InboundOrder.id))
                ).all()
                if orphaned_gold_inbound:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'gold_material_transactions',
                        'field': 'inbound_order_id',
                        'count': len(orphaned_gold_inbound),
                        'ids': [g.id for g in orphaned_gold_inbound[:10]],
                        'description': '金料流转的 inbound_order_id 指向不存在的入库单'
                    })
            
            if 'customers' in existing_tables:
                orphaned_gold_customer = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.customer_id.isnot(None),
                    ~GoldMaterialTransaction.customer_id.in_(db.query(Customer.id))
                ).all()
                if orphaned_gold_customer:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'gold_material_transactions',
                        'field': 'customer_id',
                        'count': len(orphaned_gold_customer),
                        'ids': [g.id for g in orphaned_gold_customer[:10]],
                        'description': '金料流转的 customer_id 指向不存在的客户'
                    })
            
            if 'suppliers' in existing_tables:
                orphaned_gold_supplier = db.query(GoldMaterialTransaction).filter(
                    GoldMaterialTransaction.supplier_id.isnot(None),
                    ~GoldMaterialTransaction.supplier_id.in_(db.query(Supplier.id))
                ).all()
                if orphaned_gold_supplier:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'gold_material_transactions',
                        'field': 'supplier_id',
                        'count': len(orphaned_gold_supplier),
                        'ids': [g.id for g in orphaned_gold_supplier[:10]],
                        'description': '金料流转的 supplier_id 指向不存在的供应商'
                    })
        
        # 8. 检查 CustomerGoldDeposit
        if 'customer_gold_deposits' in existing_tables and 'customers' in existing_tables:
            orphaned_deposits = db.query(CustomerGoldDeposit).filter(
                ~CustomerGoldDeposit.customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_deposits:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_gold_deposits',
                    'field': 'customer_id',
                    'count': len(orphaned_deposits),
                    'ids': [d.id for d in orphaned_deposits[:10]],
                    'description': '客户存料的 customer_id 指向不存在的客户'
                })
        
        # 9. 检查 CustomerGoldDepositTransaction
        if 'customer_gold_deposit_transactions' in existing_tables and 'customers' in existing_tables:
            orphaned_deposit_trans = db.query(CustomerGoldDepositTransaction).filter(
                ~CustomerGoldDepositTransaction.customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_deposit_trans:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_gold_deposit_transactions',
                    'field': 'customer_id',
                    'count': len(orphaned_deposit_trans),
                    'ids': [dt.id for dt in orphaned_deposit_trans[:10]],
                    'description': '存料交易的 customer_id 指向不存在的客户'
                })
        
        # 10. 检查 CustomerTransaction
        if 'customer_transactions' in existing_tables and 'customers' in existing_tables:
            orphaned_customer_trans = db.query(CustomerTransaction).filter(
                ~CustomerTransaction.customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_customer_trans:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_transactions',
                    'field': 'customer_id',
                    'count': len(orphaned_customer_trans),
                    'ids': [ct.id for ct in orphaned_customer_trans[:10]],
                    'description': '客户交易的 customer_id 指向不存在的客户'
                })
        
        # 11. 检查 CustomerWithdrawal
        if 'customer_withdrawals' in existing_tables and 'customers' in existing_tables:
            orphaned_withdrawals = db.query(CustomerWithdrawal).filter(
                ~CustomerWithdrawal.customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_withdrawals:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_withdrawals',
                    'field': 'customer_id',
                    'count': len(orphaned_withdrawals),
                    'ids': [w.id for w in orphaned_withdrawals[:10]],
                    'description': '取料单的 customer_id 指向不存在的客户'
                })
        
        # 12. 检查 CustomerTransfer
        if 'customer_transfers' in existing_tables and 'customers' in existing_tables:
            orphaned_transfers_from_cust = db.query(CustomerTransfer).filter(
                ~CustomerTransfer.from_customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_transfers_from_cust:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_transfers',
                    'field': 'from_customer_id',
                    'count': len(orphaned_transfers_from_cust),
                    'ids': [t.id for t in orphaned_transfers_from_cust[:10]],
                    'description': '转料单的 from_customer_id 指向不存在的客户'
                })
            
            orphaned_transfers_to_cust = db.query(CustomerTransfer).filter(
                ~CustomerTransfer.to_customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_transfers_to_cust:
                issues.append({
                    'type': '孤立数据',
                    'table': 'customer_transfers',
                    'field': 'to_customer_id',
                    'count': len(orphaned_transfers_to_cust),
                    'ids': [t.id for t in orphaned_transfers_to_cust[:10]],
                    'description': '转料单的 to_customer_id 指向不存在的客户'
                })
        
        # 13. 检查财务相关
        if 'account_receivables' in existing_tables:
            if 'sales_orders' in existing_tables:
                orphaned_ar_sales = db.query(AccountReceivable).filter(
                    ~AccountReceivable.sales_order_id.in_(db.query(SalesOrder.id))
                ).all()
                if orphaned_ar_sales:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'account_receivables',
                        'field': 'sales_order_id',
                        'count': len(orphaned_ar_sales),
                        'ids': [ar.id for ar in orphaned_ar_sales[:10]],
                        'description': '应收账款的 sales_order_id 指向不存在的销售单'
                    })
            
            if 'customers' in existing_tables:
                orphaned_ar_customer = db.query(AccountReceivable).filter(
                    ~AccountReceivable.customer_id.in_(db.query(Customer.id))
                ).all()
                if orphaned_ar_customer:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'account_receivables',
                        'field': 'customer_id',
                        'count': len(orphaned_ar_customer),
                        'ids': [ar.id for ar in orphaned_ar_customer[:10]],
                        'description': '应收账款的 customer_id 指向不存在的客户'
                    })
        
        if 'payment_records' in existing_tables:
            if 'account_receivables' in existing_tables:
                orphaned_payments_ar = db.query(PaymentRecord).filter(
                    ~PaymentRecord.account_receivable_id.in_(db.query(AccountReceivable.id))
                ).all()
                if orphaned_payments_ar:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'payment_records',
                        'field': 'account_receivable_id',
                        'count': len(orphaned_payments_ar),
                        'ids': [p.id for p in orphaned_payments_ar[:10]],
                        'description': '收款记录的 account_receivable_id 指向不存在的应收账款'
                    })
            
            if 'customers' in existing_tables:
                orphaned_payments_customer = db.query(PaymentRecord).filter(
                    ~PaymentRecord.customer_id.in_(db.query(Customer.id))
                ).all()
                if orphaned_payments_customer:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'payment_records',
                        'field': 'customer_id',
                        'count': len(orphaned_payments_customer),
                        'ids': [p.id for p in orphaned_payments_customer[:10]],
                        'description': '收款记录的 customer_id 指向不存在的客户'
                    })
        
        if 'reminder_records' in existing_tables:
            if 'account_receivables' in existing_tables:
                orphaned_reminders_ar = db.query(ReminderRecord).filter(
                    ~ReminderRecord.account_receivable_id.in_(db.query(AccountReceivable.id))
                ).all()
                if orphaned_reminders_ar:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'reminder_records',
                        'field': 'account_receivable_id',
                        'count': len(orphaned_reminders_ar),
                        'ids': [r.id for r in orphaned_reminders_ar[:10]],
                        'description': '催款记录的 account_receivable_id 指向不存在的应收账款'
                    })
            
            if 'customers' in existing_tables:
                orphaned_reminders_customer = db.query(ReminderRecord).filter(
                    ~ReminderRecord.customer_id.in_(db.query(Customer.id))
                ).all()
                if orphaned_reminders_customer:
                    issues.append({
                        'type': '孤立数据',
                        'table': 'reminder_records',
                        'field': 'customer_id',
                        'count': len(orphaned_reminders_customer),
                        'ids': [r.id for r in orphaned_reminders_customer[:10]],
                        'description': '催款记录的 customer_id 指向不存在的客户'
                    })
        
        if 'reconciliation_statements' in existing_tables and 'customers' in existing_tables:
            orphaned_recon_customer = db.query(ReconciliationStatement).filter(
                ~ReconciliationStatement.customer_id.in_(db.query(Customer.id))
            ).all()
            if orphaned_recon_customer:
                issues.append({
                    'type': '孤立数据',
                    'table': 'reconciliation_statements',
                    'field': 'customer_id',
                    'count': len(orphaned_recon_customer),
                    'ids': [r.id for r in orphaned_recon_customer[:10]],
                    'description': '对账单的 customer_id 指向不存在的客户'
                })
        
    finally:
        db.close()
    
    return issues


def check_invalid_data():
    """检查无效数据（负数、空值等）"""
    db = SessionLocal()
    issues = []
    existing_tables = get_existing_tables()
    
    try:
        # 检查负数重量
        if 'inbound_details' in existing_tables:
            negative_weight_details = db.query(InboundDetail).filter(
                InboundDetail.weight < 0
            ).all()
            if negative_weight_details:
                issues.append({
                    'type': '无效数据',
                    'table': 'inbound_details',
                    'field': 'weight',
                    'count': len(negative_weight_details),
                    'ids': [d.id for d in negative_weight_details[:10]],
                    'description': '入库明细的重量为负数'
                })
        
        if 'sales_details' in existing_tables:
            negative_weight_sales = db.query(SalesDetail).filter(
                SalesDetail.weight < 0
            ).all()
            if negative_weight_sales:
                issues.append({
                    'type': '无效数据',
                    'table': 'sales_details',
                    'field': 'weight',
                    'count': len(negative_weight_sales),
                    'ids': [d.id for d in negative_weight_sales[:10]],
                    'description': '销售明细的重量为负数'
                })
        
        if 'inventory' in existing_tables:
            negative_weight_inventory = db.query(Inventory).filter(
                Inventory.total_weight < 0
            ).all()
            if negative_weight_inventory:
                issues.append({
                    'type': '无效数据',
                    'table': 'inventory',
                    'field': 'total_weight',
                    'count': len(negative_weight_inventory),
                    'ids': [i.id for i in negative_weight_inventory[:10]],
                    'description': '库存重量为负数'
                })
        
        if 'location_inventory' in existing_tables:
            negative_weight_location = db.query(LocationInventory).filter(
                LocationInventory.weight < 0
            ).all()
            if negative_weight_location:
                issues.append({
                    'type': '无效数据',
                    'table': 'location_inventory',
                    'field': 'weight',
                    'count': len(negative_weight_location),
                    'ids': [li.id for li in negative_weight_location[:10]],
                    'description': '分仓库存重量为负数'
                })
        
        # 检查负数金额
        if 'inbound_details' in existing_tables:
            negative_cost_details = db.query(InboundDetail).filter(
                InboundDetail.total_cost < 0
            ).all()
            if negative_cost_details:
                issues.append({
                    'type': '无效数据',
                    'table': 'inbound_details',
                    'field': 'total_cost',
                    'count': len(negative_cost_details),
                    'ids': [d.id for d in negative_cost_details[:10]],
                    'description': '入库明细的总成本为负数'
                })
        
        # 检查负数金料重量
        if 'gold_material_transactions' in existing_tables:
            negative_gold_weight = db.query(GoldMaterialTransaction).filter(
                GoldMaterialTransaction.gold_weight < 0
            ).all()
            if negative_gold_weight:
                issues.append({
                    'type': '无效数据',
                    'table': 'gold_material_transactions',
                    'field': 'gold_weight',
                    'count': len(negative_gold_weight),
                    'ids': [g.id for g in negative_gold_weight[:10]],
                    'description': '金料流转重量为负数'
                })
        
    finally:
        db.close()
    
    return issues


def print_report(orphaned_issues, invalid_issues):
    """打印检查报告"""
    print("=" * 80)
    print("数据库一致性检查报告")
    print("=" * 80)
    print()
    
    total_issues = len(orphaned_issues) + len(invalid_issues)
    
    if total_issues == 0:
        print("[OK] 未发现数据不一致问题！")
        return []
    
    all_issues = orphaned_issues + invalid_issues
    
    print(f"[WARN] 发现 {total_issues} 类问题：")
    print(f"   - 孤立数据：{len(orphaned_issues)} 类")
    print(f"   - 无效数据：{len(invalid_issues)} 类")
    print()
    
    if orphaned_issues:
        print("=" * 80)
        print("孤立数据问题：")
        print("=" * 80)
        for i, issue in enumerate(orphaned_issues, 1):
            print(f"\n{i}. {issue['description']}")
            print(f"   表：{issue['table']}")
            print(f"   字段：{issue['field']}")
            print(f"   数量：{issue['count']} 条")
            if issue['ids']:
                print(f"   示例ID：{issue['ids']}")
    
    if invalid_issues:
        print("\n" + "=" * 80)
        print("无效数据问题：")
        print("=" * 80)
        for i, issue in enumerate(invalid_issues, 1):
            print(f"\n{i}. {issue['description']}")
            print(f"   表：{issue['table']}")
            print(f"   字段：{issue['field']}")
            print(f"   数量：{issue['count']} 条")
            if issue['ids']:
                print(f"   示例ID：{issue['ids']}")
    
    return all_issues


def main():
    """主函数"""
    print("开始检查数据库...")
    print()
    
    existing_tables = get_existing_tables()
    print(f"发现 {len(existing_tables)} 个表：{', '.join(sorted(existing_tables))}")
    print()
    
    orphaned_issues = check_orphaned_records()
    invalid_issues = check_invalid_data()
    
    all_issues = print_report(orphaned_issues, invalid_issues)
    
    total_count = sum(i['count'] for i in all_issues) if all_issues else 0
    
    if total_count > 0:
        print("\n" + "=" * 80)
        print(f"总计发现 {total_count} 条问题数据")
        print("=" * 80)
        print("\n建议：")
        print("1. 运行清理脚本删除孤立数据: python cleanup_database.py")
    
    return all_issues


if __name__ == "__main__":
    main()
