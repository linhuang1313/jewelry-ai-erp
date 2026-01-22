import json
import os
import re
import logging
from typing import List, Optional
from openai import OpenAI
from dotenv import load_dotenv
from .schemas import AIResponse

load_dotenv()

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# DeepSeek API 客户端（使用 OpenAI 兼容格式）
# 延迟初始化，避免在环境变量未设置时导致启动失败
_client = None

def get_client():
    """获取 DeepSeek API 客户端（延迟初始化）"""
    global _client
    if _client is None:
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPSEEK_API_KEY 环境变量未设置，无法使用 AI 解析功能")
        _client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
    return _client

def parse_user_message(message: str, conversation_history: Optional[List[dict]] = None) -> AIResponse:
    """使用 DeepSeek API 解析用户自然语言输入，必须成功
    
    Args:
        message: 用户当前输入的消息
        conversation_history: 最近的对话历史，格式为 [{"role": "user/assistant", "content": "..."}]
    """
    
    # 构建上下文部分
    context_section = ""
    if conversation_history and len(conversation_history) > 0:
        context_section = """
=== 最近对话记录（用于理解上下文）===
"""
        for item in conversation_history[-5:]:  # 只取最近5条
            role_label = "用户" if item.get("role") == "user" else "系统"
            content = item.get("content", "")[:200]  # 限制长度
            context_section += f"{role_label}: {content}\n"
        context_section += """
=== 对话记录结束 ===

**重要**：请结合上面的对话记录理解用户当前的输入。
- 如果用户说"这个"、"刚才的"、"那个"等指代词，请从对话记录中找到对应的商品名称
- 如果用户刚入库了某个商品，然后说"转移到展厅"，需要理解是转移刚入库的那个商品
- 如果无法从上下文确定商品名称，transfer_product_name 可以设为 null，但要提取其他信息（如重量、目标位置）

"""
    
    prompt = f"""你是一个珠宝ERP系统的智能AI助手。你需要理解用户的自然语言输入，并提取相关信息。
{context_section}
用户当前输入：{message}

系统支持的功能：
1. **入库操作**：用户要进行商品入库
2. **查询库存**：查询商品库存信息
3. **查询供应商**：查询供应商相关信息（列表、数量等）
4. **供应商分析**：从多个维度分析哪个供应商最重要（总工费、总重量、商品种类、供货频次等）
5. **生成图表**：用户想要可视化展示数据（图表、图片、可视化等）
6. **查询入库单**：查询入库单信息
7. **统计分析**：各种统计查询
8. **客户管理**：创建/查询客户信息
9. **供应商管理**：创建/查询供应商信息
10. **销售管理**：创建/查询销售单
11. **库存转移**：将商品从一个位置转移到另一个位置（如从仓库转到展厅）
12. **退货操作**：用户要进行退货（退给供应商或退回商品部）
13. **查询客户账务**：查询客户的欠款、欠料、存料等财务信息（如"张老板的欠款情况"、"1月份的欠料"）
14. **登记收款**：财务登记客户收款（如"张老板收到5000元"、"李总打了3000块"、"收到王老板2000"）
15. **销售数据查询**：查询销售统计数据（如"今天卖了多少钱"、"这个月销售额"、"哪个商品卖得最好"、"业务员业绩排行"）
16. **收料**：客户交料（如"张老板交料5克"、"李老板存料3.5克足金9999"、"王总交了2克金料"）
17. **付料**：付料给供应商（如"付20克给金源珠宝"、"付料金源珠宝10克"、"给金源付5克"）
18. **批量转移**：按入库单号批量转移商品（如"把入库单RK123的商品转到展厅"、"RK123转移到展厅"）
19. **提料**：客户从存料中取走金料（如"张老板提5克"、"李总取料3克"、"王总提走2克金料"）
20. **闲聊**：用户的问候、寒暄、感谢、闲聊等非业务相关内容（如"你好"、"谢谢"、"早上好"、"1+1等于几"、"今天天气怎么样"等）

**⚠️ 谨慎识别原则（极其重要，减少幻觉）**：
- **宁可识别为"闲聊"，也不要错误猜测用户意图**
- 如果用户输入不包含明确的业务关键词（如商品名、重量、克数、供应商、客户名等），优先识别为"闲聊"
- 简短的问候语（如"你好"、"嗨"、"hi"、"hello"、"早上好"、"晚安"）→ 必须识别为"闲聊"
- 感谢语（如"谢谢"、"感谢"、"辛苦了"、"好的"、"收到"）→ 必须识别为"闲聊"
- 无关话题（如"今天天气怎么样"、"1+1等于几"、"讲个笑话"）→ 必须识别为"闲聊"
- **只有当用户输入包含明确的业务动词+业务实体时，才识别为业务操作**
  例如："查库存" 需要有 "库存/商品" 关键词，"入库" 需要有商品信息

**关键词优先级识别（非常重要）**：
- "退"、"退货"、"退给"、"退回"、"退库"、"我要退" → 优先识别为"退货"操作，而不是入库！
- "入"、"入库"、"帮我入" → 识别为"入库"操作
- 当同时出现"退"和其他信息时，必须识别为退货操作
- "退库"专门用于商品专员将商品退回给供应商，不需要销售记录

请返回JSON格式，包含以下字段：
- action: 用户意图，根据用户输入智能判断，可能是：
  - "入库"：用户要进行入库操作（包含商品、重量、工费等信息）
  - "查询库存"：用户要查询商品库存（如"查询XXX库存"、"XXX还有多少"、"帮我查一下我目前的库存"等）
  - "查询供应商"：用户要查询供应商信息（如"有几个供应商"、"供应商有哪些"、"供应商列表"、"我现在有几个供应商"等）
  - "供应商分析"：用户想知道"谁是最重要的供应商""核心供应商是谁"等，需要根据数据库中的供应商统计数据进行分析和排序
  - "生成图表"：用户想要可视化展示数据（如"生成图表"、"用图表展示"、"画个图"、"可视化"、"可以生成图片给我看吗"等）
  - "查询入库单"：用户要查询入库单信息，入库单号以RK开头（如"查询入库单"、"查询入库单RK1768047147249"、"入库单号RK1768047147249"等）
  - "统计分析"：用户要进行统计分析（如"总库存"、"总工费"、"统计"等）
  - "创建客户"：用户要创建新客户（如"新建客户：张三 电话13800138000"、"添加客户"等）
  - "查询客户"：用户要查询客户信息（如"查询客户张三"、"客户列表"、"有哪些客户"等）
  - "创建供应商"：用户要创建新供应商（如"新建供应商：XX公司 电话13800138000"、"添加供应商"等）
  - "创建销售单"：用户要创建销售单（包含客户、商品、工费、克重、业务员、门店代码等信息）
  - "查询销售单"：用户要查询销售单信息，销售单号以XS开头（如"查询销售单"、"XS20260111162534"、"查询销售单XS20260111162534"、"最近的销售单"、"张三的销售单"等）
  - "创建转移单"：用户要将商品从一个位置转移到另一个位置（如"帮我转移到展厅"、"把XXX从仓库转到展厅"、"转移100克到展厅"等）
  - "退货"：用户要进行退货操作（如"退货给金源珠宝"、"退给供应商"、"10克古法戒指退给金源珠宝"、"退回商品部"、"我要退库"、"退库10克古法戒指给金源珠宝"等）
  - "查询客户账务"：用户要查询客户的欠款、欠料、存料等财务信息（如"张老板的欠款情况"、"王总1月份的欠料"、"李老板1月1号到1月20号的账务"、"刘老板的存料余额"等）
  - "登记收款"：财务要登记客户收款（如"张老板收到5000元"、"李总打了3000块"、"收到王老板2000"、"测试客户1 收款8000"等）
  - "销售数据查询"：用户要查询销售统计数据（如"今天卖了多少钱"、"这个月销售额"、"本月业绩"、"哪个商品卖得最好"、"业务员业绩"、"销售排行"、"和上月比怎么样"等）
  - "收料"：客户交料/存料（如"张老板交料5克"、"李老板存料3.5克足金9999"、"王总交了2克金料"、"收张老板5克"等）
  - "付料"：付料给供应商（如"付20克给金源珠宝"、"付料金源珠宝10克"、"给金源付5克"等）
  - "批量转移"：按入库单号批量转移商品（如"把入库单RK123的商品转到展厅"、"RK123转移到展厅"等）
  - "提料"：客户从存料中取走金料（如"张老板提5克"、"李总取料3克"、"王总提走2克"、"给张老板提3克"等）
  - "闲聊"：用户的问候、寒暄、感谢、闲聊或与珠宝ERP业务无关的内容（如"你好"、"谢谢"、"早上好"、"1+1"、"今天天气"、"讲个笑话"等）
  - "其他"：无法识别的意图（当不确定时，优先选择"闲聊"而不是猜测业务意图）

**关于"退货"和"入库"的区分（极其重要）**：
- 用户说"退"、"退货"、"退给"、"退回"、"退库"、"我要退" → action必须是"退货"
- 用户说"入"、"入库"、"帮我入" → action必须是"入库"
- "退货给金源珠宝10克古法戒指 工费5元" → 这是退货，不是入库！
- "古法戒指100克 工费8元 供应商金源珠宝 入库" → 这才是入库
- "我要退库" → 这是退货操作的开始，需要提示用户提供商品名称、重量、供应商
- "退库10克古法戒指给金源珠宝" → 这是退货，action必须是"退货"

- order_no: 入库单号（字符串，仅当action为"查询入库单"且用户提供了RK开头的入库单号时需要，如"RK1768047147249"）
- sales_order_no: 销售单号（字符串，仅当action为"查询销售单"且用户提供了XS开头的销售单号时需要，如"XS20260111162534"）

- 入库单筛选字段（仅当action为"查询入库单"时使用）：
  - inbound_supplier: 按供应商筛选（如"查询金源珠宝的入库单"则为"金源珠宝"）
  - inbound_product: 按商品名称筛选（如"查询有古法戒指的入库单"则为"古法戒指"）
  - inbound_date_start: 入库单开始日期（YYYY-MM-DD格式，如"查询今天的入库单"则为今天日期）
  - inbound_date_end: 入库单结束日期（YYYY-MM-DD格式）

- products: 商品列表（数组，仅当action为"入库"时需要），每个商品包含：
  - product_name: 商品名称（必填）
  - weight: 重量/金重（克，必须是数字，必填）
  - labor_cost: 克工费（元/克，必须是数字，必填）
  - piece_count: 件数（整数，可选，如"10件"则为10）
  - piece_labor_cost: 件工费（元/件，可选，如"件工费5元"则为5）
  - supplier: 供应商（必填）
  
  **总工费计算公式**：总工费 = 克重 × 克工费 + 件数 × 件工费
  **示例**：100克 × 6元/克 + 10件 × 5元/件 = 600 + 50 = 650元

- customer_name: 客户姓名（当action为"创建客户"、"创建销售单"、"查询客户"、"查询销售单"时需要）
- supplier_name: 供应商名称（当action为"创建供应商"时需要）
- phone: 电话（当action为"创建客户"、"创建供应商"时可选）
- address: 地址（当action为"创建客户"、"创建供应商"时可选）
- contact_person: 联系人（当action为"创建供应商"时可选）
- supplier_type: 供应商类型（当action为"创建供应商"时可选，默认"个人"）
- salesperson: 业务员姓名（当action为"创建销售单"时需要）
- store_code: 门店代码（当action为"创建销售单"时可选）
- items: 商品明细列表（数组，仅当action为"创建销售单"时需要），每个商品包含：
  - product_name: 商品名称（必填）
  - weight: 克重（克，必须是数字，必填）
  - labor_cost: 工费（元/克，必须是数字，必填）
- order_date: 日期（当action为"创建销售单"时可选，格式：YYYY-MM-DD或YYYY-MM-DD HH:MM:SS）

- transfer_product_name: 要转移的商品名称（当action为"创建转移单"时需要，如果上下文中有刚入库的商品，使用该商品名称）
- transfer_weight: 要转移的重量（克，当action为"创建转移单"时需要）
- from_location: 发出位置（当action为"创建转移单"时可选，默认为"商品部仓库"）
- to_location: 目标位置（当action为"创建转移单"时需要，如"展厅"）

- debt_customer_name: 要查询账务的客户名称（当action为"查询客户账务"时必填，如"张老板"、"王总"等）
- debt_query_type: 查询类型（当action为"查询客户账务"时可选，默认"all"）
  - "all": 查询所有账务信息（欠款、欠料、存料）
  - "cash_debt": 只查询现金欠款
  - "gold_debt": 只查询金料欠款/欠料
  - "gold_deposit": 只查询存料余额
- date_start: 开始日期（当action为"查询客户账务"时可选，格式YYYY-MM-DD，如用户说"1月份"则为"2026-01-01"）
- date_end: 结束日期（当action为"查询客户账务"时可选，格式YYYY-MM-DD，如用户说"1月份"则为"2026-01-31"）

- payment_customer_name: 收款客户名称（当action为"登记收款"时必填，如"张老板"、"李总"、"测试客户1"等）
- payment_amount: 收款金额（当action为"登记收款"时必填，数字，单位元）
- payment_method: 收款方式（当action为"登记收款"时可选，可选值：转账/现金/微信/支付宝/刷卡，默认"转账"）
- payment_remark: 备注（当action为"登记收款"时可选）

- sales_query_type: 销售数据查询类型（当action为"销售数据查询"时需要），可选值：
  - "today": 查询今日销售额（如"今天卖了多少"）
  - "month": 查询本月销售额（如"这个月销售额"、"本月业绩"）
  - "compare": 对比分析（如"和上月比怎么样"）
  - "top_products": 热销商品排行（如"哪个商品卖得最好"、"销售排行"）
  - "salesperson": 业务员业绩（如"业务员业绩"、"张三业绩怎么样"）
  - "summary": 综合汇总（如"销售情况"、"业绩怎么样"）
- sales_query_days: 查询天数（当action为"销售数据查询"时可选，默认30天）
- sales_query_salesperson: 业务员姓名（当action为"销售数据查询"且查询特定业务员时需要）

- receipt_customer_name: 交料客户名称（当action为"收料"时必填，如"张老板"、"李总"等）
- receipt_gold_weight: 交料克重（当action为"收料"时必填，数字，单位克）
- receipt_gold_fineness: 成色（当action为"收料"时可选，默认"足金999"，可选值：足金999/足金9999/Au999/Au9999/18K/22K/其他）
- receipt_remark: 备注（当action为"收料"时可选）

- gold_payment_supplier: 付料供应商名称（当action为"付料"时必填，如"金源珠宝"、"深圳金源"等）
- gold_payment_weight: 付料克重（当action为"付料"时必填，数字，单位克）
- gold_payment_remark: 付料备注（当action为"付料"时可选）

- batch_transfer_order_no: 入库单号（当action为"批量转移"时必填，如"RK1768047147249"）
- batch_transfer_to_location: 目标位置（当action为"批量转移"时可选，如"展厅"、"商品部仓库"，默认"展厅"）

- withdrawal_customer_name: 提料客户名称（当action为"提料"时必填，如"张老板"、"李总"等）
- withdrawal_gold_weight: 提料克重（当action为"提料"时必填，数字，单位克）
- withdrawal_remark: 备注（当action为"提料"时可选）

重要提示：
1. **意图识别要灵活**：
   - "帮我入库"、"做个入库"、"入库"、"帮我做个入库" → action: "入库"
   - "查询库存"、"还有多少"、"库存情况"、"帮我查一下我目前的库存" → action: "查询库存"
   - "有几个供应商"、"供应商有哪些"、"供应商列表"、"供应商数量"、"我现在有几个供应商" → action: "查询供应商"
   - "谁是最重要的供应商"、"核心供应商"、"最重要的供应商"、"关键供应商" → action: "供应商分析"
   - "生成图表"、"用图表展示"、"画个图"、"可视化"、"可以生成图片给我看吗"、"给我看图表" → action: "生成图表"
   - "查询入库单"、"入库单号"、"最近的入库单" → action: "查询入库单"
   - "查询入库单RK1768047147249"、"入库单号RK1768047147249"、"帮我查一下入库单RK1768047147249"、"入库单RK1768047147249的详情"、"RK1768047147249"（RK开头的单号） → action: "查询入库单"，并提取order_no字段
   - "查询销售单XS20260111162534"、"销售单号XS20260111162534"、"XS20260111162534"、"XS20260111162534 查询"（XS开头的单号） → action: "查询销售单"，并提取sales_order_no字段
   - "总库存"、"总工费"、"统计"、"统计信息" → action: "统计分析"
   - "新建客户"、"创建客户"、"添加客户"、"客户：XXX" → action: "创建客户"
   - "查询客户"、"客户列表"、"有哪些客户"、"客户信息" → action: "查询客户"
   - "新建供应商"、"创建供应商"、"添加供应商"、"供应商：XXX" → action: "创建供应商"
   - "开销售单"、"创建销售单"、"销售单"、"开单" → action: "创建销售单"
   - "查询销售单"、"销售单列表"、"最近的销售单" → action: "查询销售单"
   - "转移到展厅"、"帮我转移到展厅"、"这个100克帮我转到展厅"、"把刚才的商品转到展厅"、"从仓库转到展厅" → action: "创建转移单"
   - "我要退库"、"退库"、"退给供应商"、"退货给金源珠宝"、"退库10克古法戒指给金源珠宝" → action: "退货"
   - "张老板的欠款"、"王总欠了多少"、"李老板的存料"、"刘老板1月份欠料情况"、"客户欠款查询"、"查一下张三的账务" → action: "查询客户账务"
   - "张老板收到5000元"、"李总打了3000块"、"收到王老板2000"、"测试客户1 收款8000"、"张老板付了5000" → action: "登记收款"
   - "付20克给金源珠宝"、"给金源付5克"、"付料金源珠宝10克" → action: "付料"
   - "把入库单RK123的商品转到展厅"、"RK123转移到展厅"、"把RK123的商品全部转移" → action: "批量转移"
   - "今天卖了多少"、"这个月销售额"、"本月业绩"、"哪个商品卖得最好"、"业务员业绩排行"、"销售排行"、"和上月比怎么样"、"张三业绩怎么样" → action: "销售数据查询"

2. **入库操作必填字段**（仅当action为"入库"时）：
   - product_name（商品名称）
   - weight（重量/金重，单位：克，必须>0）
   - labor_cost（工费，单位：元/克，必须≥0）
   - supplier（供应商）

3. **供应商智能识别（极其重要）**：
   - 用户输入的第一个词通常是**供应商名称**，后面才是商品信息
   - 常见供应商命名规则：包含"珠宝"、"金"、"首饰"、"饰品"、"工厂"、"贸易"等词汇的通常是供应商
   - 即使不带"供应商"三个字，也要智能识别
   - 输入格式举例：
     * "[供应商名] [商品名/编码] [重量] [工费] 入库"
     * "[供应商名] 入库 [商品名] [重量] [工费]"
   - 示例解析：
     * "测试珠宝 3DDZ 入库100克 工费10元/g" → supplier: "测试珠宝", product_name: "3DDZ", weight: 100, labor_cost: 10
     * "金源珠宝 古法戒指 50克 8元 入库" → supplier: "金源珠宝", product_name: "古法戒指", weight: 50, labor_cost: 8
     * "华记金行 GFJZ 200克 工费5元/克 帮我入库" → supplier: "华记金行", product_name: "GFJZ", weight: 200, labor_cost: 5
   - **识别优先级**：
     1. 如果有明确标记（如"供应商是XXX"、"供应商：XXX"），使用明确标记的值
     2. 如果没有明确标记，第一个包含"珠宝/金/首饰/饰品/工厂/贸易/公司"的词作为供应商
     3. 如果以上都不匹配，第一个中文词组（在商品编码/重量/工费之前）可能是供应商名

4. **智能提取信息**：
   - 如果用户说"8元 100克"，理解为工费8元/克，重量100克
   - 如果用户说"工费8元，100克"，也是工费8元/克，重量100克
   - 如果用户说"第一行是...，第二行是..."，解析为多个商品
   - 如果多个商品共享同一供应商，每个商品都要包含supplier
   
   **件数和件工费识别（重要）**：
   - "10件"、"5件"等 → piece_count: 10 或 5
   - "件工费5元"、"件工5元"、"5元/件" → piece_labor_cost: 5
   - 如果用户没有提到件数或件工费，这两个字段设为 null
   - 示例："古法吊坠 10件 100克 工费6元 件工费5元" → piece_count: 10, piece_labor_cost: 5, weight: 100, labor_cost: 6
   
   **多商品入库识别（非常重要）**：
   - 当用户输入中包含多组"重量+工费"数据时，应识别为多个商品
   - 例如："古法吊坠 100克 6元 250g 3.5元" → 两个商品：(100克,6元) 和 (250g,3.5元)
   - 每组重量和工费必须正确配对，不要把第一个商品的工费应用到第二个商品
   - 如果第二个商品没有明确名称，使用"商品"作为默认名称
   - 逗号、顿号、数字序号(1. 2. 3.)都是商品分隔的标志
   - 识别模式：商品名 + 重量 + 工费 → 一个商品；遇到新的重量+工费组合 → 新商品
   - **重要**：所有商品必须填写相同的supplier字段（从用户输入中提取）
   - 例如："古法吊坠100克6元，古法手镯250克3.5元，供应商金源珠宝" → 两个商品都要设置 supplier: "金源珠宝"

5. **订单号前缀识别**（非常重要）：
   - **RK开头** 的单号是入库单号，如 "RK1768047147249" → action: "查询入库单"，order_no: "RK1768047147249"
   - **XS开头** 的单号是销售单号，如 "XS20260111162534" → action: "查询销售单"，sales_order_no: "XS20260111162534"
   - 当用户只输入一个单号时，必须根据前缀判断是入库单还是销售单
   - 不要混淆：XS开头绝对不是入库单，RK开头绝对不是销售单

6. **供应商相关意图识别**：
   - 当用户使用"最重要 / 核心 / 关键 / top / 最大 / 最重要的供应商 / 核心供应商 / 谁对我最重要 / 谁是我最依赖的供应商"等表述时，请将 action 设置为 "供应商分析"
   - 当用户只是想知道"有几个供应商 / 列出所有供应商 / 供应商列表"等，不涉及"最重要/核心"这类比较时，才使用 "查询供应商"

7. **上下文追问识别**（非常重要）：
   - 当用户使用"哪X种"、"有哪些"、"列出所有"、"具体是哪些"、"哪几个"、"都有什么"、"分别是谁"、"分别是哪些"、"分别是什么"等追问时，需要根据上下文判断：
     * 如果涉及"商品"、"库存"、"种类"、"种商品" → action: "查询库存"
     * 如果涉及"供应商"、"哪几个供应商"、"供应商分别是谁" → action: "查询供应商"
     * 如果涉及"客户"、"哪几个客户"、"客户分别是谁" → action: "查询客户"
   - **特别重要**：当用户单独说"哪七种"、"哪几种"、"哪几个"、"有哪些"、"具体是哪些"、"分别是谁"、"分别是哪些"等简短追问时：
     * 如果包含"种"字（如"哪七种"、"哪几种"、"有几种"），通常是指商品种类，应该识别为 action: "查询库存"
     * 如果包含"供应商"，应该识别为 action: "查询供应商"
     * 如果包含"客户"，应该识别为 action: "查询客户"
     * **如果用户说"分别是谁"、"分别是哪些"，且之前的问题涉及供应商（如"有几个供应商"），应该识别为 action: "查询供应商"**
     * **如果用户说"分别是谁"、"分别是哪些"，且之前的问题涉及客户（如"有几个客户"），应该识别为 action: "查询客户"**
     * **如果用户说"分别是谁"、"分别是哪些"，且之前的问题涉及商品/库存（如"有几种商品"），应该识别为 action: "查询库存"**
     * 如果没有任何上下文线索，但使用了"种"字，默认识别为 action: "查询库存"（因为库存查询是最常见的）
   - 特别提示：
     * "哪七种"、"哪几种"、"有几种"、"有哪些商品"、"列出所有库存"、"具体是哪些商品"、"分别是哪些商品" → action: "查询库存"
     * "哪几个供应商"、"供应商有哪些"、"列出所有供应商"、"供应商分别是谁"、"分别是谁"（在供应商相关对话后） → action: "查询供应商"
     * "哪几个客户"、"客户有哪些"、"列出所有客户"、"客户分别是谁" → action: "查询客户"
   - 当用户使用数字+"种"、"个"等量词追问时（如"哪七种"、"哪几个"），通常是想要查看详细列表，应该识别为相应的查询操作

8. **如果信息不完整**：
   - 对于入库操作，如果缺少必填字段，设为null
   - 对于查询操作，products设为null

只返回JSON，不要其他文字。

示例1（单个商品入库）：
用户输入："古法戒指 100克 工费8元 供应商是金源珠宝，帮我做个入库"
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法戒指",
      "weight": 100,
      "labor_cost": 8,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例1-智能供应商识别（不带"供应商"三个字）：
用户输入："测试珠宝 3DDZ 入库100克 工费10元/g"
解析说明：第一个词"测试珠宝"包含"珠宝"，应识别为供应商；"3DDZ"是商品编码/名称
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "3DDZ",
      "weight": 100,
      "labor_cost": 10,
      "supplier": "测试珠宝"
    }}
  ]
}}

示例1-智能供应商识别2：
用户输入："金源珠宝 古法戒指 50克 8元 入库"
解析说明："金源珠宝"是供应商，"古法戒指"是商品名
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法戒指",
      "weight": 50,
      "labor_cost": 8,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例1a（带件数和件工费的入库）：
用户输入："古法吊坠 10件 100克 工费6元 件工费5元 供应商是金源珠宝，帮我做个入库"
解析说明：用户输入了件数(10件)和件工费(5元/件)，总工费 = 100克×6元 + 10件×5元 = 600+50 = 650元
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法吊坠",
      "weight": 100,
      "labor_cost": 6,
      "piece_count": 10,
      "piece_labor_cost": 5,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例1b（多个商品入库，不同工费）：
用户输入："古法吊坠 100克 工费6元 250g 3.5元 供应商是金源珠宝，帮我做个入库"
解析说明：用户输入了两组数据（100克6元 和 250g3.5元），应识别为两个商品，第二个商品名称未指定时使用"商品"
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法吊坠",
      "weight": 100,
      "labor_cost": 6,
      "supplier": "金源珠宝"
    }},
    {{
      "product_name": "商品",
      "weight": 250,
      "labor_cost": 3.5,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例1c（多个商品入库，逗号分隔带名称）：
用户输入："古法吊坠100克6元，古法手镯250克3.5元，供应商金源珠宝，入库"
解析说明：两个商品分别是"古法吊坠"和"古法手镯"，各有不同的重量和工费，必须分别识别
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法吊坠",
      "weight": 100,
      "labor_cost": 6,
      "supplier": "金源珠宝"
    }},
    {{
      "product_name": "古法手镯",
      "weight": 250,
      "labor_cost": 3.5,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例1d（多个商品入库，序号列出）：
用户输入："帮我入库：1.古法手镯100克8元 2.精品戒指50克6元 3.3D吊坠30克12元，供应商都是鑫韵"
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法手镯",
      "weight": 100,
      "labor_cost": 8,
      "supplier": "鑫韵"
    }},
    {{
      "product_name": "精品戒指",
      "weight": 50,
      "labor_cost": 6,
      "supplier": "鑫韵"
    }},
    {{
      "product_name": "3D吊坠",
      "weight": 30,
      "labor_cost": 12,
      "supplier": "鑫韵"
    }}
  ]
}}

示例1d（多个商品入库，逗号分隔）：
用户输入："古法吊坠100克6元，古法手镯250克3.5元，供应商金源珠宝，入库"
{{
  "action": "入库",
  "products": [
    {{
      "product_name": "古法吊坠",
      "weight": 100,
      "labor_cost": 6,
      "supplier": "金源珠宝"
    }},
    {{
      "product_name": "古法手镯",
      "weight": 250,
      "labor_cost": 3.5,
      "supplier": "金源珠宝"
    }}
  ]
}}

示例2（查询库存）：
用户输入："查询古法戒指库存"
{{
  "action": "查询库存",
  "products": null
}}

示例3（查询供应商）：
用户输入："我现在有几个供应商"
{{
  "action": "查询供应商",
  "products": null
}}

示例4（供应商分析）：
用户输入："谁是我最重要的供应商？"
{{
  "action": "供应商分析",
  "products": null
}}

示例4（查询所有库存）：
用户输入："帮我查一下我目前的库存"
{{
  "action": "查询库存",
  "products": null
}}

示例5（统计分析）：
用户输入："总库存是多少"
{{
  "action": "统计分析",
  "products": null
}}

示例6（创建客户）：
用户输入："新建客户：张三 电话13800138000"
{{
  "action": "创建客户",
  "customer_name": "张三",
  "phone": "13800138000",
  "products": null
}}

示例7（查询客户）：
用户输入："查询客户张三"
{{
  "action": "查询客户",
  "customer_name": "张三",
  "products": null
}}

示例8（创建销售单）：
用户输入："开销售单：今天，客户张三，古法戒指 50克 工费10元/克，业务员李四，门店代码001"
{{
  "action": "创建销售单",
  "customer_name": "张三",
  "salesperson": "李四",
  "store_code": "001",
  "order_date": "2024-01-01",
  "items": [
    {{
      "product_name": "古法戒指",
      "weight": 50,
      "labor_cost": 10
    }}
  ],
  "products": null
}}

示例9（查询销售单）：
用户输入："查询最近张三的销售单"
{{
  "action": "查询销售单",
  "customer_name": "张三",
  "products": null
}}

示例10（上下文追问 - 查询库存）：
用户输入："哪七种"
说明：用户问"哪七种"，虽然没有明确说"商品"或"库存"，但"种"字通常指商品种类，应该识别为查询库存
{{
  "action": "查询库存",
  "products": null
}}

示例10-1（上下文追问 - 查询库存）：
用户输入："具体是哪些"
说明：用户问"具体是哪些"，虽然没有明确上下文，但这是常见的追问方式，通常指商品，应该识别为查询库存
{{
  "action": "查询库存",
  "products": null
}}

示例11（上下文追问 - 查询供应商）：
用户输入："哪几个供应商"
{{
  "action": "查询供应商",
  "products": null
}}

示例12（上下文追问 - 查询客户）：
用户输入："客户有哪些"
{{
  "action": "查询客户",
  "products": null
}}

示例13（上下文追问 - 查询供应商 - "分别是谁"）：
用户输入："分别是谁"
说明：用户问"分别是谁"，这是对"有几个供应商"或类似供应商相关问题的追问，应该识别为查询供应商
{{
  "action": "查询供应商",
  "products": null
}}

示例14（上下文追问 - 查询供应商 - "分别是哪些"）：
用户输入："分别是哪些"
说明：用户问"分别是哪些"，这是对供应商相关问题的追问，应该识别为查询供应商
{{
  "action": "查询供应商",
  "products": null
}}

示例15（查询入库单 - 带入库单号）：
用户输入："查询入库单RK1768047147249"
说明：用户明确提供了入库单号，应该识别为查询入库单，并提取入库单号
{{
  "action": "查询入库单",
  "order_no": "RK1768047147249",
  "products": null
}}

示例16（查询入库单 - 入库单号单独输入）：
用户输入："RK1768047147249"
说明：用户只输入了入库单号，应该识别为查询入库单
{{
  "action": "查询入库单",
  "order_no": "RK1768047147249",
  "products": null
}}

示例17（查询入库单 - 自然语言描述）：
用户输入："帮我查一下入库单号RK1768047147249的详情"
说明：用户用自然语言描述要查询入库单，应该识别为查询入库单，并提取入库单号
{{
  "action": "查询入库单",
  "order_no": "RK1768047147249",
  "products": null
}}

示例18（查询入库单 - 不指定入库单号）：
用户输入："查询入库单"
说明：用户要查询入库单，但没有指定具体的入库单号，应该识别为查询入库单，order_no设为null
{{
  "action": "查询入库单",
  "order_no": null,
  "products": null
}}

示例18-1（查询入库单 - 按供应商筛选）：
用户输入："查询金源珠宝的入库单"
说明：用户要查询特定供应商的入库单，提取供应商名称
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_supplier": "金源珠宝",
  "products": null
}}

示例18-2（查询入库单 - 按日期筛选-今天）：
用户输入："查询今天的入库单"
说明：用户要查询今天的入库单，inbound_date_start和inbound_date_end都设为今天的日期
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_date_start": "2026-01-19",
  "inbound_date_end": "2026-01-19",
  "products": null
}}

示例18-3（查询入库单 - 按日期筛选-本周）：
用户输入："查询本周的入库单"
说明：用户要查询本周的入库单，计算本周的开始和结束日期
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_date_start": "2026-01-13",
  "inbound_date_end": "2026-01-19",
  "products": null
}}

示例18-4（查询入库单 - 按商品筛选）：
用户输入："查询有古法戒指的入库单"
说明：用户要查询包含特定商品的入库单，提取商品名称关键词
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_product": "古法戒指",
  "products": null
}}

示例18-5（查询入库单 - 组合筛选：供应商+日期）：
用户输入："查询本周金源珠宝的入库单"
说明：用户要查询特定时间段和供应商的入库单，同时提取日期和供应商
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_supplier": "金源珠宝",
  "inbound_date_start": "2026-01-13",
  "inbound_date_end": "2026-01-19",
  "products": null
}}

示例18-5-2（查询入库单 - 组合筛选：商品+日期）：
用户输入："今天所有的足金3D硬金吊坠的入库明细"
说明：用户要查询今天入库的特定商品，同时提取日期和商品名称
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_product": "足金3D硬金吊坠",
  "inbound_date_start": "2026-01-19",
  "inbound_date_end": "2026-01-19",
  "products": null
}}

示例18-5-3（查询入库单 - 组合筛选：商品+供应商+日期）：
用户输入："本周金源珠宝的古法手镯入库"
说明：用户要查询特定时间段、供应商和商品的入库单
{{
  "action": "查询入库单",
  "order_no": null,
  "inbound_supplier": "金源珠宝",
  "inbound_product": "古法手镯",
  "inbound_date_start": "2026-01-13",
  "inbound_date_end": "2026-01-19",
  "products": null
}}

示例18-6（查询入库单 - 最近的入库单）：
用户输入："最近的入库单"
说明：用户要查询最近的入库单列表
{{
  "action": "查询入库单",
  "order_no": null,
  "products": null
}}

示例19（查询销售单 - 带销售单号）：
用户输入："查询销售单XS20260111162534"
说明：用户明确提供了XS开头的销售单号，应该识别为查询销售单，并提取sales_order_no
{{
  "action": "查询销售单",
  "sales_order_no": "XS20260111162534",
  "products": null
}}

示例20（查询销售单 - 销售单号单独输入）：
用户输入："XS20260111162534"
说明：用户只输入了XS开头的销售单号，应该识别为查询销售单
{{
  "action": "查询销售单",
  "sales_order_no": "XS20260111162534",
  "products": null
}}

示例21（查询销售单 - 自然语言描述）：
用户输入："帮我查一下销售单号XS20260111162534的详情"
说明：用户用自然语言描述要查询销售单，应该识别为查询销售单，并提取sales_order_no
{{
  "action": "查询销售单",
  "sales_order_no": "XS20260111162534",
  "products": null
}}

示例22（查询销售单 - 带查询字样）：
用户输入："XS20260111162534 查询"
说明：用户输入了XS开头的销售单号加查询，应该识别为查询销售单
{{
  "action": "查询销售单",
  "sales_order_no": "XS20260111162534",
  "products": null
}}

示例23（创建转移单 - 基本转移）：
用户输入："帮我转移100克古法戒指到展厅"
说明：用户要将商品转移到展厅，应该识别为创建转移单
{{
  "action": "创建转移单",
  "transfer_product_name": "古法戒指",
  "transfer_weight": 100,
  "from_location": "商品部仓库",
  "to_location": "展厅",
  "products": null
}}

示例24（创建转移单 - 上下文转移）：
用户输入："这个100克帮我转移到展厅"
说明：用户说"这个"，需要从上下文中理解指的是哪个商品。如果上下文中刚入库了"古法黄金戒指"100克，则应该识别为转移该商品
{{
  "action": "创建转移单",
  "transfer_product_name": null,
  "transfer_weight": 100,
  "from_location": "商品部仓库",
  "to_location": "展厅",
  "products": null
}}

示例25（创建转移单 - 简单转移）：
用户输入："从仓库转50克到展厅"
说明：用户要从仓库转移商品到展厅
{{
  "action": "创建转移单",
  "transfer_product_name": null,
  "transfer_weight": 50,
  "from_location": "商品部仓库",
  "to_location": "展厅",
  "products": null
}}

示例26（退货 - 退给供应商）：
用户输入："退货给金源珠宝10克古法戒指 工费5元"
说明：用户要退货给供应商，注意这是"退货"不是"入库"！关键词是"退货给"
{{
  "action": "退货",
  "product_name": "古法戒指",
  "weight": 10,
  "labor_cost": 5,
  "supplier": "金源珠宝",
  "products": null
}}

示例27（退货 - 退给供应商简写）：
用户输入："10克古法戒指退给金源珠宝"
说明：用户要退货给供应商，"退给"是退货关键词
{{
  "action": "退货",
  "product_name": "古法戒指",
  "weight": 10,
  "supplier": "金源珠宝",
  "products": null
}}

示例28（退货 - 退回商品部）：
用户输入："退回商品部 古法手镯 50克"
说明：从展厅退回商品部
{{
  "action": "退货",
  "product_name": "古法手镯",
  "weight": 50,
  "to_location": "商品部仓库",
  "products": null
}}

示例29（查询客户账务 - 基本查询）：
用户输入："张老板的欠款情况"
说明：用户要查询张老板的账务信息，识别客户名称
{{
  "action": "查询客户账务",
  "debt_customer_name": "张老板",
  "debt_query_type": "all",
  "date_start": null,
  "date_end": null,
  "products": null
}}

示例30（查询客户账务 - 指定月份）：
用户输入："王总1月份的欠料"
说明：用户要查询王总1月份的欠料情况，需要计算1月份的日期范围
{{
  "action": "查询客户账务",
  "debt_customer_name": "王总",
  "debt_query_type": "gold_debt",
  "date_start": "2026-01-01",
  "date_end": "2026-01-31",
  "products": null
}}

示例31（查询客户账务 - 指定日期范围）：
用户输入："李老板1月1号到1月20号的账务情况"
说明：用户明确指定了日期范围
{{
  "action": "查询客户账务",
  "debt_customer_name": "李老板",
  "debt_query_type": "all",
  "date_start": "2026-01-01",
  "date_end": "2026-01-20",
  "products": null
}}

示例32（查询客户账务 - 查询存料）：
用户输入："查一下刘老板的存料余额"
说明：用户要查询客户的存料余额
{{
  "action": "查询客户账务",
  "debt_customer_name": "刘老板",
  "debt_query_type": "gold_deposit",
  "date_start": null,
  "date_end": null,
  "products": null
}}

示例33（查询客户账务 - 查询欠款）：
用户输入："陈总欠了多少钱"
说明：用户要查询客户的现金欠款
{{
  "action": "查询客户账务",
  "debt_customer_name": "陈总",
  "debt_query_type": "cash_debt",
  "date_start": null,
  "date_end": null,
  "products": null
}}

示例34（销售数据查询 - 今日销售）：
用户输入："今天卖了多少钱"
说明：用户要查询今日销售额
{{
  "action": "销售数据查询",
  "sales_query_type": "today",
  "products": null
}}

示例35（销售数据查询 - 本月业绩）：
用户输入："这个月销售额多少"
说明：用户要查询本月销售额
{{
  "action": "销售数据查询",
  "sales_query_type": "month",
  "products": null
}}

示例36（销售数据查询 - 热销商品）：
用户输入："哪个商品卖得最好"
说明：用户要查询热销商品排行
{{
  "action": "销售数据查询",
  "sales_query_type": "top_products",
  "products": null
}}

示例37（销售数据查询 - 业务员业绩）：
用户输入："业务员业绩排行"
说明：用户要查询业务员业绩排行
{{
  "action": "销售数据查询",
  "sales_query_type": "salesperson",
  "products": null
}}

示例38（销售数据查询 - 特定业务员）：
用户输入："张三这个月业绩怎么样"
说明：用户要查询特定业务员的业绩
{{
  "action": "销售数据查询",
  "sales_query_type": "salesperson",
  "sales_query_salesperson": "张三",
  "products": null
}}

示例39（销售数据查询 - 对比分析）：
用户输入："和上个月比销售怎么样"
说明：用户要对比本月和上月销售
{{
  "action": "销售数据查询",
  "sales_query_type": "compare",
  "products": null
}}

示例40（付料 - 基本）：
用户输入："付20克给金源珠宝"
说明：用户要付料给供应商，提取供应商名称和克重
{{
  "action": "付料",
  "gold_payment_supplier": "金源珠宝",
  "gold_payment_weight": 20,
  "products": null
}}

示例41（付料 - 另一种表达）：
用户输入："给深圳金源付10克"
说明：用户要付料给供应商，语序不同但意图相同
{{
  "action": "付料",
  "gold_payment_supplier": "深圳金源",
  "gold_payment_weight": 10,
  "products": null
}}

示例42（付料 - 带备注）：
用户输入："付料金源珠宝15克 12月份欠料"
说明：用户付料并提供备注信息
{{
  "action": "付料",
  "gold_payment_supplier": "金源珠宝",
  "gold_payment_weight": 15,
  "gold_payment_remark": "12月份欠料",
  "products": null
}}

示例43（批量转移 - 基本）：
用户输入："把入库单RK1768047147249的商品转到展厅"
说明：用户要把某个入库单的商品批量转移到展厅
{{
  "action": "批量转移",
  "batch_transfer_order_no": "RK1768047147249",
  "batch_transfer_to_location": "展厅",
  "products": null
}}

示例44（批量转移 - 简写）：
用户输入："RK1768047147249转移到展厅"
说明：用户直接输入入库单号和目标位置
{{
  "action": "批量转移",
  "batch_transfer_order_no": "RK1768047147249",
  "batch_transfer_to_location": "展厅",
  "products": null
}}

示例45（批量转移 - 默认位置）：
用户输入："把RK123的商品全部转移"
说明：用户没有指定目标位置，默认为展厅
{{
  "action": "批量转移",
  "batch_transfer_order_no": "RK123",
  "batch_transfer_to_location": "展厅",
  "products": null
}}

示例46（提料 - 基本）：
用户输入："张老板提5克"
说明：客户要从存料中取走金料，提取客户名称和克重
{{
  "action": "提料",
  "withdrawal_customer_name": "张老板",
  "withdrawal_gold_weight": 5,
  "products": null
}}

示例47（提料 - 取料表达）：
用户输入："李总取料3克"
说明：客户要取走金料，"取料"和"提料"意思相同
{{
  "action": "提料",
  "withdrawal_customer_name": "李总",
  "withdrawal_gold_weight": 3,
  "products": null
}}

示例48（提料 - 带备注）：
用户输入："给王老板提2克金料 送到深圳"
说明：客户提料并指定送货信息
{{
  "action": "提料",
  "withdrawal_customer_name": "王老板",
  "withdrawal_gold_weight": 2,
  "withdrawal_remark": "送到深圳",
  "products": null
}}
"""
    
    max_retries = 3
    retry_count = 0
    content = ""  # 初始化变量，避免作用域问题
    
    while retry_count < max_retries:
        try:
            logger.info(f"调用 DeepSeek API 解析消息 (尝试 {retry_count + 1}/{max_retries}): {message}")
            response = get_client().chat.completions.create(
                model="deepseek-chat",
                max_tokens=1500,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的珠宝ERP系统AI助手。你需要理解用户的自然语言输入，准确识别用户意图，并提取相关信息。你擅长理解各种口语化表达和业务场景。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            content = response.choices[0].message.content.strip()
            logger.info(f"DeepSeek API 原始响应: {content}")
            
            # 提取JSON部分（去除可能的markdown代码块标记）
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            
            # 尝试找到JSON对象
            start_idx = content.find('{')
            end_idx = content.rfind('}')
            if start_idx != -1 and end_idx != -1:
                content = content[start_idx:end_idx+1]
            
            data = json.loads(content)
            logger.info(f"解析后的数据: {data}")
            
            # 处理products数组
            if 'products' in data and isinstance(data['products'], list):
                # 确保每个商品的数值类型正确
                for product in data['products']:
                    if 'weight' in product and product['weight'] is not None:
                        try:
                            product['weight'] = float(product['weight'])
                        except (ValueError, TypeError):
                            logger.warning(f"无法转换weight为数字: {product.get('weight')}")
                            product['weight'] = None
                    
                    if 'labor_cost' in product and product['labor_cost'] is not None:
                        try:
                            product['labor_cost'] = float(product['labor_cost'])
                        except (ValueError, TypeError):
                            logger.warning(f"无法转换labor_cost为数字: {product.get('labor_cost')}")
                            product['labor_cost'] = None
            
            # 向后兼容：如果没有products但有单个商品字段，转换为products数组
            if 'products' not in data or not data['products']:
                if 'product_name' in data and data.get('product_name'):
                    data['products'] = [{
                        'product_name': data.get('product_name'),
                        'weight': data.get('weight'),
                        'labor_cost': data.get('labor_cost'),
                        'supplier': data.get('supplier')
                    }]
            
            # 确保weight和labor_cost是数字类型（向后兼容）
            if 'weight' in data and data['weight'] is not None:
                try:
                    data['weight'] = float(data['weight'])
                except (ValueError, TypeError):
                    logger.warning(f"无法转换weight为数字: {data.get('weight')}")
                    data['weight'] = None
            
            if 'labor_cost' in data and data['labor_cost'] is not None:
                try:
                    data['labor_cost'] = float(data['labor_cost'])
                except (ValueError, TypeError):
                    logger.warning(f"无法转换labor_cost为数字: {data.get('labor_cost')}")
                    data['labor_cost'] = None
            
            logger.info(f"[成功] Claude API调用成功，解析完成")
            return AIResponse(**data)
        
        except json.JSONDecodeError as e:
            logger.error(f"JSON解析错误 (尝试 {retry_count + 1}/{max_retries}): {e}, 原始内容: {content}")
            retry_count += 1
            if retry_count >= max_retries:
                logger.error(f"JSON解析失败，已达到最大重试次数，使用备用解析器")
                return fallback_parser(message)
            continue
        
        except Exception as e:
            logger.error(f"AI解析出错 (尝试 {retry_count + 1}/{max_retries}): {e}, 错误类型: {type(e).__name__}")
            retry_count += 1
            if retry_count >= max_retries:
                logger.error(f"API调用失败，已达到最大重试次数，使用备用解析器")
                return fallback_parser(message)
            # 等待一下再重试
            import time
            time.sleep(1)
            continue
    
    # 如果所有重试都失败，使用备用解析器
    logger.warning(f"所有重试都失败，使用备用解析器")
    return fallback_parser(message)

def fallback_parser(message: str) -> AIResponse:
    """简单的规则匹配作为备用方案"""
    logger.info(f"使用备用解析器处理: {message}")
    
    # 提取重量（数字+克）
    weight = None
    weight_match = re.search(r'(\d+(?:\.\d+)?)\s*克', message)
    if weight_match:
        weight = float(weight_match.group(1))
    
    # 提取工费（工费+数字+元）
    labor_cost = None
    labor_match = re.search(r'工费\s*(\d+(?:\.\d+)?)\s*元', message)
    if labor_match:
        labor_cost = float(labor_match.group(1))
    
    # 提取供应商（供应商是XXX 或 供应商：XXX）
    supplier = None
    supplier_match = re.search(r'供应商[是：:]\s*([^，,。.\n]+)', message)
    if supplier_match:
        supplier = supplier_match.group(1).strip()
    
    # 提取商品名称（通常在重量之前）
    product_name = None
    if weight_match:
        before_weight = message[:weight_match.start()].strip()
        # 移除常见的入库相关词汇
        product_name = before_weight.replace('帮我做个入库', '').replace('入库', '').strip()
        if not product_name or len(product_name) < 2:
            # 如果提取失败，尝试从整个消息中提取
            parts = message.split()
            for part in parts:
                if '克' not in part and '工费' not in part and '供应商' not in part and '入库' not in part:
                    product_name = part
                    break
    
    # 优先检测退货关键词（退、退货、退给、退回）
    if "退" in message or "退货" in message or "退给" in message or "退回" in message:
        return AIResponse(
            action="退货",
            product_name=product_name or "未知商品",
            weight=weight,
            labor_cost=labor_cost,
            supplier=supplier
        )
    elif "入库" in message or "入" in message:
        return AIResponse(
            action="入库",
            product_name=product_name or "未知商品",
            weight=weight,
            labor_cost=labor_cost,
            supplier=supplier
        )
    elif "查询" in message or "库存" in message:
        return AIResponse(action="查询库存", product_name=product_name)
    else:
        return AIResponse(action="未知")

