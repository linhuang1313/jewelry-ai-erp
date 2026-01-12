"""通用AI分析引擎 - 替代所有查询和分析函数"""
from anthropic import Anthropic
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from .models import (
    InboundOrder, InboundDetail, Inventory, 
    Customer, SalesOrder, SalesDetail, Supplier
)

logger = logging.getLogger(__name__)

class AIAnalyzer:
    """通用AI分析引擎 - 替代所有查询和分析函数"""
    
    def __init__(self):
        from dotenv import load_dotenv
        import os
        load_dotenv()
        self.client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    
    def collect_all_data(self, intent: str, user_message: str, db: Session, order_no: Optional[str] = None, sales_order_no: Optional[str] = None) -> Dict[str, Any]:
        """根据用户意图智能收集所有相关数据
        
        Args:
            intent: 用户意图
            user_message: 用户消息
            db: 数据库会话
            order_no: 入库单号（可选，RK开头，用于精确查询入库单）
            sales_order_no: 销售单号（可选，XS开头，用于精确查询销售单）
        """
        data = {
            "context": {
                "intent": intent,
                "user_message": user_message,
                "timestamp": datetime.now().isoformat(),
                "order_no": order_no,  # 入库单号
                "sales_order_no": sales_order_no  # 销售单号
            }
        }
        
        # 收集库存数据
        inventories = db.query(Inventory).all()
        data["inventory"] = [
            {
                "product_name": inv.product_name,
                "total_weight": inv.total_weight,
                "last_update": str(inv.last_update) if inv.last_update else None
            }
            for inv in inventories
        ]
        
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
        
        # 收集总体统计
        data["statistics"] = {
            "total_inventory_weight": float(db.query(func.sum(Inventory.total_weight)).scalar() or 0),
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
        text += f"总体统计：\n"
        text += f"- 商品种类：{stats.get('total_products', 0)}种\n"
        text += f"- 总库存：{stats.get('total_inventory_weight', 0):.2f}克\n"
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
                text += f"入库单号：{target_order['order_no']}\n"
                text += f"创建时间：{target_order.get('create_time', 'N/A')}\n"
                text += f"状态：{target_order.get('status', 'N/A')}\n"
                text += f"商品明细：\n"
                total_weight = 0
                total_cost = 0
                for idx, detail in enumerate(target_order.get('details', []), 1):
                    text += f"  {idx}. {detail['product_name']}：\n"
                    text += f"     - 重量：{detail['weight']}克\n"
                    text += f"     - 工费：{detail['labor_cost']}元/克\n"
                    text += f"     - 总成本：{detail['total_cost']:.2f}元\n"
                    if detail.get('supplier'):
                        text += f"     - 供应商：{detail['supplier']}\n"
                    total_weight += detail['weight']
                    total_cost += detail['total_cost']
                    text += "\n"
                text += f"总计：\n"
                text += f"  - 总重量：{total_weight:.2f}克\n"
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

1. **详细展示**：完整展示该入库单的所有信息（入库单号、创建时间、状态、商品明细、供应商、总重量、总成本等）
2. **格式清晰**：使用清晰的格式，便于阅读
3. **数据准确**：确保所有数据准确无误
4. **友好提示**：如果入库单不存在，友好地告知用户

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
            # 通用回答的提示词 - 根据问题复杂度调整回答长度
            prompt = f"""你是一个珠宝ERP系统AI助手。请根据用户问题的复杂程度来调整回答的详细程度。

**用户问题：** {user_message}
**用户意图：** {intent}

以下是系统数据库中的数据：

{data_text}

**回答策略（非常重要）：**

1. **简单查询 → 简短回答**：
   - 如果用户只是问"库存多少"、"有几个供应商"、"有多少客户"等简单问题
   - 只需给出直接的数字答案，1-3句话即可
   - 例如："目前总库存110克，包含古法戒指(100克)和古法手镯(10克)两种商品。"
   - 不要主动展开分析，不要给建议，不要生成表格

2. **分析请求 → 详细回答**：
   - 只有当用户明确要求"分析"、"深度分析"、"详细分析"、"对比"、"趋势"、"建议"时
   - 才提供详细的分析报告、表格、建议等

3. **判断问题复杂度的关键词**：
   - 简单问题关键词：多少、几个、有没有、是什么、查询、查一下
   - 分析问题关键词：分析、对比、趋势、建议、为什么、怎么样、评估、报告

**请严格遵守上述策略，不要过度解读用户意图。用户问简单问题时，就给简单答案。**"""
        
        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=4000,
                system="你是一个珠宝ERP系统AI助手。核心原则：回答要简洁精准，匹配问题的复杂度。简单问题给简短答案（1-3句话），只有用户明确要求分析时才给详细报告。不要过度解读，不要主动展开分析。",
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            return response.content[0].text.strip()
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
        
        # 构建AI提示词 - 根据问题复杂度调整回答
        prompt = f"""**用户问题：** {user_message}
**用户意图：** {intent}

**系统数据：**
{data_text}

**回答规则（必须严格遵守）：**

判断问题是否为简单查询：
- 简单查询关键词：多少、几个、有没有、是什么、查询、查一下、现在、目前
- 如果是简单查询，回答必须在50字以内，只给数字和关键信息，不要分析、不要建议、不要表格

示例：
- 问"库存多少" → 答"目前总库存110克，包含2种商品（古法戒指100克、手镯10克）。"
- 问"有几个供应商" → 答"目前有3个供应商：金源珠宝、梵贝琳工厂、XX珠宝。"
- 问"有多少客户" → 答"目前系统中有5个客户。"

只有当用户问题包含"分析"、"详细"、"报告"、"建议"、"对比"、"趋势"等词时，才给详细回答。

现在请回答用户的问题："""
        
        # 简化的系统提示
        system_prompt = "你是珠宝ERP助手。简单问题给简短答案（50字以内），只有用户要求分析时才给详细报告。"
        
        try:
            # 使用流式API
            with self.client.messages.stream(
                model="claude-sonnet-4-5-20250929",
                max_tokens=2000,
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            ) as stream:
                # 流式发送每个文本块
                for text_block in stream.text_stream:
                    yield text_block
        except AttributeError:
            # 如果不支持stream方法，使用普通模式并模拟流式
            logger.warning("Claude API不支持stream方法，使用普通模式并模拟流式")
            response = self.client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=2000,
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            full_text = response.content[0].text.strip()
            # 模拟流式：逐字符发送
            for char in full_text:
                yield char
        except Exception as e:
            logger.error(f"AI流式分析失败: {e}", exc_info=True)
            error_msg = f"分析过程中出现错误：{str(e)}。请稍后重试。"
            yield error_msg

# 全局实例
ai_analyzer = AIAnalyzer()

