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
    Location, LocationInventory
)

logger = logging.getLogger(__name__)

class AIAnalyzer:
    """通用AI分析引擎 - 使用 DeepSeek API"""
    
    def __init__(self):
        from dotenv import load_dotenv
        import os
        load_dotenv()
        # DeepSeek API 客户端（使用 OpenAI 兼容格式）
        self.client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com"
        )
    
    def collect_all_data(self, intent: str, user_message: str, db: Session, order_no: Optional[str] = None, sales_order_no: Optional[str] = None, user_role: str = "manager") -> Dict[str, Any]:
        """根据用户意图智能收集所有相关数据
        
        Args:
            intent: 用户意图
            user_message: 用户消息
            db: 数据库会话
            order_no: 入库单号（可选，RK开头，用于精确查询入库单）
            sales_order_no: 销售单号（可选，XS开头，用于精确查询销售单）
            user_role: 用户角色，决定显示哪个仓位的库存
        """
        data = {
            "context": {
                "intent": intent,
                "user_message": user_message,
                "timestamp": datetime.now().isoformat(),
                "order_no": order_no,  # 入库单号
                "sales_order_no": sales_order_no,  # 销售单号
                "user_role": user_role  # 用户角色
            }
        }
        
        # ========== 根据角色收集库存数据 ==========
        # 管理层：显示总库存
        # 商品专员：只显示商品部仓库库存
        # 柜台/结算：只显示展厅库存
        
        if user_role == "manager":
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
        
        # 收集供应商数据（从Supplier表）
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
        
        # 收集入库单数据
        inbound_orders = db.query(InboundOrder).order_by(desc(InboundOrder.create_time)).limit(50).all()
        data["inbound_orders"] = []
        for order in inbound_orders:
            details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
            data["inbound_orders"].append({
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
        
        # 收集客户数据
        customers = db.query(Customer).filter(Customer.status == "active").all()
        data["customers"] = [
            {
                "name": c.name,
                "phone": c.phone,
                "total_purchase_amount": c.total_purchase_amount,
                "total_purchase_count": c.total_purchase_count,
                "last_purchase_time": str(c.last_purchase_time) if c.last_purchase_time else None,
                "customer_type": c.customer_type
            }
            for c in customers
        ]
        
        # 收集销售单数据
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
        
        # 收集总体统计（根据角色计算库存总重量）
        # 库存总重量使用已收集的库存数据计算，这样就是角色对应仓位的库存
        inventory_total = sum(inv.get("total_weight", 0) for inv in data.get("inventory", []))
        
        data["statistics"] = {
            "total_inventory_weight": float(inventory_total),
            "inventory_location": data.get("inventory_location", "全部仓位"),
            "total_inbound_cost": float(db.query(func.sum(InboundDetail.total_cost)).scalar() or 0),
            "total_suppliers": len(data["suppliers"]),
            "total_customers": len(data["customers"]),
            "total_inbound_orders": db.query(func.count(InboundOrder.id)).scalar() or 0,
            "total_sales_orders": db.query(func.count(SalesOrder.id)).scalar() or 0,
            "total_products": len(data["inventory"])
        }
        
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
        
        # 库存详情
        if data.get("inventory"):
            text += f"=== 库存详情（共{len(data['inventory'])}种商品）===\n"
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
                text += f"   - 总购买金额：{customer['total_purchase_amount']:.2f}元\n"
                text += f"   - 购买次数：{customer['total_purchase_count']}次\n"
                if customer.get('last_purchase_time'):
                    text += f"   - 最后购买：{customer['last_purchase_time']}\n"
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
        
        return text
    
    def analyze(self, user_message: str, intent: str, data: Dict[str, Any]) -> str:
        """使用Claude AI进行智能分析和计算"""
        
        # 格式化数据
        data_text = self.format_data_for_ai(data)
        
        # 检查是否是查询入库单（RK开头）
        order_no = data.get("context", {}).get("order_no")
        is_specific_inbound_query = intent == "查询入库单" and order_no
        
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
                max_tokens=4000,
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
            
            return response.choices[0].message.content.strip()
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
        
        return chart_result
    
    def analyze_stream(self, user_message: str, intent: str, data: Dict[str, Any]):
        """使用Claude AI进行流式分析和计算（生成器函数）"""
        
        # 格式化数据
        data_text = self.format_data_for_ai(data)
        
        # 检查是否是查询入库单（RK开头）或查询销售单（XS开头）
        order_no = data.get("context", {}).get("order_no")
        sales_order_no = data.get("context", {}).get("sales_order_no")
        is_specific_inbound_query = intent == "查询入库单" and order_no
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

示例：
- 问"库存多少" → 答"目前总库存710克，包含2种商品（古法黄金戒指700克、古法黄金手镯10克）。"
- 问"有几个供应商" → 答"目前有3个供应商：金源珠宝、梵贝琳工厂、XX珠宝。"

现在请简短回答："""
            system_prompt = "你是珠宝ERP助手。这是简单查询，必须用50字以内直接回答，不要分析，不要建议，不要表格。"
        
        try:
            # 使用流式API（DeepSeek/OpenAI 格式）
            stream = self.client.chat.completions.create(
                model="deepseek-chat",
                max_tokens=2000,
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
        except Exception as e:
            logger.error(f"AI流式分析失败: {e}", exc_info=True)
            # 回退到非流式模式
            try:
                response = self.client.chat.completions.create(
                    model="deepseek-chat",
                    max_tokens=2000,
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
                # 模拟流式：逐字符发送
                for char in full_text:
                    yield char
            except Exception as fallback_error:
                logger.error(f"AI回退分析也失败: {fallback_error}", exc_info=True)
                yield f"分析过程中出现错误：{str(e)}。请稍后重试。"

# 全局实例
ai_analyzer = AIAnalyzer()

