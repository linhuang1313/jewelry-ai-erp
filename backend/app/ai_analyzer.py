"""通用AI分析引擎 - 替代所有查询和分析函数"""
from openai import OpenAI
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from .models import (
    InboundOrder, InboundDetail, Inventory, 
    Customer, SalesOrder, SalesDetail, Supplier,
    Location, LocationInventory,
    InventoryTransferOrder, InventoryTransferItem
)

logger = logging.getLogger(__name__)

# AI查询角色数据访问权限矩阵
# 定义每个角色可以通过AI查询的数据类型
ROLE_DATA_ACCESS = {
    'manager': ['inventory', 'transfer_orders', 'inbound_orders', 'sales_orders', 
                'customers', 'customer_debt', 'suppliers', 'supplier_gold'],
    'product': ['inventory', 'transfer_orders', 'inbound_orders', 
                'suppliers', 'supplier_gold'],
    'counter': ['inventory', 'transfer_orders', 'sales_orders', 'customers'],
    'settlement': ['inventory', 'transfer_orders', 'sales_orders', 
                   'customers', 'customer_debt'],
    'finance': ['inventory', 'transfer_orders', 'inbound_orders', 'sales_orders',
                'customers', 'customer_debt', 'suppliers', 'supplier_gold'],
    'material': ['customers', 'suppliers', 'supplier_gold'],
    'sales': ['inventory', 'sales_orders', 'customers', 'customer_debt'],
}

# 数据类型的中文名称（用于友好提示）
DATA_TYPE_NAMES = {
    'inventory': '库存',
    'transfer_orders': '转移单/调拨单',
    'inbound_orders': '入库单',
    'sales_orders': '销售单',
    'customers': '客户',
    'customer_debt': '客户账务',
    'suppliers': '供应商',
    'supplier_gold': '供应商金料账户',
}

# 数据类型对应的建议联系部门
DATA_ACCESS_SUGGESTIONS = {
    'inventory': '商品部或管理层',
    'transfer_orders': '商品部或柜台',
    'inbound_orders': '商品部或财务',
    'sales_orders': '柜台或结算部',
    'customers': '柜台或结算部',
    'customer_debt': '结算部或财务',
    'suppliers': '商品部或料部',
    'supplier_gold': '料部或财务',
}

class AIAnalyzer:
    """通用AI分析引擎 - 使用 DeepSeek API"""
    
    def __init__(self):
        from dotenv import load_dotenv
        import os
        load_dotenv()
        # DeepSeek API 客户端（使用 OpenAI 兼容格式）
        self.client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com",
            timeout=60.0  # 60秒超时，避免无限等待
        )
    
    def collect_all_data(self, intent: str, user_message: str, db: Session, order_no: Optional[str] = None, sales_order_no: Optional[str] = None, user_role: str = "manager", inbound_supplier: Optional[str] = None, inbound_product: Optional[str] = None, inbound_date_start: Optional[str] = None, inbound_date_end: Optional[str] = None, transfer_order_no: Optional[str] = None, transfer_status: Optional[str] = None, transfer_date_start: Optional[str] = None, transfer_date_end: Optional[str] = None) -> Dict[str, Any]:
        """根据用户意图智能收集所有相关数据
        
        Args:
            intent: 用户意图
            user_message: 用户消息
            inbound_supplier: 入库单供应商筛选
            inbound_product: 入库单商品筛选
            inbound_date_start: 入库单开始日期筛选
            inbound_date_end: 入库单结束日期筛选
            db: 数据库会话
            order_no: 入库单号（可选，RK开头，用于精确查询入库单）
            sales_order_no: 销售单号（可选，XS开头，用于精确查询销售单）
            user_role: 用户角色，决定显示哪个仓位的库存
            transfer_order_no: 转移单号（可选，TR开头，用于精确查询转移单）
            transfer_status: 转移单状态筛选
            transfer_date_start: 转移单开始日期筛选
            transfer_date_end: 转移单结束日期筛选
        """
        # ========== 获取角色数据访问权限 ==========
        allowed_data = ROLE_DATA_ACCESS.get(user_role, [])
        data_restrictions = []  # 记录被限制的数据类型
        
        data = {
            "context": {
                "intent": intent,
                "user_message": user_message,
                "timestamp": datetime.now().isoformat(),
                "order_no": order_no,  # 入库单号
                "sales_order_no": sales_order_no,  # 销售单号
                "user_role": user_role,  # 用户角色
                "data_restrictions": [],  # 将在最后填充
                "restriction_hint": None  # 权限提示
            }
        }
        
        # ========== 根据角色收集库存数据 ==========
        # 管理层：显示总库存
        # 商品专员：只显示商品部仓库库存
        # 柜台/结算/财务/业务员：只显示展厅库存
        # 料部：不能查看库存
        
        if 'inventory' not in allowed_data:
            # 角色无权查看库存
            data["inventory"] = []
            data["inventory_location"] = "无权限"
            data_restrictions.append('inventory')
        elif user_role == "manager":
            # 管理层看总库存
            inventories = db.query(Inventory).all()
            data["inventory"] = [
                {
                    "product_name": inv.product_name,
                    "total_weight": inv.total_weight,
                    "location": "全部仓位",
                    "last_update": str(inv.last_update) if inv.last_update else None
                }
                for inv in inventories
            ]
            data["inventory_location"] = "全部仓位（总库存）"
        else:
            # 根据角色确定仓位
            if user_role == "product":
                location_code = "warehouse"
                location_display = "商品部仓库"
            elif user_role in ["counter", "settlement"]:
                location_code = "showroom"
                location_display = "展厅"
            else:
                # 其他角色默认看总库存
                location_code = None
                location_display = "全部仓位"
            
            if location_code:
                # 查询对应仓位的库存
                location = db.query(Location).filter(Location.code == location_code).first()
                if location:
                    location_inventories = db.query(LocationInventory).filter(
                        LocationInventory.location_id == location.id,
                        LocationInventory.weight > 0
                    ).all()
                    data["inventory"] = [
                        {
                            "product_name": li.product_name,
                            "total_weight": li.weight,
                            "location": location_display,
                            "last_update": str(li.last_update) if li.last_update else None
                        }
                        for li in location_inventories
                    ]
                else:
                    data["inventory"] = []
                data["inventory_location"] = location_display
            else:
                # 没有指定仓位，显示总库存
                inventories = db.query(Inventory).all()
                data["inventory"] = [
                    {
                        "product_name": inv.product_name,
                        "total_weight": inv.total_weight,
                        "location": "全部仓位",
                        "last_update": str(inv.last_update) if inv.last_update else None
                    }
                    for inv in inventories
                ]
                data["inventory_location"] = "全部仓位（总库存）"
        
        # 收集供应商数据（从Supplier表）- 需要权限检查
        if 'suppliers' in allowed_data:
            suppliers = db.query(Supplier).filter(Supplier.status == "active").all()
            data["suppliers"] = [
                {
                    "name": s.name,
                    "supplier_no": s.supplier_no,
                    "phone": s.phone,
                    "address": s.address,
                    "contact_person": s.contact_person,
                    "total_cost": float(s.total_supply_amount) if s.total_supply_amount else 0,
                    "total_weight": float(s.total_supply_weight) if s.total_supply_weight else 0,
                    "supply_count": s.total_supply_count,
                    "last_supply_time": str(s.last_supply_time) if s.last_supply_time else None
                }
                for s in suppliers
            ]
            
            # 同时收集从InboundDetail统计的商品种类（用于兼容）
            for supplier_data in data["suppliers"]:
                supplier_name = supplier_data["name"]
                product_count = db.query(func.count(func.distinct(InboundDetail.product_name))).filter(
                    InboundDetail.supplier == supplier_name
                ).scalar() or 0
                supplier_data["product_count"] = product_count
        else:
            data["suppliers"] = []
            data_restrictions.append('suppliers')
        
        # 收集入库单数据（支持筛选）- 需要权限检查
        if 'inbound_orders' in allowed_data:
            inbound_query = db.query(InboundOrder).order_by(desc(InboundOrder.create_time))
            
            # 按日期筛选
            if inbound_date_start:
                try:
                    start_dt = datetime.strptime(inbound_date_start, "%Y-%m-%d")
                    inbound_query = inbound_query.filter(InboundOrder.create_time >= start_dt)
                except:
                    pass
            if inbound_date_end:
                try:
                    end_dt = datetime.strptime(inbound_date_end, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                    inbound_query = inbound_query.filter(InboundOrder.create_time <= end_dt)
                except:
                    pass
            
            inbound_orders = inbound_query.limit(100).all()
            data["inbound_orders"] = []
            data["inbound_filters"] = {
                "supplier": inbound_supplier,
                "product": inbound_product,
                "date_start": inbound_date_start,
                "date_end": inbound_date_end
            }
            
            for order in inbound_orders:
                details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
                
                # 按供应商筛选
                if inbound_supplier:
                    suppliers_in_order = [d.supplier for d in details if d.supplier]
                    if not any(inbound_supplier.lower() in (s or '').lower() for s in suppliers_in_order):
                        continue
                
                # 按商品名称筛选
                if inbound_product:
                    products_in_order = [d.product_name for d in details if d.product_name]
                    if not any(inbound_product.lower() in (p or '').lower() for p in products_in_order):
                        continue
                
                data["inbound_orders"].append({
                    "order_id": order.id,
                    "order_no": order.order_no,
                    "create_time": str(order.create_time) if order.create_time else None,
                    "status": order.status,
                    "details": [
                        {
                            "product_name": d.product_name,
                            "weight": d.weight,
                            "labor_cost": d.labor_cost,
                            "supplier": d.supplier,
                            "total_cost": d.total_cost
                        }
                        for d in details
                    ]
                })
        else:
            data["inbound_orders"] = []
            data["inbound_filters"] = {}
            data_restrictions.append('inbound_orders')
        
        # 收集客户数据 - 需要权限检查
        if 'customers' in allowed_data:
            customers = db.query(Customer).filter(Customer.status == "active").all()
            data["customers"] = [
                {
                    "name": c.name,
                    "phone": c.phone,
                    "total_purchase_amount": c.total_purchase_amount or 0,  # 总工费金额
                    "total_purchase_weight": getattr(c, 'total_purchase_weight', 0) or 0,  # 总销售克重
                    "total_purchase_count": c.total_purchase_count or 0,
                    "last_purchase_time": str(c.last_purchase_time) if c.last_purchase_time else None,
                    "customer_type": c.customer_type
                }
                for c in customers
            ]
        else:
            data["customers"] = []
            data_restrictions.append('customers')
        
        # 收集销售单数据 - 需要权限检查
        if 'sales_orders' in allowed_data:
            sales_orders = db.query(SalesOrder).order_by(desc(SalesOrder.order_date)).limit(50).all()
            data["sales_orders"] = []
            for so in sales_orders:
                details = db.query(SalesDetail).filter(SalesDetail.order_id == so.id).all()
                data["sales_orders"].append({
                    "order_no": so.order_no,
                    "customer_name": so.customer_name,
                    "salesperson": so.salesperson,
                    "store_code": so.store_code,
                    "total_labor_cost": so.total_labor_cost,
                    "total_weight": so.total_weight,
                    "status": so.status,
                    "order_date": str(so.order_date) if so.order_date else None,
                    "details": [
                        {
                            "product_name": d.product_name,
                            "weight": d.weight,
                            "labor_cost": d.labor_cost,
                            "total_labor_cost": d.total_labor_cost
                        }
                        for d in details
                    ]
                })
        else:
            data["sales_orders"] = []
            data_restrictions.append('sales_orders')
        
        # 收集转移单/调拨单数据 - 需要权限检查
        if 'transfer_orders' in allowed_data:
            transfer_query = db.query(InventoryTransferOrder).order_by(desc(InventoryTransferOrder.created_at))
            
            # 按单号筛选
            if transfer_order_no:
                transfer_query = transfer_query.filter(InventoryTransferOrder.transfer_no == transfer_order_no)
            
            # 按状态筛选
            if transfer_status:
                transfer_query = transfer_query.filter(InventoryTransferOrder.status == transfer_status)
            
            # 按日期筛选
            if transfer_date_start:
                try:
                    start_dt = datetime.strptime(transfer_date_start, "%Y-%m-%d")
                    transfer_query = transfer_query.filter(InventoryTransferOrder.created_at >= start_dt)
                except:
                    pass
            if transfer_date_end:
                try:
                    end_dt = datetime.strptime(transfer_date_end, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
                    transfer_query = transfer_query.filter(InventoryTransferOrder.created_at <= end_dt)
                except:
                    pass
            
            transfer_orders = transfer_query.limit(100).all()
            data["transfer_orders"] = []
            data["transfer_filters"] = {
                "transfer_order_no": transfer_order_no,
                "status": transfer_status,
                "date_start": transfer_date_start,
                "date_end": transfer_date_end
            }
            
            for order in transfer_orders:
                # 获取来源转移单号（重新发起时的原单）
                source_transfer_no = None
                if order.source_order_id:
                    source_order = db.query(InventoryTransferOrder).filter(
                        InventoryTransferOrder.id == order.source_order_id
                    ).first()
                    if source_order:
                        source_transfer_no = source_order.transfer_no
                
                # 获取关联的新转移单（被重新发起后产生的）
                related_order = db.query(InventoryTransferOrder).filter(
                    InventoryTransferOrder.source_order_id == order.id
                ).first()
                
                data["transfer_orders"].append({
                    "transfer_no": order.transfer_no,
                    "from_location": order.from_location.name if order.from_location else None,
                    "to_location": order.to_location.name if order.to_location else None,
                    "status": order.status,
                    "status_display": {
                        "pending": "待接收",
                        "received": "已接收",
                        "rejected": "已拒收",
                        "pending_confirm": "待确认",
                        "returned": "已退回"
                    }.get(order.status, order.status),
                    "created_by": order.created_by,
                    "created_at": str(order.created_at) if order.created_at else None,
                    "received_by": order.received_by,
                    "received_at": str(order.received_at) if order.received_at else None,
                    "remark": order.remark,
                    "source_transfer_no": source_transfer_no,  # 来源单号（重新发起时的原单）
                    "related_transfer_no": related_order.transfer_no if related_order else None,  # 关联新单号（被重新发起后产生的）
                    "items": [
                        {
                            "product_name": item.product_name,
                            "weight": item.weight,
                            "actual_weight": item.actual_weight,
                            "weight_diff": item.weight_diff,
                            "diff_reason": item.diff_reason
                        }
                        for item in order.items
                    ],
                    "total_weight": sum(item.weight for item in order.items),
                    "total_actual_weight": sum(item.actual_weight or 0 for item in order.items) if order.status in ["received", "pending_confirm"] else None
                })
        else:
            data["transfer_orders"] = []
            data["transfer_filters"] = {}
            data_restrictions.append('transfer_orders')
        
        # 收集总体统计（根据角色计算库存总重量）
        # 库存总重量使用已收集的库存数据计算，这样就是角色对应仓位的库存
        inventory_total = sum(inv.get("total_weight", 0) for inv in data.get("inventory", []))
        
        # 只显示有权限访问的统计数据
        statistics = {
            "inventory_location": data.get("inventory_location", "全部仓位"),
        }
        
        if 'inventory' in allowed_data:
            statistics["total_inventory_weight"] = float(inventory_total)
            statistics["total_products"] = len(data.get("inventory", []))
        
        if 'inbound_orders' in allowed_data:
            statistics["total_inbound_cost"] = float(db.query(func.sum(InboundDetail.total_cost)).scalar() or 0)
            statistics["total_inbound_orders"] = db.query(func.count(InboundOrder.id)).scalar() or 0
        
        if 'suppliers' in allowed_data:
            statistics["total_suppliers"] = len(data.get("suppliers", []))
        
        if 'customers' in allowed_data:
            statistics["total_customers"] = len(data.get("customers", []))
        
        if 'sales_orders' in allowed_data:
            statistics["total_sales_orders"] = db.query(func.count(SalesOrder.id)).scalar() or 0
        
        data["statistics"] = statistics
        
        # ========== 填充权限限制信息 ==========
        # 将被限制的数据类型转换为中文名称
        restricted_names = [DATA_TYPE_NAMES.get(dt, dt) for dt in data_restrictions]
        data["context"]["data_restrictions"] = restricted_names
        
        # 生成权限提示（如果有限制）
        if data_restrictions:
            suggestions = list(set([DATA_ACCESS_SUGGESTIONS.get(dt, '') for dt in data_restrictions if DATA_ACCESS_SUGGESTIONS.get(dt)]))
            if suggestions:
                data["context"]["restriction_hint"] = f"如需查询这些数据，请联系{suggestions[0]}"
        
        return data
    
    def format_data_for_ai(self, data: Dict[str, Any]) -> str:
        """将数据格式化为易读的文本，供AI分析"""
        text = "=== 系统数据库概览 ===\n\n"
        
        # 总体统计
        stats = data.get("statistics", {})
        inventory_location = stats.get('inventory_location', '全部仓位')
        text += f"总体统计：\n"
        text += f"- 商品种类：{stats.get('total_products', 0)}种\n"
        text += f"- 库存位置：{inventory_location}\n"
        text += f"- 库存总重量：{stats.get('total_inventory_weight', 0):.2f}克\n"
        text += f"- 总入库成本：{stats.get('total_inbound_cost', 0):.2f}元\n"
        text += f"- 供应商数量：{stats.get('total_suppliers', 0)}个\n"
        text += f"- 客户数量：{stats.get('total_customers', 0)}个\n"
        text += f"- 入库单数量：{stats.get('total_inbound_orders', 0)}个\n"
        text += f"- 销售单数量：{stats.get('total_sales_orders', 0)}个\n\n"
        
        # 库存详情（显示仓位名称）
        inventory_location = data.get("inventory_location", "全部仓位")
        if data.get("inventory"):
            text += f"=== {inventory_location}库存详情（共{len(data['inventory'])}种商品）===\n"
            for idx, inv in enumerate(data["inventory"], 1):
                text += f"{idx}. {inv['product_name']}：{inv['total_weight']}克"
                if inv.get('last_update'):
                    text += f"（最后更新：{inv['last_update']}）"
                text += "\n"
            text += "\n"
        
        # 供应商详情
        if data.get("suppliers"):
            text += f"=== 供应商详情（共{len(data['suppliers'])}个）===\n"
            for idx, supplier in enumerate(data["suppliers"], 1):
                text += f"{idx}. {supplier['name']}：\n"
                text += f"   - 总工费：{supplier['total_cost']:.2f}元\n"
                text += f"   - 总重量：{supplier['total_weight']:.2f}克\n"
                text += f"   - 商品种类：{supplier['product_count']}种\n"
                text += f"   - 供货频次：{supplier.get('supply_count', 0)}次\n\n"
        
        # 客户详情
        if data.get("customers"):
            text += f"=== 客户详情（共{len(data['customers'])}个）===\n"
            for idx, customer in enumerate(data["customers"], 1):
                text += f"{idx}. {customer['name']}：\n"
                text += f"   - 总销售克重：{customer.get('total_purchase_weight', 0):.2f}克\n"
                text += f"   - 总工费金额：¥{customer['total_purchase_amount']:.2f}\n"
                text += f"   - 购买次数：{customer['total_purchase_count']}次\n"
                if customer.get('last_purchase_time'):
                    text += f"   - 最后购买：{customer['last_purchase_time']}\n"
                # 品类分布
                if customer.get('category_breakdown'):
                    text += f"   - 购买品类：\n"
                    for cat in customer['category_breakdown'][:5]:
                        text += f"      • {cat['name']}：{cat['weight']:.1f}克（¥{cat['labor']:.2f}工费）\n"
                text += "\n"
        
        # 入库单详情（如果指定了入库单号，优先显示该入库单）
        order_no = data.get("context", {}).get("order_no")
        target_order = None
        
        if order_no and data.get("inbound_orders"):
            # 查找指定的入库单
            for order in data["inbound_orders"]:
                if order.get("order_no") == order_no:
                    target_order = order
                    break
            
            if target_order:
                text += f"=== 入库单详情（入库单号：{order_no}）===\n"
                text += f"入库单ID：{target_order.get('order_id', 'N/A')}（用于下载和打印）\n"
                text += f"入库单号：{target_order['order_no']}\n"
                text += f"创建时间：{target_order.get('create_time', 'N/A')}\n"
                text += f"状态：{target_order.get('status', 'N/A')}\n"
                text += f"商品明细：\n"
                total_weight = 0
                total_cost = 0
                total_piece_count = 0
                for idx, detail in enumerate(target_order.get('details', []), 1):
                    text += f"  {idx}. {detail['product_name']}：\n"
                    text += f"     - 重量：{detail['weight']}克\n"
                    text += f"     - 克工费：{detail['labor_cost']}元/克\n"
                    # 显示件数和件工费（如果有）
                    if detail.get('piece_count') and detail.get('piece_count') > 0:
                        text += f"     - 件数：{detail['piece_count']}件\n"
                        if detail.get('piece_labor_cost'):
                            text += f"     - 件工费：{detail['piece_labor_cost']}元/件\n"
                        total_piece_count += detail['piece_count']
                    # 必须显示供应商名称
                    if detail.get('supplier'):
                        text += f"     - 供应商：{detail['supplier']}\n"
                    text += f"     - 总成本：{detail['total_cost']:.2f}元\n"
                    total_weight += detail['weight']
                    total_cost += detail['total_cost']
                    text += "\n"
                text += f"总计：\n"
                text += f"  - 总重量：{total_weight:.2f}克\n"
                if total_piece_count > 0:
                    text += f"  - 总件数：{total_piece_count}件\n"
                text += f"  - 总成本：{total_cost:.2f}元\n\n"
            else:
                text += f"=== 注意：未找到入库单号 {order_no} ===\n\n"
        
        # 最近的入库单（如果没有指定入库单号，或作为补充信息）
        if data.get("inbound_orders") and not (order_no and target_order):
            # 检查是否有筛选条件
            inbound_filters = data.get("inbound_filters", {})
            has_filters = any([inbound_filters.get("date_start"), inbound_filters.get("date_end"), 
                              inbound_filters.get("supplier"), inbound_filters.get("product")])
            
            if has_filters:
                # 有筛选条件时，显示完整的入库单列表（用于入库单列表查询）
                text += f"=== 符合条件的入库单（共{len(data['inbound_orders'])}个）===\n"
                total_weight = 0
                total_items = 0
                for order in data["inbound_orders"]:
                    order_date = order.get('create_time', 'N/A')
                    # 格式化日期，只保留日期部分
                    if order_date and order_date != 'N/A':
                        order_date = order_date.split(' ')[0] if ' ' in order_date else order_date.split('T')[0] if 'T' in order_date else order_date
                    text += f"\n入库单号：{order['order_no']}，日期：{order_date}\n"
                    for detail in order.get('details', []):
                        text += f"  • 【{order['order_no']}】{detail['product_name']}：{detail['weight']}克，供应商：{detail['supplier']}，日期：{order_date}\n"
                        total_weight += detail['weight']
                        total_items += 1
                text += f"\n总计：{len(data['inbound_orders'])}个入库单，{total_items}件商品，总重量{total_weight:.2f}克\n"
            else:
                # 没有筛选条件时，只显示简要信息
                text += f"=== 最近入库单（显示最近{min(10, len(data['inbound_orders']))}个）===\n"
                for idx, order in enumerate(data["inbound_orders"][:10], 1):
                    text += f"{idx}. 入库单号：{order['order_no']}，时间：{order.get('create_time', 'N/A')}\n"
                    for detail in order.get('details', [])[:3]:  # 只显示前3个商品
                        text += f"   - {detail['product_name']}：{detail['weight']}克，工费{detail['labor_cost']}元/克，供应商：{detail['supplier']}\n"
                    if len(order.get('details', [])) > 3:
                        text += f"   ... 还有{len(order['details']) - 3}个商品\n"
                    text += "\n"
        
        # 最近的销售单
        if data.get("sales_orders"):
            text += f"=== 最近销售单（显示最近{min(10, len(data['sales_orders']))}个）===\n"
            for idx, order in enumerate(data["sales_orders"][:10], 1):
                text += f"{idx}. 销售单号：{order['order_no']}，客户：{order['customer_name']}，业务员：{order['salesperson']}\n"
                text += f"   总工费：{order['total_labor_cost']:.2f}元，总重量：{order['total_weight']}克，状态：{order['status']}\n"
                for detail in order.get('details', [])[:3]:  # 只显示前3个商品
                    text += f"   - {detail['product_name']}：{detail['weight']}克，工费{detail['labor_cost']}元/克\n"
                if len(order.get('details', [])) > 3:
                    text += f"   ... 还有{len(order['details']) - 3}个商品\n"
                text += "\n"
        
        # 转移单/调拨单详情
        if data.get("transfer_orders"):
            transfer_filters = data.get("transfer_filters", {})
            filter_desc = ""
            if transfer_filters.get("transfer_order_no"):
                filter_desc = f"（单号：{transfer_filters['transfer_order_no']}）"
            elif transfer_filters.get("status"):
                status_map = {"pending": "待接收", "received": "已接收", "rejected": "已拒收", "pending_confirm": "待确认", "returned": "已退回"}
                filter_desc = f"（状态：{status_map.get(transfer_filters['status'], transfer_filters['status'])}）"
            elif transfer_filters.get("date_start") or transfer_filters.get("date_end"):
                filter_desc = f"（日期：{transfer_filters.get('date_start', '')} 至 {transfer_filters.get('date_end', '')}）"
            
            text += f"=== 转移单/调拨单{filter_desc}（共{len(data['transfer_orders'])}个）===\n"
            for idx, order in enumerate(data["transfer_orders"][:20], 1):
                text += f"{idx}. 单号：{order['transfer_no']}\n"
                text += f"   路径：{order['from_location']} → {order['to_location']}\n"
                text += f"   状态：{order['status_display']}\n"
                text += f"   创建时间：{order.get('created_at', 'N/A')}\n"
                text += f"   创建人：{order.get('created_by', 'N/A')}\n"
                
                # 显示关联信息
                if order.get('source_transfer_no'):
                    text += f"   来源单号：{order['source_transfer_no']}（该单由原单重新发起）\n"
                if order.get('related_transfer_no'):
                    text += f"   关联新单：{order['related_transfer_no']}（该单已被重新发起）\n"
                
                # 显示备注
                if order.get('remark'):
                    text += f"   备注：{order['remark']}\n"
                
                # 显示商品明细
                text += f"   商品（共{len(order.get('items', []))}种，总重量{order.get('total_weight', 0):.2f}克）：\n"
                for item in order.get('items', [])[:5]:
                    diff_info = ""
                    if item.get('actual_weight') is not None and item['actual_weight'] != item['weight']:
                        diff_info = f"，实际{item['actual_weight']}克，差异{item.get('weight_diff', 0):.2f}克"
                        if item.get('diff_reason'):
                            diff_info += f"（{item['diff_reason']}）"
                    text += f"      • {item['product_name']}：{item['weight']}克{diff_info}\n"
                if len(order.get('items', [])) > 5:
                    text += f"      ... 还有{len(order['items']) - 5}种商品\n"
                
                # 显示接收信息
                if order.get('received_by'):
                    text += f"   接收人：{order['received_by']}，接收时间：{order.get('received_at', 'N/A')}\n"
                
                text += "\n"
        
        # 客户账务数据（聊天查询用）
        if data.get("customer_debt"):
            debt_data = data["customer_debt"]
            if debt_data.get("success"):
                customer = debt_data.get("customer", {})
                text += f"\n=== 客户账务详情 ===\n"
                text += f"客户ID：{customer.get('id', 'N/A')}\n"
                text += f"客户：{customer.get('name', 'N/A')}（{customer.get('customer_no', 'N/A')}）\n"
                text += f"电话：{customer.get('phone', 'N/A')}\n"
                
                # 查询时间范围
                period = debt_data.get("query_period", {})
                if period.get("start") or period.get("end"):
                    text += f"查询时间范围：{period.get('start', '起始')} 至 {period.get('end', '至今')}\n"
                
                text += "\n--- 账务汇总 ---\n"
                
                # 现金账户（正数=欠款，负数=预收款）
                cash_debt = debt_data.get("cash_debt", 0)
                if cash_debt > 0:
                    text += f"💰 现金账户：欠款 ¥{cash_debt:.2f}\n"
                elif cash_debt < 0:
                    text += f"💰 现金账户：预收款 ¥{abs(cash_debt):.2f}\n"
                else:
                    text += f"💰 现金账户：已结清 ¥0.00\n"
                
                cash_txs = debt_data.get("cash_transactions", [])
                if cash_txs:
                    text += f"   最近现金交易记录：\n"
                    for tx in cash_txs[:5]:
                        created_at = tx.get('created_at', 'N/A')
                        if created_at and len(created_at) >= 10:
                            created_at = created_at[:10]
                        description = tx.get('description', tx.get('type', '交易'))
                        amount = tx.get('amount', 0)
                        text += f"   • {created_at}：{description} ¥{amount:.2f}\n"
                
                # 净金料（直接使用单一账户模式的 net_gold 字段）
                # net_gold 正数=欠料，负数=存料（与 chat_debt_query 语义一致）
                net_gold = debt_data.get("net_gold", 0)
                # 如果没有 net_gold 字段（兼容旧数据），则从 gold_debt 和 gold_deposit 计算
                if net_gold == 0 and (debt_data.get("gold_deposit", 0) > 0 or debt_data.get("gold_debt", 0) > 0):
                    # 兼容旧数据：gold_debt 是欠料，gold_deposit 是存料
                    net_gold = debt_data.get("gold_debt", 0) - debt_data.get("gold_deposit", 0)
                
                if net_gold > 0:
                    text += f"💎 金料账户：净欠料 {net_gold:.2f}克\n"
                elif net_gold < 0:
                    text += f"💎 金料账户：净存料 {abs(net_gold):.2f}克\n"
                else:
                    text += f"💎 金料账户：已结清 0.00克\n"
                
                # 最近金料交易记录
                gold_txs = debt_data.get("gold_transactions", [])
                if gold_txs:
                    text += f"   最近金料交易记录：\n"
                    for tx in gold_txs[:5]:
                        text += f"   • {tx.get('created_at', 'N/A')[:10]}：{tx.get('type_label', tx.get('type', 'N/A'))}，金料{tx.get('gold_weight', 0):.2f}克\n"
                
                # 最近存料记录
                deposit_txs = debt_data.get("deposit_transactions", [])
                if deposit_txs:
                    text += f"   最近存料记录：\n"
                    for tx in deposit_txs[:5]:
                        text += f"   • {tx.get('created_at', 'N/A')[:10]}：{tx.get('type_label', tx.get('type', 'N/A'))} {tx.get('amount', 0):.2f}克\n"
                
                # 客户销售历史表现（新增）
                sales_history = debt_data.get("sales_history")
                if sales_history:
                    # 指定时间段销售（今日/本周等）
                    period_weight = sales_history.get('period_sales_weight', 0)
                    period_labor = sales_history.get('period_labor_cost', 0)
                    period_count = sales_history.get('period_order_count', 0)
                    
                    text += "\n--- 📅 查询时间段销售 ---\n"
                    text += f"⚖️ 销售克重：{period_weight:.2f}克\n"
                    text += f"💰 工费金额：¥{period_labor:.2f}\n"
                    text += f"📦 订单数量：{period_count}单\n"
                    
                    # 历史总览（全部记录）
                    text += "\n--- 📊 客户历史总览 ---\n"
                    text += f"⚖️ 历史总销售克重：{sales_history.get('total_sales_weight', 0):.2f}克\n"
                    text += f"💰 历史总工费金额：¥{sales_history.get('total_labor_cost', 0):.2f}\n"
                    text += f"🛒 历史总购买次数：{sales_history.get('order_count', 0)}次\n"
                    if sales_history.get('last_purchase_time'):
                        text += f"⏱️ 最后购买时间：{sales_history['last_purchase_time']}\n"
                    text += f"🏆 客户排名：第{sales_history.get('customer_rank', 0)}位 / {sales_history.get('total_customer_count', 0)}\n"
                    
                    category_breakdown = sales_history.get("category_breakdown", [])
                    if category_breakdown:
                        text += "\n--- 🏷️ 购买品类分布（历史） ---\n"
                        total_weight = sales_history.get('total_sales_weight', 1) or 1
                        for cat in category_breakdown[:5]:
                            percentage = (cat['weight'] / total_weight * 100) if total_weight > 0 else 0
                            text += f"• {cat['name']}：{cat['weight']:.1f}克（{percentage:.1f}%），工费¥{cat['labor']:.2f}\n"
                
                text += "\n"
            else:
                text += f"\n=== 客户账务查询 ===\n"
                text += f"查询失败：{debt_data.get('message', '未知错误')}\n"
                text += f"搜索的客户名称：{debt_data.get('customer_name', 'N/A')}\n\n"
        
        # 销售分析数据
        if data.get("sales_analytics"):
            analytics = data["sales_analytics"]
            text += f"\n=== 销售数据分析 ===\n"
            
            # 仪表盘汇总
            summary = analytics.get("summary", {})
            if summary:
                today = summary.get("today", {})
                month = summary.get("month", {})
                
                text += "\n--- 今日销售 ---\n"
                text += f"💰 销售额：¥{today.get('sales_amount', 0):.2f}\n"
                text += f"📦 订单数：{today.get('order_count', 0)}单\n"
                text += f"⚖️ 销售克重：{today.get('sales_weight', 0):.2f}克\n"
                if today.get('change_percent') is not None:
                    change = today['change_percent']
                    text += f"📈 较昨日：{'↑' if change >= 0 else '↓'}{abs(change):.1f}%\n"
                
                text += "\n--- 本月销售 ---\n"
                text += f"💰 销售额：¥{month.get('sales_amount', 0):.2f}\n"
                text += f"📦 订单数：{month.get('order_count', 0)}单\n"
                text += f"⚖️ 销售克重：{month.get('sales_weight', 0):.2f}克\n"
                if month.get('change_percent') is not None:
                    change = month['change_percent']
                    text += f"📈 较上月：{'↑' if change >= 0 else '↓'}{abs(change):.1f}%\n"
            
            # 热销商品
            top_products = analytics.get("top_products", [])
            if top_products:
                text += "\n--- 热销商品TOP5 ---\n"
                for idx, p in enumerate(top_products[:5], 1):
                    text += f"{idx}. {p.get('product_name', 'N/A')}：¥{p.get('total_amount', 0):.2f}（{p.get('total_weight', 0):.1f}克）\n"
            
            # 业务员业绩
            salesperson_data = analytics.get("salesperson_performance", [])
            if salesperson_data:
                text += "\n--- 业务员业绩排行 ---\n"
                query_sp = analytics.get("query_salesperson")
                for sp in salesperson_data:
                    # 如果指定了业务员，只显示该业务员
                    if query_sp and query_sp not in sp.get('salesperson', ''):
                        continue
                    text += f"👔 {sp.get('salesperson', 'N/A')}：¥{sp.get('total_amount', 0):.2f}，{sp.get('order_count', 0)}单，{sp.get('total_weight', 0):.1f}克\n"
            
            text += "\n"
        
        return text
    
    def analyze(self, user_message: str, intent: str, data: Dict[str, Any]) -> str:
        """使用Claude AI进行智能分析和计算"""
        
        # 格式化数据
        data_text = self.format_data_for_ai(data)
        
        # 检查数据访问限制（与 analyze_stream 保持一致）
        context = data.get("context", {})
        data_restrictions = context.get("data_restrictions", [])
        restriction_hint = context.get("restriction_hint")
        user_role = context.get("user_role", "unknown")
        
        # 如果有数据限制，在数据文本前添加提示
        if data_restrictions:
            restriction_note = f"""
【数据访问说明】
当前用户角色：{user_role}
以下数据因权限限制未提供：{', '.join(data_restrictions)}
{f'提示：{restriction_hint}' if restriction_hint else ''}

如果用户询问了被限制的数据，请友好地告知用户权限情况，并建议联系相关部门。
---
"""
            data_text = restriction_note + data_text
        
        # 检查是否是查询入库单（RK开头）
        order_no = data.get("context", {}).get("order_no")
        is_specific_inbound_query = intent == "查询入库单" and order_no
        # 查询入库单列表（没有指定单号，但有日期或商品筛选）
        is_inbound_list_query = intent == "查询入库单" and not order_no
        
        # 检查是否是查询销售单（XS开头）
        sales_order_no = data.get("context", {}).get("sales_order_no")
        is_specific_sales_query = intent == "查询销售单" and sales_order_no
        
        # 构建AI提示词
        if is_specific_inbound_query:
            # 查询特定入库单的提示词
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询特定入库单的详细信息。

**用户问题：** {user_message}
**用户意图：** {intent}
**入库单号：** {order_no}

以下是系统数据库中的相关数据：

{data_text}

请基于这些数据，详细回答用户关于入库单 {order_no} 的问题。要求：

1. **详细展示**：完整展示该入库单的所有信息，包括：
   - 入库单号、创建时间、状态
   - 每个商品的详细信息：商品名称、重量(克)、克工费(元/克)、件数（如果有）、件工费（如果有）、供应商名称、总成本
   - 总重量、总成本
2. **格式清晰**：使用清晰的格式，便于阅读，每个商品一行，格式如下：
   • [商品名称]：[重量]克，克工费¥[克工费]/g，[如果有件数则显示：件数[件数]件，件工费¥[件工费]/件]，供应商：[供应商名称]，总成本¥[总成本]
3. **数据完整**：必须显示供应商名称，如果商品有件数和件工费，必须显示出来
4. **数据准确**：确保所有数据准确无误
5. **友好提示**：如果入库单不存在，友好地告知用户

**重要**：在回答的最后，必须添加一行隐藏标记（用于前端显示下载和打印按钮）：
如果入库单存在，添加：<!-- INBOUND_ORDER:[order_id]:[order_no] -->
其中 [order_id] 是入库单的ID（从数据中的 order_id 字段获取），[order_no] 是入库单号。

请用自然、专业的语言回答，直接展示入库单的详细信息。"""
        elif is_inbound_list_query:
            # 查询入库单列表的提示词（没有指定单号，按日期/商品筛选）
            inbound_filters = data.get("inbound_filters", {})
            filter_desc = []
            if inbound_filters.get("date_start"):
                filter_desc.append(f"日期从 {inbound_filters['date_start']}")
            if inbound_filters.get("date_end"):
                filter_desc.append(f"到 {inbound_filters['date_end']}")
            if inbound_filters.get("supplier"):
                filter_desc.append(f"供应商包含 {inbound_filters['supplier']}")
            if inbound_filters.get("product"):
                filter_desc.append(f"商品包含 {inbound_filters['product']}")
            filter_text = "，".join(filter_desc) if filter_desc else "最近的入库单"
            
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询入库单列表。

**用户问题：** {user_message}
**用户意图：** {intent}
**筛选条件：** {filter_text}

以下是系统数据库中符合条件的入库单数据：

{data_text}

请基于这些数据，详细列出符合条件的入库单明细。**必须按以下格式展示每个入库商品**：

格式要求（每个商品一行）：
• 【入库单号】商品名称：XX克，供应商：XXX，日期：YYYY-MM-DD

示例：
• 【RK123456】足金3D硬金吊坠：11克，供应商：环冠珠宝，日期：2026-01-19
• 【RK123456】足金3D硬金耳饰：22克，供应商：环冠珠宝，日期：2026-01-19
• 【RK789012】古法手镯：50克，供应商：金源珠宝，日期：2026-01-18

要求：
1. **入库单号必须显示**：每个商品前面都要显示它所属的入库单号
2. **供应商必须显示**：每个商品后面都要显示供应商名称
3. **日期必须显示**：每个商品后面都要显示入库日期（从入库单的创建时间获取）
4. **按入库单分组**：同一入库单的商品放在一起
5. **汇总统计**：最后给出总计（共X个入库单，X件商品，总重量Xg）

如果没有符合条件的入库单，友好地告知用户。"""
        elif is_specific_sales_query:
            # 查询特定销售单的提示词
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询特定销售单的详细信息。

**用户问题：** {user_message}
**用户意图：** {intent}
**销售单号：** {sales_order_no}

以下是系统数据库中的相关数据：

{data_text}

请基于这些数据，详细回答用户关于销售单 {sales_order_no} 的问题。要求：

1. **详细展示**：完整展示该销售单的所有信息（销售单号、客户名、业务员、销售日期、商品明细、总重量、总工费、状态等）
2. **格式清晰**：使用清晰的格式，便于阅读
3. **数据准确**：确保所有数据准确无误
4. **友好提示**：如果销售单不存在，友好地告知用户

请用自然、专业的语言回答，直接展示销售单的详细信息。注意：销售单号以XS开头，不要与入库单（RK开头）混淆。"""
        elif intent == "查询客户账务":
            # 查询客户账务的提示词
            customer_debt = data.get("customer_debt", {})
            customer_name = customer_debt.get("customer", {}).get("name", "未知客户")
            
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询客户的账务情况（欠款、欠料、存料等）。

**用户问题：** {user_message}
**用户意图：** {intent}
**查询客户：** {customer_name}

以下是系统数据库中查询到的客户账务数据：

{data_text}

请基于这些数据，用清晰友好的方式回答用户关于客户账务的问题。

**【重要：必须按以下格式展示，克重信息必须展示！】**

1. **查询时间段销售**（如用户查询"今天"，就显示今天的数据）：
   - ⚖️ **销售克重**：从 period_sales_weight 字段获取
   - 💰 **工费金额**：从 period_labor_cost 字段获取
   - 📦 **订单数量**：从 period_order_count 字段获取

2. **客户历史总览**（必须展示，不受日期限制的累计数据）：
   - ⚖️ **历史总销售克重**：从 total_sales_weight 字段获取（这是最重要的指标！）
   - 💰 **历史总工费金额**：从 total_labor_cost 字段获取
   - 🛒 **历史总购买次数**：从 order_count 字段获取
   - ⏱️ **最后购买时间**：从 last_purchase_time 字段获取
   - 🏆 **客户排名**：第x位 / 总客户数

3. **购买品类分布**（从 category_breakdown 数组获取）：
   - 列出前3-5个主要购买的品类
   - 每个品类必须包含：品类名称、**销售克重**、占比百分比、工费金额

4. **账务汇总**（必须根据系统提供的数据精确显示）：
   - 💰 **现金账户**：
     - cash_debt > 0：显示"欠款 ¥{cash_debt}"
     - cash_debt < 0：显示"预收款 ¥{abs(cash_debt)}"（客户有余额）
     - cash_debt = 0：显示"已结清 ✓"
   - 💎 **金料账户**：
     - net_gold > 0：显示"欠料 {net_gold}克"
     - net_gold < 0：显示"存料 {abs(net_gold)}克"（客户有存料）
     - net_gold = 0：显示"已结清 ✓"

**隐藏标记**（必须添加）：
如果找到了客户，在回答最后添加：<!-- CUSTOMER_DEBT:[customer_id]:[customer_name] -->

请用自然、专业且友好的语言回答。**克重信息是珠宝行业的核心指标，必须优先展示！必须严格按照系统提供的 cash_debt 和 net_gold 数值显示账务状态！**"""
        else:
            # 数据分析类 action（系统会自动生成图表，文字只需简洁结论）
            chart_analysis_actions = ["供应商分析", "查询库存", "库存分析", "销售分析"]
            is_chart_analysis = intent in chart_analysis_actions
            
            if is_chart_analysis:
                # 图表分析场景：输出简洁结论，图表展示详细数据
                prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答要求（系统将自动生成图表展示详细数据，你只需输出简洁的文字结论）：**

请提供简洁的分析结论，格式要求：

1. **核心发现**（2-3句话）
   - 最重要的数据洞察是什么？
   - 谁是排名第一的？占比多少？

2. **关键建议**（1-2句话）
   - 基于数据的简短建议

**重要规则：**
- 不要输出表格，系统会用图表展示
- 总字数控制在150字以内
- 重点突出核心结论和建议

请用简洁、专业的语言给出结论："""
                system_prompt = "你是珠宝ERP分析师。系统将自动生成可视化图表展示详细数据，你只需给出简洁的文字结论（150字以内），不要输出表格，重点是洞察和建议。"
            else:
                # 主动检测是否需要详细分析（不依赖AI判断）
                analysis_keywords = ['分析', '详细', '报告', '建议', '对比', '趋势', '为什么', '怎么样', '评估', '深度', '全面']
                needs_analysis = any(kw in user_message for kw in analysis_keywords)
                
                if needs_analysis:
                    # 用户明确要求分析，强制给出详细回答
                    prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答要求（用户明确要求分析，必须提供详细报告）：**

请提供全面的分析报告，包括以下内容：

1. **数据概览**
   - 总量、数量等关键指标
   - 核心数据汇总

2. **详细分析**
   - 分布情况（如有多个类别）
   - 排名/占比分析
   - 异常点或需要关注的地方

3. **趋势与洞察**
   - 数据变化趋势（如有历史数据）
   - 潜在问题或机会

4. **建议**
   - 基于数据的可行性建议
   - 需要采取的行动

请给出专业、全面、有价值的分析报告。可以使用表格、列表等格式使信息更清晰。"""
                    system_prompt = "你是珠宝ERP系统的专业数据分析师。用户明确要求分析，你必须提供详细、专业、全面的分析报告，包括数据概览、详细分析、趋势洞察和建议。不要给简短回答。"
                else:
                    # 简单查询，给简短回答
                    prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答规则（必须严格遵守）：**
这是一个简单查询，回答必须简洁：
- 50字以内
- 只给数字和关键信息
- 不要分析、不要建议、不要表格
- 直接回答问题

现在请简短回答："""
                    system_prompt = "你是珠宝ERP助手。这是简单查询，必须用50字以内直接回答，不要分析，不要建议，不要表格。"
        
        # 如果是订单查询，使用默认系统提示
        if 'system_prompt' not in locals():
            system_prompt = "你是珠宝ERP系统AI助手，请专业、准确地回答用户问题。"
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                max_tokens=2000,  # 降低token限制以加快响应
                temperature=0.3,  # 更确定性的回复，减少生成时间
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            ai_content = response.choices[0].message.content.strip()
            
            # 如果是入库单列表查询，在结果后自动添加导出标记
            if is_inbound_list_query and data.get("inbound_orders"):
                inbound_filters = data.get("inbound_filters", {})
                export_marker = f"\n\n<!-- EXPORT_INBOUND:{inbound_filters.get('date_start') or ''}:{inbound_filters.get('date_end') or ''}:{inbound_filters.get('supplier') or ''}:{inbound_filters.get('product') or ''} -->"
                ai_content += export_marker
            
            return ai_content
        except Exception as e:
            logger.error(f"AI分析失败: {e}", exc_info=True)
            return f"分析过程中出现错误：{str(e)}。请稍后重试。"
    
    def generate_chart_data(self, intent: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """根据意图和数据生成图表数据（仅在用户要求时调用）"""
        chart_result = {}
        
        # 供应商分析 - 生成柱状图和饼图
        if "供应商" in intent or "supplier" in intent.lower() or intent == "供应商分析":
            suppliers = data.get("suppliers", [])
            if suppliers:
                # 柱状图数据 - 按总工费和总重量对比
                chart_result["chart_data"] = {
                    "labels": [s["name"] for s in suppliers],
                    "datasets": [
                        {
                            "label": "总工费（元）",
                            "data": [s["total_cost"] for s in suppliers],
                            "backgroundColor": "rgba(54, 162, 235, 0.5)",
                        },
                        {
                            "label": "总重量（克）",
                            "data": [s["total_weight"] for s in suppliers],
                            "backgroundColor": "rgba(255, 99, 132, 0.5)",
                        }
                    ]
                }
                
                # 饼图数据（按总工费占比）
                chart_result["pie_data"] = {
                    "labels": [s["name"] for s in suppliers],
                    "datasets": [{
                        "data": [s["total_cost"] for s in suppliers],
                        "backgroundColor": [
                            "rgba(255, 99, 132, 0.5)",
                            "rgba(54, 162, 235, 0.5)",
                            "rgba(255, 206, 86, 0.5)",
                            "rgba(75, 192, 192, 0.5)",
                            "rgba(153, 102, 255, 0.5)",
                        ]
                    }]
                }
        
        # 库存分析 - 生成柱状图和饼图（包括生成图表意图）
        elif "库存" in intent or "inventory" in intent.lower() or intent == "查询库存" or "饼图" in intent or intent == "生成图表" or "图表" in intent:
            inventory = data.get("inventory", [])
            if inventory:
                # 定义渐变色调色板
                colors = [
                    "rgba(59, 130, 246, 0.7)",   # 蓝色
                    "rgba(16, 185, 129, 0.7)",   # 绿色
                    "rgba(245, 158, 11, 0.7)",   # 橙色
                    "rgba(239, 68, 68, 0.7)",    # 红色
                    "rgba(139, 92, 246, 0.7)",   # 紫色
                    "rgba(236, 72, 153, 0.7)",   # 粉色
                    "rgba(20, 184, 166, 0.7)",   # 青色
                    "rgba(251, 191, 36, 0.7)",   # 黄色
                    "rgba(99, 102, 241, 0.7)",   # 靛蓝色
                    "rgba(34, 197, 94, 0.7)",    # 浅绿色
                ]
                
                # 柱状图数据
                chart_result["chart_data"] = {
                    "labels": [inv["product_name"] for inv in inventory],
                    "datasets": [{
                        "label": "库存重量（克）",
                        "data": [inv["total_weight"] for inv in inventory],
                        "backgroundColor": colors[:len(inventory)],
                        "borderColor": [c.replace("0.7", "1") for c in colors[:len(inventory)]],
                        "borderWidth": 1,
                    }]
                }
                
                # 饼图/环形图数据（按库存占比）
                chart_result["pie_data"] = {
                    "labels": [inv["product_name"] for inv in inventory],
                    "datasets": [{
                        "data": [inv["total_weight"] for inv in inventory],
                        "backgroundColor": colors[:len(inventory)],
                        "borderColor": "#ffffff",
                        "borderWidth": 2,
                    }]
                }
        
        # 入库分析 - 从入库订单数据生成图表
        elif "入库" in intent or intent == "查询入库单" or intent == "统计分析":
            inbound_orders = data.get("inbound_orders", [])
            if inbound_orders:
                # 聚合各供应商数据
                supplier_stats = {}
                for order in inbound_orders:
                    for detail in order.get("details", []):
                        supplier = detail.get("supplier") or "未知供应商"
                        if supplier not in supplier_stats:
                            supplier_stats[supplier] = {"weight": 0, "cost": 0, "count": 0}
                        supplier_stats[supplier]["weight"] += detail.get("weight", 0) or 0
                        supplier_stats[supplier]["cost"] += detail.get("total_cost", 0) or 0
                        supplier_stats[supplier]["count"] += 1
                
                if supplier_stats:
                    # 按供货重量排序
                    sorted_suppliers = sorted(supplier_stats.items(), key=lambda x: x[1]["weight"], reverse=True)
                    labels = [s[0] for s in sorted_suppliers]
                    weights = [s[1]["weight"] for s in sorted_suppliers]
                    costs = [s[1]["cost"] for s in sorted_suppliers]
                    
                    # 定义渐变色调色板
                    colors = [
                        "rgba(201, 168, 108, 0.7)",   # 香槟金
                        "rgba(30, 58, 95, 0.7)",      # 深海蓝
                        "rgba(59, 130, 246, 0.7)",    # 蓝色
                        "rgba(16, 185, 129, 0.7)",    # 绿色
                        "rgba(245, 158, 11, 0.7)",    # 橙色
                        "rgba(239, 68, 68, 0.7)",     # 红色
                        "rgba(139, 92, 246, 0.7)",    # 紫色
                        "rgba(236, 72, 153, 0.7)",    # 粉色
                        "rgba(20, 184, 166, 0.7)",    # 青色
                        "rgba(251, 191, 36, 0.7)",    # 黄色
                    ]
                    
                    # 柱状图数据 - 供货重量和工费对比
                    chart_result["chart_data"] = {
                        "labels": labels,
                        "datasets": [
                            {
                                "label": "供货重量（克）",
                                "data": weights,
                                "backgroundColor": "rgba(201, 168, 108, 0.7)",
                                "borderColor": "rgba(201, 168, 108, 1)",
                                "borderWidth": 1,
                            },
                            {
                                "label": "总工费（元）",
                                "data": costs,
                                "backgroundColor": "rgba(30, 58, 95, 0.7)",
                                "borderColor": "rgba(30, 58, 95, 1)",
                                "borderWidth": 1,
                            }
                        ]
                    }
                    
                    # 饼图数据 - 供货重量占比
                    chart_result["pie_data"] = {
                        "labels": labels,
                        "datasets": [{
                            "data": weights,
                            "backgroundColor": colors[:len(labels)],
                            "borderColor": "#ffffff",
                            "borderWidth": 2,
                        }]
                    }
        
        return chart_result
    
    def analyze_stream(self, user_message: str, intent: str, data: Dict[str, Any], language: str = "zh"):
        """使用Claude AI进行流式分析和计算（生成器函数）
        
        Args:
            user_message: 用户消息
            intent: 意图
            data: 数据
            language: 语言 (zh/en)
        """
        
        # 格式化数据
        data_text = self.format_data_for_ai(data)
        
        # 语言相关的基础提示
        is_english = language == "en"
        
        # 检查数据访问限制（方案C：数据层过滤 + 智能提示）
        context = data.get("context", {})
        data_restrictions = context.get("data_restrictions", [])
        restriction_hint = context.get("restriction_hint")
        user_role = context.get("user_role", "unknown")
        
        # 如果有数据限制，在数据文本前添加提示
        if data_restrictions:
            restriction_note = f"""
【数据访问说明】
当前用户角色：{user_role}
以下数据因权限限制未提供：{', '.join(data_restrictions)}
{f'提示：{restriction_hint}' if restriction_hint else ''}

如果用户询问了被限制的数据，请友好地告知用户权限情况，并建议联系相关部门。
---
"""
            data_text = restriction_note + data_text
        
        # 检查是否是查询入库单（RK开头）或查询销售单（XS开头）
        order_no = data.get("context", {}).get("order_no")
        sales_order_no = data.get("context", {}).get("sales_order_no")
        is_specific_inbound_query = intent == "查询入库单" and order_no
        is_inbound_list_query = intent == "查询入库单" and not order_no
        is_specific_sales_query = intent == "查询销售单" and sales_order_no
        
        # 主动检测是否需要详细分析（不依赖AI判断）
        analysis_keywords = ['分析', '详细', '报告', '建议', '对比', '趋势', '为什么', '怎么样', '评估', '深度', '全面']
        needs_analysis = any(kw in user_message for kw in analysis_keywords)
        
        if is_specific_inbound_query:
            # 查询特定入库单的提示词（流式版本）
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询特定入库单的详细信息。

**用户问题：** {user_message}
**用户意图：** {intent}
**入库单号：** {order_no}

以下是系统数据库中的相关数据：

{data_text}

请基于这些数据，详细回答用户关于入库单 {order_no} 的问题。要求：

1. **详细展示**：完整展示该入库单的所有信息，包括：
   - 入库单号、创建时间、状态
   - 每个商品的详细信息：商品名称、重量(克)、克工费(元/克)、件数（如果有）、件工费（如果有）、供应商名称（必须显示）、总成本
   - 总重量、总件数（如果有）、总成本
2. **格式清晰**：使用清晰的格式，便于阅读，每个商品一行，格式如下：
   • [商品名称]：[重量]克，克工费¥[克工费]/g，[如果有件数则显示：件数[件数]件，件工费¥[件工费]/件]，供应商：[供应商名称]，总成本¥[总成本]
3. **数据完整**：必须显示供应商名称和克工费，如果商品有件数和件工费，必须显示出来
4. **数据准确**：确保所有数据准确无误
5. **友好提示**：如果入库单不存在，友好地告知用户

**重要**：在回答的最后，必须添加一行隐藏标记（用于前端显示下载和打印按钮）：
如果入库单存在，添加：<!-- INBOUND_ORDER:[order_id]:[order_no] -->
其中 [order_id] 是入库单的ID（从数据中的 order_id 字段获取），[order_no] 是入库单号。

请用自然、专业的语言回答，直接展示入库单的详细信息。"""
            system_prompt = "你是珠宝ERP系统AI助手，请专业、准确地回答用户问题。对于入库单查询，必须显示完整的商品信息，包括供应商名称、克工费、件数和件工费（如果有）。"
        elif is_inbound_list_query:
            # 查询入库单列表的提示词（流式版本 - 没有指定单号，按日期/商品筛选）
            inbound_filters = data.get("inbound_filters", {})
            filter_desc = []
            if inbound_filters.get("date_start"):
                filter_desc.append(f"日期从 {inbound_filters['date_start']}")
            if inbound_filters.get("date_end"):
                filter_desc.append(f"到 {inbound_filters['date_end']}")
            if inbound_filters.get("supplier"):
                filter_desc.append(f"供应商包含 {inbound_filters['supplier']}")
            if inbound_filters.get("product"):
                filter_desc.append(f"商品包含 {inbound_filters['product']}")
            filter_text = "，".join(filter_desc) if filter_desc else "最近的入库单"
            
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询入库单列表。

**用户问题：** {user_message}
**用户意图：** {intent}
**筛选条件：** {filter_text}

以下是系统数据库中符合条件的入库单数据：

{data_text}

请基于这些数据，详细列出符合条件的入库单明细。**必须按以下格式展示每个入库商品**：

格式要求（每个商品一行）：
• 【入库单号】商品名称：XX克，供应商：XXX，日期：YYYY-MM-DD

示例：
• 【RK123456】足金3D硬金吊坠：11克，供应商：环冠珠宝，日期：2026-01-19
• 【RK123456】足金3D硬金耳饰：22克，供应商：环冠珠宝，日期：2026-01-19
• 【RK789012】古法手镯：50克，供应商：金源珠宝，日期：2026-01-18

要求：
1. **入库单号必须显示**：每个商品前面都要显示它所属的入库单号
2. **供应商必须显示**：每个商品后面都要显示供应商名称
3. **日期必须显示**：每个商品后面都要显示入库日期（从入库单的创建时间获取）
4. **按入库单分组**：同一入库单的商品放在一起
5. **汇总统计**：最后给出总计（共X个入库单，X件商品，总重量Xg）

如果没有符合条件的入库单，友好地告知用户。"""
            system_prompt = "你是珠宝ERP系统AI助手。对于入库单列表查询，必须按要求格式展示每个商品，包括入库单号、克重、供应商名称和入库日期。"
        elif is_specific_sales_query:
            # 查询特定销售单的提示词（流式版本）
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询特定销售单的详细信息。

**用户问题：** {user_message}
**用户意图：** {intent}
**销售单号：** {sales_order_no}

以下是系统数据库中的相关数据：

{data_text}

请基于这些数据，详细回答用户关于销售单 {sales_order_no} 的问题。要求：

1. **详细展示**：完整展示该销售单的所有信息（销售单号、客户名、业务员、销售日期、商品明细、总重量、总工费、状态等）
2. **格式清晰**：使用清晰的格式，便于阅读
3. **数据准确**：确保所有数据准确无误
4. **友好提示**：如果销售单不存在，友好地告知用户

请用自然、专业的语言回答，直接展示销售单的详细信息。注意：销售单号以XS开头，不要与入库单（RK开头）混淆。"""
            system_prompt = "你是珠宝ERP系统AI助手，请专业、准确地回答用户问题。"
        elif intent == "查询客户账务":
            # 查询客户账务的提示词（流式版本）
            customer_debt = data.get("customer_debt", {})
            customer_name = customer_debt.get("customer", {}).get("name", "未知客户")
            
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询客户的账务情况（欠款、欠料、存料等）。

**用户问题：** {user_message}
**用户意图：** {intent}
**查询客户：** {customer_name}

以下是系统数据库中查询到的客户账务数据：

{data_text}

请基于这些数据，用清晰友好的方式回答用户关于客户账务的问题。

**【重要：必须按以下格式展示，克重信息必须展示！】**

1. **查询时间段销售**（如用户查询"今天"，就显示今天的数据）：
   - ⚖️ **销售克重**：从 period_sales_weight 字段获取
   - 💰 **工费金额**：从 period_labor_cost 字段获取
   - 📦 **订单数量**：从 period_order_count 字段获取

2. **客户历史总览**（必须展示，不受日期限制的累计数据）：
   - ⚖️ **历史总销售克重**：从 total_sales_weight 字段获取（这是最重要的指标！）
   - 💰 **历史总工费金额**：从 total_labor_cost 字段获取
   - 🛒 **历史总购买次数**：从 order_count 字段获取
   - ⏱️ **最后购买时间**：从 last_purchase_time 字段获取
   - 🏆 **客户排名**：第x位 / 总客户数

3. **购买品类分布**（从 category_breakdown 数组获取）：
   - 列出前3-5个主要购买的品类
   - 每个品类必须包含：品类名称、**销售克重**、占比百分比、工费金额

4. **账务汇总**（必须根据系统提供的数据精确显示）：
   - 💰 **现金账户**：
     - cash_debt > 0：显示"欠款 ¥{cash_debt}"
     - cash_debt < 0：显示"预收款 ¥{abs(cash_debt)}"（客户有余额）
     - cash_debt = 0：显示"已结清 ✓"
   - 💎 **金料账户**：
     - net_gold > 0：显示"欠料 {net_gold}克"
     - net_gold < 0：显示"存料 {abs(net_gold)}克"（客户有存料）
     - net_gold = 0：显示"已结清 ✓"

**隐藏标记**（必须添加）：
如果找到了客户，在回答最后添加：<!-- CUSTOMER_DEBT:[customer_id]:[customer_name] -->

请用自然、专业且友好的语言回答。**克重信息是珠宝行业的核心指标，必须优先展示！必须严格按照系统提供的 cash_debt 和 net_gold 数值显示账务状态！**"""
            system_prompt = "你是珠宝ERP系统AI助手，专门帮助用户查询客户账务信息。请以友好、清晰的方式回答。克重是珠宝行业最重要的指标，必须优先展示！必须严格按照系统提供的数值显示账务状态！"
        elif intent == "销售数据查询":
            # 销售数据查询的提示词
            sales_analytics = data.get("sales_analytics", {})
            query_type = sales_analytics.get("query_type", "summary")
            query_salesperson = sales_analytics.get("query_salesperson")
            
            prompt = f"""你是一个专业的珠宝ERP系统AI分析专家。用户要查询销售数据统计。

**用户问题：** {user_message}
**用户意图：** {intent}
**查询类型：** {query_type}
{f'**指定业务员：** {query_salesperson}' if query_salesperson else ''}

以下是系统数据库中查询到的销售分析数据：

{data_text}

请基于这些数据，用清晰友好的方式回答用户关于销售数据的问题。要求：

1. **关键指标展示**：
   - 💰 今日销售额：¥金额（订单数、环比变化）
   - 📊 本月销售额：¥金额（订单数、同比变化）
   - ⚖️ 销售克重：xx克

2. **排行榜**（根据查询类型）：
   - 🏆 热销商品TOP5（如果是top_products查询）
   - 👔 业务员业绩排行（如果是salesperson查询）

3. **对比分析**（如果是compare查询）：
   - 本月 vs 上月：变化率、增减情况

4. **友好总结**：
   - 简洁的业绩评价
   - 亮点或需要关注的地方

请用自然、专业且友好的语言回答，使用表情符号增强可读性。
金额格式：如果超过1万，用"万"为单位，如 ¥12.5万。"""
            system_prompt = "你是珠宝ERP系统AI助手，专门帮助用户分析销售数据。请以友好、清晰的方式回答，突出关键指标。"
        else:
            # 数据分析类 action（系统会自动生成图表，文字只需简洁结论）
            chart_analysis_actions = ["供应商分析", "查询库存", "库存分析", "销售分析"]
            is_chart_analysis = intent in chart_analysis_actions
            
            if is_chart_analysis:
                # 图表分析场景：输出简洁结论，图表展示详细数据
                prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答要求（系统将自动生成图表展示详细数据，你只需输出简洁的文字结论）：**

请提供简洁的分析结论，格式要求：

1. **核心发现**（2-3句话）
   - 最重要的数据洞察是什么？
   - 谁是排名第一的？占比多少？

2. **关键建议**（1-2句话）
   - 基于数据的简短建议

**重要规则：**
- 不要输出表格，系统会用图表展示
- 总字数控制在150字以内
- 重点突出核心结论和建议

请用简洁、专业的语言给出结论："""
                system_prompt = "你是珠宝ERP分析师。系统将自动生成可视化图表展示详细数据，你只需给出简洁的文字结论（150字以内），不要输出表格，重点是洞察和建议。"
            elif needs_analysis:
                # 用户明确要求分析，强制给出详细回答
                prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答要求（用户明确要求分析，必须提供详细报告）：**

请提供全面的分析报告，包括以下内容：

1. **数据概览**
   - 总量、数量等关键指标
   - 核心数据汇总

2. **详细分析**
   - 分布情况（如有多个类别）
   - 排名/占比分析
   - 异常点或需要关注的地方

3. **趋势与洞察**
   - 数据变化趋势（如有历史数据）
   - 潜在问题或机会

4. **建议**
   - 基于数据的可行性建议
   - 需要采取的行动

请给出专业、全面、有价值的分析报告。可以使用表格、列表等格式使信息更清晰。"""
                system_prompt = "你是珠宝ERP系统的专业数据分析师。用户明确要求分析，你必须提供详细、专业、全面的分析报告，包括数据概览、详细分析、趋势洞察和建议。不要给简短回答。"
            else:
                # 简单查询，给简短回答
                prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答规则（必须严格遵守）：**
这是一个简单查询，回答必须简洁：
- 50字以内
- 只给数字和关键信息
- 不要分析、不要建议、不要表格
- 直接回答问题
- **重要**：回答库存问题时，必须使用系统数据中标注的"库存位置"，不要随便说"总库存"

示例：
- 如果库存位置是"商品部仓库" → 答"商品部库存710克，包含2种商品。"
- 如果库存位置是"展厅" → 答"展厅库存710克，包含2种商品。"
- 如果库存位置是"全部仓位（总库存）" → 答"目前总库存710克，包含2种商品。"
- 问"有几个供应商" → 答"目前有3个供应商：金源珠宝、梵贝琳工厂、XX珠宝。"

现在请简短回答："""
                system_prompt = "你是珠宝ERP助手。这是简单查询，必须用50字以内直接回答，不要分析，不要建议，不要表格。"
        
        # 根据语言设置调整 system_prompt
        if is_english:
            # 英文模式：在 system_prompt 后追加英文输出要求
            system_prompt += "\n\nIMPORTANT: You MUST respond in English. This is a Jewelry ERP system. Translate all Chinese terms to English in your response."
        
        try:
            # 使用流式API（DeepSeek/OpenAI 格式）
            stream = self.client.chat.completions.create(
                model="deepseek-chat",
                max_tokens=3000,  # 恢复较高的token限制，避免截断
                temperature=0.3,  # 更确定性的回复，减少生成时间
                stream=True,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            # 流式发送每个文本块
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            
            # 如果是入库单列表查询，在流式输出完成后添加导出标记
            if is_inbound_list_query and data.get("inbound_orders"):
                inbound_filters = data.get("inbound_filters", {})
                export_marker = f"\n\n<!-- EXPORT_INBOUND:{inbound_filters.get('date_start') or ''}:{inbound_filters.get('date_end') or ''}:{inbound_filters.get('supplier') or ''}:{inbound_filters.get('product') or ''} -->"
                yield export_marker
                
        except Exception as e:
            logger.error(f"AI流式分析失败: {e}", exc_info=True)
            # 回退到非流式模式
            try:
                response = self.client.chat.completions.create(
                    model="deepseek-chat",
                    max_tokens=3000,  # 恢复较高的token限制，避免截断
                    temperature=0.3,  # 更确定性的回复，减少生成时间
                    messages=[
                        {
                            "role": "system",
                            "content": system_prompt
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ]
                )
                full_text = response.choices[0].message.content.strip()
                
                # 如果是入库单列表查询，添加导出标记
                if is_inbound_list_query and data.get("inbound_orders"):
                    inbound_filters = data.get("inbound_filters", {})
                    export_marker = f"\n\n<!-- EXPORT_INBOUND:{inbound_filters.get('date_start') or ''}:{inbound_filters.get('date_end') or ''}:{inbound_filters.get('supplier') or ''}:{inbound_filters.get('product') or ''} -->"
                    full_text += export_marker
                
                # 模拟流式：逐字符发送
                for char in full_text:
                    yield char
            except Exception as fallback_error:
                logger.error(f"AI回退分析也失败: {fallback_error}", exc_info=True)
                yield f"分析过程中出现错误：{str(e)}。请稍后重试。"

# 全局实例
ai_analyzer = AIAnalyzer()

