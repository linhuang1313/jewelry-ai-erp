"""
数据迁移脚本：将旧系统 GoldMaterialTransaction (transaction_type='income') 迁移到新系统 GoldReceipt

迁移内容：
1. 期初金料（QC开头的单号）
2. 历史收料单（SL开头的单号，已确认的）

运行方式：
    cd backend
    python migrate_gold_receipts.py

注意：运行前请先备份数据库！
"""

import os
import sys
from datetime import datetime

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 导入模型
from app.database import Base
from app.models import GoldMaterialTransaction
from app.models.finance import GoldReceipt


def get_database_url():
    """获取数据库连接URL"""
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        # Railway PostgreSQL fix
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql://", 1)
        return database_url
    else:
        # 本地开发使用 SQLite
        return "sqlite:///./jewelry_erp.db"


def migrate_gold_receipts():
    """执行数据迁移"""
    
    print("=" * 60)
    print("金料收料单数据迁移脚本")
    print("=" * 60)
    
    database_url = get_database_url()
    print(f"数据库: {database_url[:50]}...")
    
    engine = create_engine(database_url)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # 1. 查询旧系统中的所有 income 类型记录
        old_receipts = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.transaction_type == 'income'
        ).all()
        
        print(f"\n找到 {len(old_receipts)} 条旧系统收料记录")
        
        if len(old_receipts) == 0:
            print("没有需要迁移的数据，退出")
            return
        
        # 2. 统计分类
        initial_records = [r for r in old_receipts if r.transaction_no and r.transaction_no.startswith("QC")]
        receipt_records = [r for r in old_receipts if r.transaction_no and r.transaction_no.startswith("SL")]
        other_records = [r for r in old_receipts if r.transaction_no and not r.transaction_no.startswith("QC") and not r.transaction_no.startswith("SL")]
        
        print(f"  - 期初金料记录 (QC): {len(initial_records)} 条")
        print(f"  - 收料单记录 (SL): {len(receipt_records)} 条")
        print(f"  - 其他记录: {len(other_records)} 条")
        
        # 3. 检查新系统是否已有数据（避免重复迁移）
        existing_new_receipts = db.query(GoldReceipt).count()
        print(f"\n新系统已有 {existing_new_receipts} 条记录")
        
        if existing_new_receipts > 0:
            # 检查是否有重复
            for old in old_receipts:
                if old.transaction_no:
                    existing = db.query(GoldReceipt).filter(
                        GoldReceipt.receipt_no == old.transaction_no
                    ).first()
                    if existing:
                        print(f"  - 跳过已存在: {old.transaction_no}")
        
        # 4. 开始迁移
        migrated_count = 0
        skipped_count = 0
        error_count = 0
        
        print("\n开始迁移...")
        
        for old in old_receipts:
            try:
                # 检查是否已迁移
                if old.transaction_no:
                    existing = db.query(GoldReceipt).filter(
                        GoldReceipt.receipt_no == old.transaction_no
                    ).first()
                    if existing:
                        skipped_count += 1
                        continue
                
                # 判断是否为期初金料
                is_initial = old.transaction_no and old.transaction_no.startswith("QC")
                
                # 状态映射
                if old.status == 'confirmed':
                    new_status = 'received'
                elif old.status == 'cancelled':
                    new_status = 'cancelled'
                else:
                    new_status = 'pending'
                
                # 创建新记录
                new_receipt = GoldReceipt(
                    receipt_no=old.transaction_no or f"MIG{datetime.now().strftime('%Y%m%d%H%M%S')}{old.id}",
                    settlement_id=old.settlement_order_id,
                    customer_id=old.customer_id if old.customer_id else None,
                    gold_weight=old.gold_weight,
                    gold_fineness="足金999",  # 默认成色
                    is_initial_balance=is_initial,  # 期初金料标记
                    status=new_status,
                    created_by=old.created_by or "系统迁移",
                    received_by=old.confirmed_by,
                    received_at=old.confirmed_at,
                    remark=f"[迁移自旧系统] {old.remark or ''}" if is_initial else (old.remark or ""),
                    created_at=old.created_at
                )
                
                db.add(new_receipt)
                migrated_count += 1
                
                # 标记旧记录为已迁移（添加备注）
                old.remark = f"[已迁移到GoldReceipt] {old.remark or ''}"
                
                if migrated_count % 10 == 0:
                    print(f"  已迁移 {migrated_count} 条...")
                    db.flush()
                
            except Exception as e:
                print(f"  错误: 迁移 {old.transaction_no} 失败 - {e}")
                error_count += 1
        
        # 5. 提交事务
        db.commit()
        
        print("\n" + "=" * 60)
        print("迁移完成!")
        print(f"  - 成功迁移: {migrated_count} 条")
        print(f"  - 跳过(已存在): {skipped_count} 条")
        print(f"  - 失败/警告: {error_count} 条")
        print("=" * 60)
        
        # 6. 验证迁移结果
        new_total = db.query(GoldReceipt).count()
        print(f"\n新系统当前共有 {new_total} 条记录")
        
    except Exception as e:
        db.rollback()
        print(f"\n迁移失败: {e}")
        raise
    finally:
        db.close()


def check_initial_gold_migration():
    """检查期初金料迁移情况"""
    print("\n检查期初金料...")
    
    database_url = get_database_url()
    engine = create_engine(database_url)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        # 旧系统期初金料
        old_initial = db.query(GoldMaterialTransaction).filter(
            GoldMaterialTransaction.transaction_type == 'income',
            GoldMaterialTransaction.transaction_no.like("QC%")
        ).first()
        
        if old_initial:
            print(f"旧系统期初金料: {old_initial.transaction_no} - {old_initial.gold_weight}克")
            
            # 检查是否已迁移
            new_initial = db.query(GoldReceipt).filter(
                GoldReceipt.receipt_no == old_initial.transaction_no
            ).first()
            
            if new_initial:
                print(f"  已迁移到新系统: {new_initial.receipt_no} - {new_initial.gold_weight}克")
            else:
                print(f"  警告: 尚未迁移到新系统!")
        else:
            print("旧系统中没有期初金料记录")
            
            # 检查新系统是否有期初记录
            new_initial = db.query(GoldReceipt).filter(
                GoldReceipt.receipt_no.like("QC%")
            ).first()
            
            if new_initial:
                print(f"新系统期初金料: {new_initial.receipt_no} - {new_initial.gold_weight}克")
            else:
                print("新系统中也没有期初金料记录")
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="金料收料单数据迁移")
    parser.add_argument("--check", action="store_true", help="只检查不迁移")
    parser.add_argument("--force", action="store_true", help="强制执行迁移")
    
    args = parser.parse_args()
    
    if args.check:
        check_initial_gold_migration()
    else:
        print("\n⚠️  警告: 此脚本将迁移旧系统数据到新系统")
        print("请确保已备份数据库!")
        
        if args.force:
            migrate_gold_receipts()
        else:
            confirm = input("\n是否继续? (yes/no): ")
            if confirm.lower() == "yes":
                migrate_gold_receipts()
                check_initial_gold_migration()
            else:
                print("已取消")

