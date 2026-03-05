"""
退货权限测试脚本
测试各角色的退货权限是否符合业务规则

权限矩阵:
| 角色       | 退给商品部 | 退给供应商 |
|------------|-----------|-----------|
| counter    | 允许       | 禁止       |
| settlement | 允许       | 禁止       |
| warehouse  | 禁止       | 允许       |
| manager    | 允许       | 允许       |
"""

import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Location, Supplier
from app.routers.returns import create_return_order
from app.schemas import ReturnOrderCreate, ReturnItemCreate
from fastapi import HTTPException
import asyncio


def get_db_session():
    """获取数据库会话"""
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./jewelry_erp.db")
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return SessionLocal()


def get_test_data(db):
    """获取测试所需的数据"""
    # 获取一个库位
    location = db.query(Location).first()
    if not location:
        print("错误: 没有找到库位数据")
        return None, None
    
    # 获取一个供应商
    supplier = db.query(Supplier).first()
    if not supplier:
        print("错误: 没有找到供应商数据")
        return location.id, None
    
    return location.id, supplier.id


async def test_return_permission(db, role: str, return_type: str, location_id: int, supplier_id: int):
    """
    测试退货权限
    
    Returns:
        (bool, str): (是否通过, 结果描述)
    """
    # 构建测试数据
    items = [ReturnItemCreate(
        product_name="测试商品-权限测试",
        return_weight=1.0,
        labor_cost=10.0,
        piece_count=1
    )]
    
    data = ReturnOrderCreate(
        return_type=return_type,
        items=items,
        from_location_id=location_id,
        supplier_id=supplier_id if return_type == "to_supplier" else None,
        return_reason="质量问题",
        reason_detail="权限测试-自动化测试"
    )
    
    try:
        result = await create_return_order(
            data=data,
            created_by="权限测试脚本",
            user_role=role,
            db=db
        )
        
        if isinstance(result, dict):
            if result.get("success"):
                return True, f"创建成功 (单号: {result.get('data', {}).get('return_no', 'N/A')})"
            else:
                return False, f"创建失败: {result.get('message', '未知错误')}"
        return True, "创建成功"
        
    except HTTPException as e:
        if e.status_code == 403:
            return False, f"权限拒绝 (403)"
        return False, f"HTTP异常: {e.status_code} - {e.detail}"
    except Exception as e:
        return False, f"异常: {str(e)}"


async def run_all_tests():
    """运行所有测试用例"""
    print("=" * 70)
    print("退货权限测试")
    print("=" * 70)
    
    # 获取数据库会话和测试数据
    db = get_db_session()
    location_id, supplier_id = get_test_data(db)
    
    if location_id is None:
        print("无法获取测试数据，测试终止")
        db.close()
        return
    
    print(f"\n测试数据: 库位ID={location_id}, 供应商ID={supplier_id}")
    print("-" * 70)
    
    # 测试用例: (角色, 退货类型, 期望结果)
    # 期望结果: True=应该成功, False=应该被拒绝
    # 注意：商品专员角色名称是 "product" 而不是 "warehouse"
    test_cases = [
        ("counter", "to_warehouse", True, "柜台退给商品部"),
        ("counter", "to_supplier", False, "柜台退给供应商"),
        ("settlement", "to_warehouse", True, "结算退给商品部"),
        ("settlement", "to_supplier", False, "结算退给供应商"),
        ("product", "to_warehouse", False, "商品专员退给商品部"),
        ("product", "to_supplier", True, "商品专员退给供应商"),
        ("manager", "to_warehouse", True, "管理员退给商品部"),
        ("manager", "to_supplier", True, "管理员退给供应商"),
    ]
    
    passed = 0
    failed = 0
    
    print(f"\n{'测试场景':<25} {'角色':<12} {'退货类型':<18} {'期望':<8} {'实际':<8} {'结果'}")
    print("-" * 100)
    
    for role, return_type, expected_success, description in test_cases:
        # 执行测试
        actual_success, result_msg = await test_return_permission(
            db, role, return_type, location_id, supplier_id
        )
        
        # 判断测试是否通过
        # 权限测试的核心：检查是否因权限被拒绝
        # - 如果期望有权限(expected_success=True)：不应该返回403权限拒绝
        # - 如果期望无权限(expected_success=False)：应该返回403权限拒绝
        permission_denied = "权限拒绝" in result_msg or "403" in result_msg
        
        if expected_success:
            # 期望有权限：只要不是权限拒绝就算通过（库存不足等业务错误不影响权限测试）
            test_passed = not permission_denied
        else:
            # 期望无权限：必须是权限拒绝
            test_passed = permission_denied
        
        if test_passed:
            passed += 1
            status = "[PASS]"
        else:
            failed += 1
            status = "[FAIL]"
        
        expected_str = "允许" if expected_success else "拒绝"
        actual_str = "拒绝" if permission_denied else "允许"
        
        print(f"{description:<25} {role:<12} {return_type:<18} {expected_str:<8} {actual_str:<8} {status}")
        
        if not test_passed:
            print(f"    └─ 详情: {result_msg}")
    
    # 汇总结果
    print("-" * 100)
    print(f"\n测试完成: 通过 {passed}/{passed+failed}, 失败 {failed}/{passed+failed}")
    
    if failed == 0:
        print("\n[SUCCESS] 所有测试通过！退货权限配置正确。")
    else:
        print(f"\n[WARNING] 有 {failed} 个测试失败，请检查权限配置。")
    
    db.close()


if __name__ == "__main__":
    asyncio.run(run_all_tests())
