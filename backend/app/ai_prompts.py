"""分类提示词系统 - 将大型单一提示词拆分为按类别的小型提示词

通过 pre_classify() 先用正则/关键词将用户输入分类到6个类别，
然后调用对应类别的提示词生成器，只发送该类别相关的 action 和示例，
大幅减少每次 API 调用的 token 消耗。
"""

import re
import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def _today() -> str:
    """返回当前日期字符串 YYYY-MM-DD（用于 prompt 示例中的动态日期）"""
    return datetime.now().strftime("%Y-%m-%d")


def _week_start() -> str:
    """返回本周一的日期字符串 YYYY-MM-DD"""
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    return monday.strftime("%Y-%m-%d")


# ============================================================
# 0. _fallback_classify - AI 兜底分类器
# ============================================================

_FALLBACK_PROMPT = """用户在珠宝ERP系统中说了一句话，请判断它属于以下哪个类别：
- inbound（入库、库存相关）
- sales（销售、开单、结算单相关）
- return（退货、退给供应商相关）
- finance（财务、欠款、欠料、金料收付、存料、对账、暂借、凭证、报销相关）
- query（查询、统计、分析、客户信息、供应商信息、转移单相关）
- system（系统操作、确认单据、闲聊、其他）

{context}用户消息：「{message}」

重要：如果用户消息很短（如"全部的呢"、"那今年呢"），请结合最近对话判断用户在追问什么话题，归入对应类别。
只返回类别名称（inbound/sales/return/finance/query/system），不要解释。"""

_VALID_CATEGORIES = {"inbound", "sales", "return", "finance", "query", "system"}

def _fallback_classify(message: str, conversation_history: Optional[List[dict]] = None) -> str:
    """当关键词规则无法匹配时，调用 DeepSeek API 做轻量级分类。
    
    使用极简 prompt（约 200 tokens），只做分类不做解析，成本极低。
    如果 API 调用失败，兜底返回 system。
    """
    context_str = ""
    if conversation_history:
        context_str = "最近对话：\n"
        for h in conversation_history[-4:]:
            role = "用户" if h.get("role") == "user" else "系统"
            context_str += f"  {role}: {h.get('content', '')[:150]}\n"
        context_str += "\n"

    try:
        from .ai_parser import get_client
        response = get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=20,
            temperature=0.0,
            messages=[
                {"role": "user", "content": _FALLBACK_PROMPT.format(message=message, context=context_str)}
            ]
        )
        result = response.choices[0].message.content.strip().lower()
        if result in _VALID_CATEGORIES:
            logger.info(f"AI 兜底分类: '{message[:30]}...' → {result}")
            return result
        else:
            logger.warning(f"AI 兜底分类返回无效值: '{result}'，使用 system")
            return "system"
    except Exception as e:
        logger.warning(f"AI 兜底分类失败: {e}，使用 system")
        return "system"


# ============================================================
# 1. pre_classify - 正则/关键词分类器
# ============================================================

def pre_classify(message: str, conversation_history: Optional[List[dict]] = None) -> str:
    """用正则和关键词将用户输入分类到6个类别之一。

    优先级顺序：
    1. "确认"/"反确认" + 单号前缀 → system
    2. 退货关键词 → return
    3. RK 前缀（不含转移/确认） → inbound
    4. XS 前缀 → sales
    5. TH 前缀 → return
    6. 金料/收料/付料等财务关键词 → finance
    7. 查询/统计/分析/图表/TR前缀/供应商/转移单 → query
    8. 其他 → system（兜底）
    """
    msg = message.strip()

    # --- 优先级 1：确认/反确认 + 单号 → system ---
    if re.search(r'(反确认|确认).*(RK|XS|TH|JS)\d', msg) or \
       re.search(r'(RK|XS|TH|JS)\d.*(反确认|确认)', msg):
        return "system"

    # --- 优先级 2：系统帮助（"怎么"/"如何"/"教我" 在业务词之前检测）---
    # 必须在入库/销售等关键词之前检查，否则"怎么入库"会被归为 inbound
    help_keywords = ['怎么', '如何', '教我', '帮助', '使用说明', '功能介绍']
    if any(kw in msg for kw in help_keywords):
        return "system"

    # --- 优先级 3：退货关键词 → return ---
    return_keywords = ['退货', '退给', '退回', '退库', '销退', '客户退', '我要退']
    if any(kw in msg for kw in return_keywords):
        return "return"
    # 单独的"退"字：需要排除"退回转移单"等查询场景
    if '退' in msg and not re.search(r'(查询|转移单|调拨|TR\d)', msg):
        return "return"

    # --- 优先级 3.5：转移关键词（非查询） → return ---
    if ('转移' in msg or '转到' in msg) and not re.search(r'(查询|TR\d)', msg):
        return "return"

    # --- 优先级 4：RK 前缀 → inbound（包含批量转移场景）---
    if re.search(r'RK\d', msg):
        return "inbound"

    # --- 优先级 5：XS 前缀 → sales ---
    if re.search(r'XS\d', msg):
        return "sales"

    # --- 优先级 6：TH 前缀 → return ---
    if re.search(r'TH\d', msg):
        return "return"

    # --- 优先级 7：入库关键词 → inbound ---
    inbound_keywords = ['入库', '入库单', '查询入库单', '库存']
    if any(kw in msg for kw in inbound_keywords):
        return "inbound"

    # --- 优先级 7.5：暂借关键词 → finance ---
    loan_keywords = ['暂借', '借出', '借货', '还货', '归还暂借', '还暂借']
    if any(kw in msg for kw in loan_keywords):
        return "finance"
    if re.search(r'ZJ\d', msg) or re.search(r'HH\d', msg):
        return "finance"

    # --- 优先级 8：销售/结算关键词 → sales ---
    sales_keywords = ['卖', '销售', '开单', '结算', '结算单', '销售单', '业绩']
    if any(kw in msg for kw in sales_keywords):
        return "sales"
    if re.search(r'JS\d', msg):
        return "sales"

    # --- 优先级 9：财务关键词 → finance ---
    finance_keywords = [
        '来料', '交料', '存料', '收料', '付料', '提料',
        '收款', '打款', '付款', '欠款', '欠料', '账务',
        '供应商付款', '金料', '收到',
        '欠', '多少钱', '对账', '账单', '余额',
        '结价', '存料结价', '料结价',
        '对账单', '月结', '报销', '费用',
        '凭证', '收款凭证', '付款凭证',
    ]
    if any(kw in msg for kw in finance_keywords):
        return "finance"
    # 模式匹配：付/提 + 数字 → finance（"付20克"、"提5克"、"付2000"）
    if re.search(r'付\d', msg) or re.search(r'提\d', msg):
        return "finance"

    # --- 优先级 10：创建客户/供应商 → system ---
    if any(kw in msg for kw in ['新建客户', '创建客户', '添加客户', '新建供应商', '创建供应商', '添加供应商']):
        return "system"

    # --- 优先级 11：查询/分析关键词 → query ---
    query_keywords = [
        '查询', '统计', '分析', '图表', '可视化',
        '供应商', '转移单', '调拨', '客户',
    ]
    if any(kw in msg for kw in query_keywords):
        return "query"
    if re.search(r'TR\d', msg):
        return "query"

    # --- 优先级 11：其他系统关键词 → system ---
    if '确认' in msg or '反确认' in msg:
        return "system"

    # --- 兜底：关键词无法匹配，调 AI 做轻量级分类（传入对话历史以理解追问） ---
    return _fallback_classify(msg, conversation_history)


# ============================================================
# 2. build_context - 构建对话上下文
# ============================================================

def build_context(conversation_history: Optional[List[dict]] = None, session_entities: Optional[Dict] = None) -> str:
    """将对话历史和会话实体格式化为上下文段落，供提示词使用。
    
    Args:
        conversation_history: 最近的对话记录
        session_entities: 会话中记住的实体信息（最近操作结果等）
    """
    context = ""
    
    if conversation_history and len(conversation_history) > 0:
        context += """
=== 最近对话记录（用于理解上下文）===
"""
        for item in conversation_history[-5:]:
            role_label = "用户" if item.get("role") == "user" else "系统"
            content = item.get("content", "")[:200]
            context += f"{role_label}: {content}\n"

        context += "=== 对话记录结束 ===\n"

    # 注入最近操作结果（上下文连续对话的核心）
    if session_entities:
        last_action = session_entities.get("last_action")
        if last_action:
            context += f"""
【最近操作结果】
- 操作类型：{last_action}
- 单号：{session_entities.get('last_order_no', '无')}
- 商品：{session_entities.get('last_product_name', '无')}
- 克重：{session_entities.get('last_weight', '无')}
- 工费：{session_entities.get('last_labor_cost', '无')}
- 供应商：{session_entities.get('last_supplier', '无')}
- 客户：{session_entities.get('last_customer_name', '无')}
"""

    if conversation_history or session_entities:
        context += """
**重要**：请结合对话记录和最近操作结果理解用户当前的输入。

【连续对话理解规则】
- "再来一个" / "同样的" / "再入一个" → 复用最近操作的商品名、供应商、工费等信息，执行相同操作
- "改成Xg" / "克重改成X" → 修改最近操作的单据（需要单号）
- "确认" / "确认刚才的" / "确认一下" → 确认最近操作的单据（使用最近的单号）
- "这个" / "刚才的" / "那个" → 指代最近操作中的商品或单据
- "详情" → 查询最近提到的单据详情

【商品/客户/供应商上下文】
- 从对话记录和最近操作中找到对应的实体名称
- 如果用户刚查询了某客户，然后问"有欠料吗"，应理解为查询同一客户

【单据前缀】
- RK=入库单，XS=销售单，TR=转移单，TH=退货单

【重要原则】
- 如果无法从上下文确定实体，对应字段可以设为 null
- 优先从最近操作结果中推断实体
"""
    return context


# ============================================================
# 共用系统指令前缀
# ============================================================

_SYSTEM_HEADER = "你是一个珠宝ERP系统的智能AI助手。你需要理解用户的自然语言输入，并提取相关信息。"

# 角色描述映射 - 告诉AI当前用户的职责，辅助意图推断
_ROLE_DESCRIPTIONS = {
    "product": "商品专员（主要负责：入库、库存转移、退货给供应商、管理供应商）",
    "counter": "柜台人员（主要负责：销售开单、接收库存、管理客户、退货给商品部）",
    "settlement": "结算专员（主要负责：创建结算单、确认结算）",
    "sales": "业务员（主要负责：查询销售单、管理客户）",
    "finance": "财务人员（主要负责：财务对账、审核单据）",
    "manager": "管理层（拥有所有权限，可执行所有操作）",
}

def _build_role_context(user_role: str) -> str:
    """生成角色上下文提示，让AI根据角色辅助判断意图"""
    role_desc = _ROLE_DESCRIPTIONS.get(user_role, _ROLE_DESCRIPTIONS["manager"])
    return f"""
**当前用户角色**：{role_desc}
- 当用户意图不明确时，优先考虑该角色最常执行的操作
- 例如：商品专员输入商品信息大概率是"入库"，柜台人员输入商品信息大概率是"创建销售单"
- 如果用户角色是管理层且意图确实无法判断，可以返回 action: "闲聊" 并在 message 中提示用户明确操作类型
"""

_CAUTIOUS_PRINCIPLE = """
**⚠️ 谨慎识别原则（极其重要，减少幻觉）**：
- **宁可识别为"闲聊"，也不要错误猜测用户意图**
- 如果用户输入不包含明确的业务关键词，优先识别为"闲聊"
- **只有当用户输入包含明确的业务动词+业务实体时，才识别为业务操作**
"""

_JSON_INSTRUCTION = """
只返回JSON，不要其他文字。
"""


# ============================================================
# 3. 六个提示词生成器
# ============================================================

def get_inbound_prompt(message: str, context: str) -> str:
    """入库类别提示词：入库、查询入库单、批量转移、查询库存"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **入库**：用户要进行商品入库（包含商品名称、重量、工费、供应商等信息）
2. **查询入库单**：查询入库单信息，入库单号以RK开头
3. **批量转移**：按入库单号批量转移商品（如"把入库单RK123的商品转到展厅"）
4. **查询库存**：查询商品库存信息（如"查询库存"、"还有多少"、"帮我查一下我目前的库存"）

{_CAUTIOUS_PRINCIPLE}

**关键词优先级（非常重要）**：
- "来料"、"交料"、"存料" → **不是**入库！是"收料"操作（属于finance类别）
- "退"、"退货"、"退给"、"退回"、"退库" → **不是**入库！是"退货"操作
- "入"、"入库"、"帮我入" → 识别为"入库"
- RK开头的单号 → "查询入库单"
- "查询单号RK..." → "查询入库单"，提取order_no

请返回JSON格式，包含以下字段：
- action: 从 "入库" / "查询入库单" / "批量转移" / "查询库存" 中选择
- products: 商品列表（数组，仅当action为"入库"时需要），每个商品包含：
  - product_name: 商品名称（必填）
  - weight: 重量（克，必须>0，必填）
  - labor_cost: 克工费（元/克，必须≥0，必填）
  - piece_count: 件数（整数，可选）
  - piece_labor_cost: 件工费（元/件，可选）
  - supplier: 供应商（必填）
- order_no: 入库单号（RK开头，仅当action为"查询入库单"且用户提供了单号时）
- inbound_supplier: 按供应商筛选入库单
- inbound_product: 按商品名称筛选入库单
- inbound_date_start: 入库单开始日期（YYYY-MM-DD）
- inbound_date_end: 入库单结束日期（YYYY-MM-DD）
- batch_transfer_order_no: 入库单号（当action为"批量转移"时，RK开头）
- batch_transfer_to_location: 目标位置（默认"展厅"）

**供应商智能识别**：
- 用户输入的第一个词通常是供应商名称
- 包含"珠宝/金/首饰/饰品/工厂/贸易/公司"的词通常是供应商
- 如果有明确标记（如"供应商是XXX"），使用明确标记的值

**多商品入库识别**：
- 多组"重量+工费"数据 → 多个商品
- 逗号、顿号、数字序号都是商品分隔的标志
- 所有商品必须填写相同的supplier字段

**订单号前缀识别**：
- RK开头 → 入库单号，action: "查询入库单"
- "查询单号RK..." → action: "查询入库单"，提取order_no

{_JSON_INSTRUCTION}

示例1（单个商品入库）：
用户输入："古法戒指 100克 工费8元 供应商是金源珠宝，帮我做个入库"
{{"action": "入库", "products": [{{"product_name": "古法戒指", "weight": 100, "labor_cost": 8, "supplier": "金源珠宝"}}]}}

示例1-智能供应商识别：
用户输入："测试珠宝 3DDZ 入库100克 工费10元/g"
{{"action": "入库", "products": [{{"product_name": "3DDZ", "weight": 100, "labor_cost": 10, "supplier": "测试珠宝"}}]}}

示例1-智能供应商识别2：
用户输入："金源珠宝 古法戒指 50克 8元 入库"
{{"action": "入库", "products": [{{"product_name": "古法戒指", "weight": 50, "labor_cost": 8, "supplier": "金源珠宝"}}]}}

示例1a（带件数和件工费）：
用户输入："古法吊坠 10件 100克 工费6元 件工费5元 供应商是金源珠宝，帮我做个入库"
{{"action": "入库", "products": [{{"product_name": "古法吊坠", "weight": 100, "labor_cost": 6, "piece_count": 10, "piece_labor_cost": 5, "supplier": "金源珠宝"}}]}}

示例1b（多商品不同工费）：
用户输入："古法吊坠 100克 工费6元 250g 3.5元 供应商是金源珠宝，帮我做个入库"
{{"action": "入库", "products": [{{"product_name": "古法吊坠", "weight": 100, "labor_cost": 6, "supplier": "金源珠宝"}}, {{"product_name": "商品", "weight": 250, "labor_cost": 3.5, "supplier": "金源珠宝"}}]}}

示例1c（逗号分隔带名称）：
用户输入："古法吊坠100克6元，古法手镯250克3.5元，供应商金源珠宝，入库"
{{"action": "入库", "products": [{{"product_name": "古法吊坠", "weight": 100, "labor_cost": 6, "supplier": "金源珠宝"}}, {{"product_name": "古法手镯", "weight": 250, "labor_cost": 3.5, "supplier": "金源珠宝"}}]}}

示例1d（序号列出）：
用户输入："帮我入库：1.古法手镯100克8元 2.精品戒指50克6元 3.3D吊坠30克12元，供应商都是鑫韵"
{{"action": "入库", "products": [{{"product_name": "古法手镯", "weight": 100, "labor_cost": 8, "supplier": "鑫韵"}}, {{"product_name": "精品戒指", "weight": 50, "labor_cost": 6, "supplier": "鑫韵"}}, {{"product_name": "3D吊坠", "weight": 30, "labor_cost": 12, "supplier": "鑫韵"}}]}}

示例15（查询入库单 - 带单号）：
用户输入："查询入库单RK1768047147249"
{{"action": "查询入库单", "order_no": "RK1768047147249", "products": null}}

示例16（入库单号单独输入）：
用户输入："RK1768047147249"
{{"action": "查询入库单", "order_no": "RK1768047147249", "products": null}}

示例17（自然语言查询入库单）：
用户输入："帮我查一下入库单号RK1768047147249的详情"
{{"action": "查询入库单", "order_no": "RK1768047147249", "products": null}}

示例18（不指定入库单号）：
用户输入："查询入库单"
{{"action": "查询入库单", "order_no": null, "products": null}}

示例18-1（按供应商筛选）：
用户输入："查询金源珠宝的入库单"
{{"action": "查询入库单", "order_no": null, "inbound_supplier": "金源珠宝", "products": null}}

示例18-2（按日期筛选-今天）：
用户输入："查询今天的入库单"
{{"action": "查询入库单", "order_no": null, "inbound_date_start": "{_today()}", "inbound_date_end": "{_today()}", "products": null}}

示例18-4（按商品筛选）：
用户输入："查询有古法戒指的入库单"
{{"action": "查询入库单", "order_no": null, "inbound_product": "古法戒指", "products": null}}

示例18-5（组合筛选）：
用户输入："查询本周金源珠宝的入库单"
{{"action": "查询入库单", "order_no": null, "inbound_supplier": "金源珠宝", "inbound_date_start": "{_week_start()}", "inbound_date_end": "{_today()}", "products": null}}

示例18-6（最近的入库单）：
用户输入："最近的入库单"
{{"action": "查询入库单", "order_no": null, "products": null}}

示例-新增（查询单号RK...）：
用户输入："查询单号RK202602083368"
{{"action": "查询入库单", "order_no": "RK202602083368", "products": null}}

示例43（批量转移 - 基本）：
用户输入："把入库单RK1768047147249的商品转到展厅"
{{"action": "批量转移", "batch_transfer_order_no": "RK1768047147249", "batch_transfer_to_location": "展厅", "products": null}}

示例44（批量转移 - 简写）：
用户输入："RK1768047147249转移到展厅"
{{"action": "批量转移", "batch_transfer_order_no": "RK1768047147249", "batch_transfer_to_location": "展厅", "products": null}}

示例45（批量转移 - 默认位置）：
用户输入："把RK123的商品全部转移"
{{"action": "批量转移", "batch_transfer_order_no": "RK123", "batch_transfer_to_location": "展厅", "products": null}}

示例2（查询库存）：
用户输入："查询古法戒指库存"
{{"action": "查询库存", "products": null}}

示例4（查询所有库存）：
用户输入："帮我查一下我目前的库存"
{{"action": "查询库存", "products": null}}

示例10（上下文追问-查询库存）：
用户输入："哪七种"
{{"action": "查询库存", "products": null}}
"""


def get_sales_prompt(message: str, context: str) -> str:
    """销售类别提示词：创建销售单、查询销售单、销售数据查询、创建结算单、查询结算单"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **创建销售单**：用户要开销售单（包含客户、商品、工费、克重、业务员等信息）
2. **查询销售单**：查询销售单信息，销售单号以XS开头
3. **销售数据查询**：查询销售统计数据（如"今天卖了多少钱"、"本月业绩"、"业务员排行"等）
4. **创建结算单**：用户要给客户做结算（需要客户名 + 结算方式：结料/结价/混合）
   - "帮张三做一笔结算"/"给张三结算 结料"/"结算 张三 金价550" → 创建结算单
5. **查询结算单**：查询结算单信息，结算单号以JS开头
   - "查询结算单"/"查一下JS202602..."/"张三的结算单" → 查询结算单

**关键词区分**：
- "结算" + 客户名 + 结算方式/金价 → "创建结算单"
- "查询结算"/"JS开头单号" → "查询结算单"
- "结价" + 客户名 + 克重 + 金价 → **不是**结算单！是"存料结价"（属于finance类别）
- "开单"/"卖给" → "创建销售单"

{_CAUTIOUS_PRINCIPLE}

请返回JSON格式，包含以下字段：
- action: 从 "创建销售单" / "查询销售单" / "销售数据查询" / "创建结算单" / "查询结算单" 中选择

- 创建销售单字段：
  - customer_name: 客户姓名（必填）
  - salesperson: 业务员姓名（必填）
  - store_code: 门店代码（可选）
  - order_date: 日期（可选，格式YYYY-MM-DD）
  - items: 商品明细列表，每个包含 product_name、weight、labor_cost

- 查询销售单字段：
  - sales_order_no: 销售单号（XS开头）
  - customer_name: 客户姓名（按客户筛选时）

- 销售数据查询字段：
  - sales_query_type: 查询类型（today/month/compare/top_products/salesperson/summary）
  - sales_query_days: 查询天数（默认30）
  - sales_query_salesperson: 业务员姓名（查询特定业务员时）

- 创建结算单字段：
  - settlement_customer_name: 客户姓名（必填）
  - settlement_sales_order_no: 关联销售单号（XS开头，可选，不提供则自动匹配最近待结算销售单）
  - settlement_payment_method: 结算方式（必填："结料"/"结价"/"混合"）
  - settlement_gold_price: 当日金价（结价或混合时必填，数字，单位元/克）
  - settlement_remark: 备注（可选）

- 查询结算单字段：
  - settlement_order_no: 结算单号（JS开头，可选）
  - settlement_customer_name: 客户姓名（可选，按客户筛选）
  - start_date: 开始日期（YYYY-MM-DD，可选）
  - end_date: 结束日期（YYYY-MM-DD，可选）

**订单号前缀识别**：
- XS开头 → 销售单号，action: "查询销售单"
- JS开头 → 结算单号，action: "查询结算单"
- 不要与RK开头的入库单混淆

{_JSON_INSTRUCTION}

示例8（创建销售单）：
用户输入："开销售单：今天，客户张三，古法戒指 50克 工费10元/克，业务员李四，门店代码001"
{{"action": "创建销售单", "customer_name": "张三", "salesperson": "李四", "store_code": "001", "order_date": "{_today()}", "items": [{{"product_name": "古法戒指", "weight": 50, "labor_cost": 10}}], "products": null}}

示例9（查询销售单 - 按客户）：
用户输入："查询最近张三的销售单"
{{"action": "查询销售单", "customer_name": "张三", "products": null}}

示例19（带销售单号）：
用户输入："查询销售单XS20260111162534"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例20（销售单号单独输入）：
用户输入："XS20260111162534"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例21（自然语言查询销售单）：
用户输入："帮我查一下销售单号XS20260111162534的详情"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例22（带查询字样）：
用户输入："XS20260111162534 查询"
{{"action": "查询销售单", "sales_order_no": "XS20260111162534", "products": null}}

示例34（今日销售）：
用户输入："今天卖了多少钱"
{{"action": "销售数据查询", "sales_query_type": "today", "products": null}}

示例35（本月业绩）：
用户输入："这个月销售额多少"
{{"action": "销售数据查询", "sales_query_type": "month", "products": null}}

示例36（热销商品）：
用户输入："哪个商品卖得最好"
{{"action": "销售数据查询", "sales_query_type": "top_products", "products": null}}

示例37（业务员业绩）：
用户输入："业务员业绩排行"
{{"action": "销售数据查询", "sales_query_type": "salesperson", "products": null}}

示例38（特定业务员）：
用户输入："张三这个月业绩怎么样"
{{"action": "销售数据查询", "sales_query_type": "salesperson", "sales_query_salesperson": "张三", "products": null}}

示例39（对比分析）：
用户输入："和上个月比销售怎么样"
{{"action": "销售数据查询", "sales_query_type": "compare", "products": null}}

示例-结算1（结料）：
用户输入："帮张三做一笔结算，结料"
{{"action": "创建结算单", "settlement_customer_name": "张三", "settlement_payment_method": "结料", "products": null}}

示例-结算2（结价）：
用户输入："给李老板结算一下，结价，金价550"
{{"action": "创建结算单", "settlement_customer_name": "李老板", "settlement_payment_method": "结价", "settlement_gold_price": 550, "products": null}}

示例-结算3（指定销售单）：
用户输入："XS20260222001 做结算 结料"
{{"action": "创建结算单", "settlement_sales_order_no": "XS20260222001", "settlement_payment_method": "结料", "products": null}}

示例-结算4（查询结算单-单号）：
用户输入："查询结算单JS20260222001"
{{"action": "查询结算单", "settlement_order_no": "JS20260222001", "products": null}}

示例-结算5（查询结算单-按客户）：
用户输入："查一下张三的结算单"
{{"action": "查询结算单", "settlement_customer_name": "张三", "products": null}}

示例-结算6（JS开头直接输入）：
用户输入："JS20260222001"
{{"action": "查询结算单", "settlement_order_no": "JS20260222001", "products": null}}
"""


def get_return_prompt(message: str, context: str) -> str:
    """退货类别提示词：退货（退给供应商/退给商品部）、销退（客户退货给我们）、创建转移单"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **退货**：我们退货给供应商或退给商品部（退出去）
   - "退货给XX供应商" / "退给商品部" / "退库" / "10克退给金源" → action: "退货"
2. **销退**（新功能）：客户退货给我们（退回来）
   - "客户退货" / "张三要退" / "销退" / "客户退回" / "XX要退货" → action: "销退"
3. **创建转移单**：商品从一个位置转到另一个位置
   - "帮我转移到展厅" / "把XXX从仓库转到展厅" → action: "创建转移单"

**"退货" vs "销退"区分（极其重要）**：
- "退货给XX供应商" / "退给商品部" / "退库" / "我要退给..." → action: "退货"（我们退出去）
- "客户退货" / "张三要退" / "销退" / "客户退回" / "XX要退货 商品名 克重" → action: "销退"（客户退给我们）
- 关键判断：主语是"客户/人名"要退 → 销退；主语是"我/我们"退给供应商 → 退货

{_CAUTIOUS_PRINCIPLE}

请返回JSON格式，包含以下字段：
- action: 从 "退货" / "销退" / "创建转移单" 中选择

- 退货字段（action为"退货"时）：
  - return_type: "to_supplier"（退给供应商）/ "to_warehouse"（退给商品部），默认"to_supplier"
  - return_product_name: 退货商品名称
  - return_weight: 退货克重（克）
  - return_labor_cost: 退货克工费（元/克）
  - return_supplier_name: 退给哪个供应商
  - return_reason: 退货原因（默认"质量问题"）
  - return_from_location: 退出位置

- 销退字段（action为"销退"时）：
  - sales_return_customer_name: 退货客户名称（**必须从用户输入中明确提取，如果用户没有提到任何客户名称则必须设为 null，绝对不要从上下文或示例中猜测**）
  - sales_return_product_name: 退货商品名称（用户未提到则设为 null）
  - sales_return_weight: 退货克重（克）（用户未提到则设为 null）
  - sales_return_reason: 退货原因
  - sales_return_order_no: 原销售单号（如有）

- 创建转移单字段（action为"创建转移单"时）：
  - transfer_product_name: 要转移的商品名称
  - transfer_weight: 转移重量（克）
  - from_location: 发出位置（默认"商品部仓库"）
  - to_location: 目标位置（如"展厅"）

{_JSON_INSTRUCTION}

示例26（退货 - 退给供应商）：
用户输入："退货给金源珠宝10克古法戒指 工费5元"
{{"action": "退货", "return_product_name": "古法戒指", "return_weight": 10, "return_labor_cost": 5, "return_supplier_name": "金源珠宝", "return_type": "to_supplier", "products": null}}

示例27（退货 - 退给供应商简写）：
用户输入："10克古法戒指退给金源珠宝"
{{"action": "退货", "return_product_name": "古法戒指", "return_weight": 10, "return_supplier_name": "金源珠宝", "return_type": "to_supplier", "products": null}}

示例28（退货 - 退回商品部）：
用户输入："退回商品部 古法手镯 50克"
{{"action": "退货", "return_product_name": "古法手镯", "return_weight": 50, "return_type": "to_warehouse", "products": null}}

示例-销退1：
用户输入："张三要退货 足金手镯 10g"
{{"action": "销退", "sales_return_customer_name": "张三", "sales_return_product_name": "足金手镯", "sales_return_weight": 10, "products": null}}

示例-销退2：
用户输入："客户退货 古法戒指 5g 质量问题"
{{"action": "销退", "sales_return_product_name": "古法戒指", "sales_return_weight": 5, "sales_return_reason": "质量问题", "products": null}}

示例-销退3：
用户输入："销退 足金吊坠 3g 客户李总"
{{"action": "销退", "sales_return_customer_name": "李总", "sales_return_product_name": "足金吊坠", "sales_return_weight": 3, "products": null}}

示例-销退4（信息不完整，用户未提供具体信息）：
用户输入："我想退货"
{{"action": "销退", "sales_return_customer_name": null, "sales_return_product_name": null, "sales_return_weight": null, "products": null}}

示例23（创建转移单 - 基本）：
用户输入："帮我转移100克古法戒指到展厅"
{{"action": "创建转移单", "transfer_product_name": "古法戒指", "transfer_weight": 100, "from_location": "商品部仓库", "to_location": "展厅", "products": null}}

示例24（创建转移单 - 上下文转移）：
用户输入："这个100克帮我转移到展厅"
{{"action": "创建转移单", "transfer_product_name": null, "transfer_weight": 100, "from_location": "商品部仓库", "to_location": "展厅", "products": null}}

示例25（创建转移单 - 简单转移）：
用户输入："从仓库转50克到展厅"
{{"action": "创建转移单", "transfer_product_name": null, "transfer_weight": 50, "from_location": "商品部仓库", "to_location": "展厅", "products": null}}
"""


def get_finance_prompt(message: str, context: str) -> str:
    """财务类别提示词：收料、付料、提料、登记收款、供应商付款、查询客户账务、存料结价、暂借、归还暂借、查询暂借单、对账单、凭证查询、报销"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **收料**：客户交料/来料/存料（客户把金料交给我们保管）
   - "来料"/"交料"/"存料" = 收料（**绝对不是**退货或入库！）
2. **付料**：付料给供应商（我们付金料给供应商，单位是"克"）
3. **提料**：客户从存料中取走金料
4. **登记收款**：财务登记客户收款（单位是"元"）
5. **供应商付款**：给供应商付工费款项（单位是"元"）
6. **查询客户账务**：查询客户的欠款、欠料、存料等财务信息
7. **存料结价**：将客户存料折算成现金抵扣欠款（客户名 + 克重 + 金价）
   - "结价"/"存料结价"/"料结价"/"存料抵扣" = 存料结价
8. **创建暂借单**：客户暂借商品（客户名 + 商品 + 克重）
   - "暂借"/"借出"/"借货" → 创建暂借单
9. **归还暂借**：客户归还暂借商品
   - "归还"/"还货"/"还暂借" → 归还暂借
10. **查询暂借单**：查询暂借单信息，暂借单号以ZJ开头
   - "查暂借"/"暂借情况"/"ZJ..." → 查询暂借单
11. **查询对账单**：生成/查询客户对账单
   - "对账单"/"月结对账"/"生成对账单" → 查询对账单
12. **查询凭证**：查询FBL凭证
   - "凭证"/"收款凭证"/"查凭证" → 查询凭证
13. **费用报销**：提交费用报销
   - "报销"/"费用" → 费用报销
14. **查询金料记录**：查询收料/付料/提料的历史记录和统计
   - "今天有多少人提料"/"提料记录"/"收料记录"/"付料记录" → 查询金料记录
   - 只要是**查询/统计**收料/付料/提料的记录，而不是**执行**收料/付料/提料操作

**关键词区分（极其重要）**：
- "来料"/"交料"/"存料" + 客户名 + 克重 → "收料"（**不是**退货！不是入库！）
- "付XX克给供应商" → "付料"（付"克"=金料）
- "付XX元给供应商" → "供应商付款"（付"元"=工费款项）
- "XX收到YY元"/"XX打了YY块" → "登记收款"
- "XX提X克"/"XX取料X克" → "提料"（具体某客户提料 = 操作）
- "今天有多少人提料"/"提料记录"/"最近收料情况" → "查询金料记录"（查询/统计 = 查询）
- "XX欠款"/"XX账务" → "查询客户账务"
- "XX结价X克"/"XX存料结价"/"XX料结价 金价YYY" → "存料结价"
- "XX暂借YY商品ZZ克" → "创建暂借单"
- "XX归还暂借"/"XX还货" → "归还暂借"
- "ZJ开头单号"/"暂借情况" → "查询暂借单"
- "对账单"/"月结" → "查询对账单"
- "查凭证"/"收款凭证" → "查询凭证"
- "报销XX元" → "费用报销"

**操作 vs 查询的区分（极其重要）**：
- 有客户名 + 克重 → 操作（收料/付料/提料）
- 有"多少"/"记录"/"今天"/"查询"/"统计"/"最近"等查询词，且无具体客户名+克重 → 查询金料记录

{_CAUTIOUS_PRINCIPLE}

请返回JSON格式，包含以下字段：
- action: 从 "收料" / "付料" / "提料" / "登记收款" / "供应商付款" / "查询客户账务" / "存料结价" / "创建暂借单" / "归还暂借" / "查询暂借单" / "查询对账单" / "查询凭证" / "费用报销" / "查询金料记录" 中选择

- 收料字段：
  - receipt_customer_name: 交料客户名称（必填）
  - receipt_gold_weight: 交料克重（必填，数字，单位克）
  - receipt_gold_fineness: 成色（可选，默认"足金999"）
  - receipt_remark: 备注

- 付料字段：
  - gold_payment_supplier: 付料供应商名称（必填）
  - gold_payment_weight: 付料克重（必填，数字，单位克）
  - gold_payment_remark: 备注

- 提料字段：
  - withdrawal_customer_name: 提料客户名称（必填）
  - withdrawal_gold_weight: 提料克重（必填，数字，单位克）
  - withdrawal_remark: 备注

- 登记收款字段：
  - payment_customer_name: 收款客户名称（必填）
  - payment_amount: 收款金额（必填，数字，单位元）
  - payment_method: 收款方式（可选，默认"转账"，可选值：转账/现金/微信/支付宝/刷卡）
  - payment_remark: 备注

- 供应商付款字段：
  - supplier_payment_name: 付款供应商名称（必填）
  - supplier_payment_amount: 付款金额（必填，数字，单位元）
  - supplier_payment_method: 付款方式（可选，默认"转账"，可选值：转账/现金/支票/承兑）
  - supplier_payment_remark: 备注

- 查询客户账务字段：
  - debt_customer_name: 客户名称（必填）
  - debt_query_type: 查询类型（默认"all"，可选：all/cash_debt/gold_debt/gold_deposit）
  - date_start: 开始日期（YYYY-MM-DD）
  - date_end: 结束日期（YYYY-MM-DD）

- 存料结价字段：
  - deposit_settle_customer_name: 客户名称（必填）
  - deposit_settle_gold_weight: 结价克重（必填，数字，单位克）
  - deposit_settle_gold_price: 金价（必填，数字，单位元/克）
  - deposit_settle_remark: 备注（可选）

- 创建暂借单字段：
  - loan_customer_name: 客户名称（必填）
  - loan_items: 暂借商品列表（必填），每个包含 product_name、weight、labor_cost
  - loan_salesperson: 业务员（可选）
  - loan_remark: 备注（可选）

- 归还暂借字段：
  - loan_customer_name: 客户名称（必填）
  - loan_order_no: 暂借单号（ZJ开头，可选，不提供则自动匹配最近的暂借单）
  - loan_remark: 备注（可选）

- 查询暂借单字段：
  - loan_order_no: 暂借单号（ZJ开头，可选）
  - loan_customer_name: 客户名称（可选）

- 查询对账单字段：
  - reconciliation_customer_name: 客户名称（必填）
  - reconciliation_month: 月份（YYYY-MM格式，可选，默认当月）

- 查询凭证字段：
  - voucher_query_type: 凭证类型（可选：收款凭证/付款凭证/记账凭证）
  - voucher_date_start: 开始日期（YYYY-MM-DD，可选）
  - voucher_date_end: 结束日期（YYYY-MM-DD，可选）
  - voucher_keyword: 搜索关键词（可选，匹配摘要）

- 费用报销字段：
  - expense_category: 费用类别（如：交通费/餐费/办公用品/其他）
  - expense_amount: 金额（必填，数字，单位元）
  - expense_description: 费用描述（必填）
  - expense_remark: 备注（可选）

- 查询金料记录字段：
  - gold_record_type: 查询类型（可选：提料/收料/付料/全部，默认"全部"）
  - gold_record_customer_name: 客户名称（可选，按客户筛选）
  - gold_record_date_start: 开始日期（YYYY-MM-DD，可选）
  - gold_record_date_end: 结束日期（YYYY-MM-DD，可选）

{_JSON_INSTRUCTION}

示例-收料1：
用户输入："张老板交料5克"
{{"action": "收料", "receipt_customer_name": "张老板", "receipt_gold_weight": 5, "products": null}}

示例-收料2：
用户输入："李老板存料3.5克足金9999"
{{"action": "收料", "receipt_customer_name": "李老板", "receipt_gold_weight": 3.5, "receipt_gold_fineness": "足金9999", "products": null}}

示例-收料3：
用户输入："小林来料100克"
{{"action": "收料", "receipt_customer_name": "小林", "receipt_gold_weight": 100, "products": null}}

示例40（付料 - 基本）：
用户输入："付20克给金源珠宝"
{{"action": "付料", "gold_payment_supplier": "金源珠宝", "gold_payment_weight": 20, "products": null}}

示例41（付料 - 另一种表达）：
用户输入："给深圳金源付10克"
{{"action": "付料", "gold_payment_supplier": "深圳金源", "gold_payment_weight": 10, "products": null}}

示例42（付料 - 带备注）：
用户输入："付料金源珠宝15克 12月份欠料"
{{"action": "付料", "gold_payment_supplier": "金源珠宝", "gold_payment_weight": 15, "gold_payment_remark": "12月份欠料", "products": null}}

示例46（提料 - 基本）：
用户输入："张老板提5克"
{{"action": "提料", "withdrawal_customer_name": "张老板", "withdrawal_gold_weight": 5, "products": null}}

示例47（提料 - 取料表达）：
用户输入："李总取料3克"
{{"action": "提料", "withdrawal_customer_name": "李总", "withdrawal_gold_weight": 3, "products": null}}

示例48（提料 - 带备注）：
用户输入："给王老板提2克金料 送到深圳"
{{"action": "提料", "withdrawal_customer_name": "王老板", "withdrawal_gold_weight": 2, "withdrawal_remark": "送到深圳", "products": null}}

示例-登记收款1：
用户输入："张老板收到5000元"
{{"action": "登记收款", "payment_customer_name": "张老板", "payment_amount": 5000, "products": null}}

示例-登记收款2：
用户输入："收到王老板2000"
{{"action": "登记收款", "payment_customer_name": "王老板", "payment_amount": 2000, "products": null}}

示例49（供应商付款 - 基本）：
用户输入："付2000给梵贝琳"
{{"action": "供应商付款", "supplier_payment_name": "梵贝琳", "supplier_payment_amount": 2000, "products": null}}

示例50（供应商付款 - 带付款方式）：
用户输入："现金付5000元给金源珠宝"
{{"action": "供应商付款", "supplier_payment_name": "金源珠宝", "supplier_payment_amount": 5000, "supplier_payment_method": "现金", "products": null}}

示例51（供应商付款 - 完整信息）：
用户输入："转账付3000元给梵贝琳工厂 付1月份的工费"
{{"action": "供应商付款", "supplier_payment_name": "梵贝琳工厂", "supplier_payment_amount": 3000, "supplier_payment_method": "转账", "supplier_payment_remark": "付1月份的工费", "products": null}}

示例29（查询客户账务 - 基本）：
用户输入："张老板的欠款情况"
{{"action": "查询客户账务", "debt_customer_name": "张老板", "debt_query_type": "all", "products": null}}

示例30（查询客户账务 - 指定月份）：
用户输入："王总1月份的欠料"
{{"action": "查询客户账务", "debt_customer_name": "王总", "debt_query_type": "gold_debt", "date_start": "2026-01-01", "date_end": "2026-01-31", "products": null}}

示例31（查询客户账务 - 日期范围）：
用户输入："李老板1月1号到1月20号的账务情况"
{{"action": "查询客户账务", "debt_customer_name": "李老板", "debt_query_type": "all", "date_start": "2026-01-01", "date_end": "2026-01-20", "products": null}}

示例32（查询客户账务 - 存料）：
用户输入："查一下刘老板的存料余额"
{{"action": "查询客户账务", "debt_customer_name": "刘老板", "debt_query_type": "gold_deposit", "products": null}}

示例33（查询客户账务 - 欠款）：
用户输入："陈总欠了多少钱"
{{"action": "查询客户账务", "debt_customer_name": "陈总", "debt_query_type": "cash_debt", "products": null}}

示例33a（带数字后缀的客户名）：
用户输入："测试客户1欠料情况"
{{"action": "查询客户账务", "debt_customer_name": "测试客户1", "debt_query_type": "gold_debt", "products": null}}

示例-存料结价1（基本）：
用户输入："张老板存料结价3克 金价800"
{{"action": "存料结价", "deposit_settle_customer_name": "张老板", "deposit_settle_gold_weight": 3, "deposit_settle_gold_price": 800, "products": null}}

示例-存料结价2（另一种表达）：
用户输入："李总结价5克存料 一克820"
{{"action": "存料结价", "deposit_settle_customer_name": "李总", "deposit_settle_gold_weight": 5, "deposit_settle_gold_price": 820, "products": null}}

示例-存料结价3（带备注）：
用户输入："王老板料结价2克 金价810 抵扣2月欠款"
{{"action": "存料结价", "deposit_settle_customer_name": "王老板", "deposit_settle_gold_weight": 2, "deposit_settle_gold_price": 810, "deposit_settle_remark": "抵扣2月欠款", "products": null}}

示例-存料结价4（口语化）：
用户输入："帮陈总把存的3克金料按790结价"
{{"action": "存料结价", "deposit_settle_customer_name": "陈总", "deposit_settle_gold_weight": 3, "deposit_settle_gold_price": 790, "products": null}}

示例-存料结价5（存料抵扣表达）：
用户输入："刘老板存料抵扣1.5克 金价800"
{{"action": "存料结价", "deposit_settle_customer_name": "刘老板", "deposit_settle_gold_weight": 1.5, "deposit_settle_gold_price": 800, "products": null}}

示例-暂借1（基本）：
用户输入："张三暂借足金手镯2只 10克 工费8元"
{{"action": "创建暂借单", "loan_customer_name": "张三", "loan_items": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 8}}], "products": null}}

示例-暂借2（多商品）：
用户输入："李老板借出古法戒指50克工费6元，古法手镯100克工费8元"
{{"action": "创建暂借单", "loan_customer_name": "李老板", "loan_items": [{{"product_name": "古法戒指", "weight": 50, "labor_cost": 6}}, {{"product_name": "古法手镯", "weight": 100, "labor_cost": 8}}], "products": null}}

示例-暂借3（带业务员）：
用户输入："王总暂借足金吊坠5克 工费10 业务员小李"
{{"action": "创建暂借单", "loan_customer_name": "王总", "loan_items": [{{"product_name": "足金吊坠", "weight": 5, "labor_cost": 10}}], "loan_salesperson": "小李", "products": null}}

示例-归还暂借1（基本）：
用户输入："张三归还暂借"
{{"action": "归还暂借", "loan_customer_name": "张三", "products": null}}

示例-归还暂借2（指定单号）：
用户输入："归还暂借单ZJ20260222001"
{{"action": "归还暂借", "loan_order_no": "ZJ20260222001", "products": null}}

示例-查询暂借1（按客户）：
用户输入："查一下张三的暂借情况"
{{"action": "查询暂借单", "loan_customer_name": "张三", "products": null}}

示例-查询暂借2（按单号）：
用户输入："ZJ20260222001"
{{"action": "查询暂借单", "loan_order_no": "ZJ20260222001", "products": null}}

示例-查询暂借3（全部暂借）：
用户输入："查一下暂借单"
{{"action": "查询暂借单", "products": null}}

示例-对账单1：
用户输入："帮我生成张三1月份的对账单"
{{"action": "查询对账单", "reconciliation_customer_name": "张三", "reconciliation_month": "2026-01", "products": null}}

示例-对账单2：
用户输入："查一下李老板的对账单"
{{"action": "查询对账单", "reconciliation_customer_name": "李老板", "products": null}}

示例-凭证1：
用户输入："查一下2月份的收款凭证"
{{"action": "查询凭证", "voucher_query_type": "收款凭证", "voucher_date_start": "2026-02-01", "voucher_date_end": "2026-02-28", "products": null}}

示例-凭证2：
用户输入："查凭证"
{{"action": "查询凭证", "products": null}}

示例-报销1：
用户输入："报销交通费200元"
{{"action": "费用报销", "expense_category": "交通费", "expense_amount": 200, "expense_description": "交通费", "products": null}}

示例-报销2：
用户输入："报销办公用品500元 买了打印纸和墨盒"
{{"action": "费用报销", "expense_category": "办公用品", "expense_amount": 500, "expense_description": "买了打印纸和墨盒", "products": null}}

示例-查询金料1（今天提料统计）：
用户输入："今天有多少人提料"
{{"action": "查询金料记录", "gold_record_type": "提料", "gold_record_date_start": "{_today()}", "gold_record_date_end": "{_today()}", "products": null}}

示例-查询金料2（收料记录）：
用户输入："最近的收料记录"
{{"action": "查询金料记录", "gold_record_type": "收料", "products": null}}

示例-查询金料3（按客户查提料）：
用户输入："张老板的提料记录"
{{"action": "查询金料记录", "gold_record_type": "提料", "gold_record_customer_name": "张老板", "products": null}}

示例-查询金料4（付料记录）：
用户输入："这个月付了多少料"
{{"action": "查询金料记录", "gold_record_type": "付料", "gold_record_date_start": "{_today()[:7]}-01", "gold_record_date_end": "{_today()}", "products": null}}

示例-查询金料5（全部金料流水）：
用户输入："金料流水"
{{"action": "查询金料记录", "gold_record_type": "全部", "products": null}}
"""


def get_query_prompt(message: str, context: str) -> str:
    """查询类别提示词：查询客户、查询供应商、供应商分析、统计分析、生成图表、查询转移单"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **查询客户**：查询客户信息（如"查询客户张三"、"客户列表"、"有哪些客户"）
2. **查询供应商**：查询供应商信息（如"有几个供应商"、"供应商列表"）
3. **供应商分析**：从多个维度分析哪个供应商最重要
4. **统计分析**：各种统计查询（如"总库存"、"总工费"）
5. **生成图表**：用户想要可视化展示数据
6. **查询转移单**：查询转移单/调拨单信息，转移单号以TR开头

**上下文追问识别**：
- "哪几个供应商"/"供应商有哪些"/"供应商分别是谁"/"分别是谁"（在供应商对话后） → "查询供应商"
- "哪几个客户"/"客户有哪些"/"客户分别是谁" → "查询客户"
- "最重要的供应商"/"核心供应商" → "供应商分析"

**订单号前缀识别**：
- TR开头 → 转移单号，action: "查询转移单"

{_CAUTIOUS_PRINCIPLE}

请返回JSON格式，包含以下字段：
- action: 从 "查询客户" / "查询供应商" / "供应商分析" / "统计分析" / "生成图表" / "查询转移单" 中选择
- customer_name: 客户姓名（当action为"查询客户"时）
- supplier_name: 供应商名称（当action为"查询供应商"时）
- transfer_order_no: 转移单号（TR开头）
- transfer_status: 转移单状态筛选（pending/received/rejected/pending_confirm/returned）
- transfer_date_start: 转移单开始日期（YYYY-MM-DD）
- transfer_date_end: 转移单结束日期（YYYY-MM-DD）

{_JSON_INSTRUCTION}

示例7（查询客户）：
用户输入："查询客户张三"
{{"action": "查询客户", "customer_name": "张三", "products": null}}

示例12（查询客户 - 客户列表）：
用户输入："客户有哪些"
{{"action": "查询客户", "products": null}}

示例3（查询供应商）：
用户输入："我现在有几个供应商"
{{"action": "查询供应商", "products": null}}

示例11（查询供应商 - 哪几个）：
用户输入："哪几个供应商"
{{"action": "查询供应商", "products": null}}

示例13（查询供应商 - 分别是谁）：
用户输入："分别是谁"
{{"action": "查询供应商", "products": null}}

示例14（查询供应商 - 分别是哪些）：
用户输入："分别是哪些"
{{"action": "查询供应商", "products": null}}

示例4a（供应商分析）：
用户输入："谁是我最重要的供应商？"
{{"action": "供应商分析", "products": null}}

示例5（统计分析）：
用户输入："总库存是多少"
{{"action": "统计分析", "products": null}}

示例52（查询转移单 - 带单号）：
用户输入："查询转移单TR20260127001"
{{"action": "查询转移单", "transfer_order_no": "TR20260127001", "products": null}}

示例53（查询转移单 - 单号单独输入）：
用户输入："TR20260127001"
{{"action": "查询转移单", "transfer_order_no": "TR20260127001", "products": null}}

示例54（查询转移单 - 调拨单同义词）：
用户输入："最近的调拨单"
{{"action": "查询转移单", "products": null}}

示例55（查询转移单 - 按状态筛选）：
用户输入："被退回的转移单"
{{"action": "查询转移单", "transfer_status": "returned", "products": null}}

示例56（查询转移单 - 按日期筛选）：
用户输入："今天的调拨记录"
{{"action": "查询转移单", "transfer_date_start": "{_today()}", "transfer_date_end": "{_today()}", "products": null}}
"""


def get_system_prompt(message: str, context: str) -> str:
    """系统类别提示词：确认单据、反确认单据、系统帮助、创建客户、创建供应商、闲聊、其他"""

    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

本类别支持的功能（只从以下action中选择）：
1. **确认单据**：用户要确认某张单据使其生效（"确认" + 单号）
2. **反确认单据**：用户要反确认/撤回已确认的单据（"反确认" + 单号）
3. **系统帮助**：用户询问系统怎么用、操作指南等
4. **创建客户**：用户要创建新客户
5. **创建供应商**：用户要创建新供应商
6. **闲聊**：用户的问候、寒暄、感谢、闲聊或与业务无关的内容
7. **其他**：无法识别的意图（当不确定时，优先选择"闲聊"）

{_CAUTIOUS_PRINCIPLE}
- 简短的问候语（"你好"、"嗨"、"hi"、"hello"、"早上好"、"晚安"）→ 必须识别为"闲聊"
- 感谢语（"谢谢"、"感谢"、"辛苦了"、"好的"、"收到"）→ 必须识别为"闲聊"
- 无关话题（"今天天气怎么样"、"1+1等于几"、"讲个笑话"）→ 必须识别为"闲聊"
- "怎么"/"如何"/"教我"/"帮助"/"使用说明"/"功能介绍" + 操作相关内容 → "系统帮助"

**确认/反确认识别**：
- "确认" + 单号前缀(RK/XS/TH/JS) → "确认单据"
- "反确认"/"撤回确认"/"取消确认" + 单号 → "反确认单据"
- confirm_order_no 字段：RK=入库单, XS=销售单, TH=退货单, JS=结算单

请返回JSON格式，包含以下字段：
- action: 从 "确认单据" / "反确认单据" / "系统帮助" / "创建客户" / "创建供应商" / "闲聊" / "其他" 中选择
- confirm_order_no: 单据编号（仅当action为"确认单据"或"反确认单据"时）
- customer_name: 客户姓名（当action为"创建客户"时）
- phone: 电话（可选）
- address: 地址（可选）
- supplier_name: 供应商名称（当action为"创建供应商"时）
- contact_person: 联系人（可选）
- supplier_type: 供应商类型（可选，默认"个人"）

{_JSON_INSTRUCTION}

示例-确认1：
用户输入："确认入库单RK20260206069900"
{{"action": "确认单据", "confirm_order_no": "RK20260206069900", "products": null}}

示例-确认2：
用户输入："确认销售单XS20260206001"
{{"action": "确认单据", "confirm_order_no": "XS20260206001", "products": null}}

示例-反确认：
用户输入："反确认入库单RK20260206069900"
{{"action": "反确认单据", "confirm_order_no": "RK20260206069900", "products": null}}

示例-撤回确认：
用户输入："撤回确认XS20260206001"
{{"action": "反确认单据", "confirm_order_no": "XS20260206001", "products": null}}

示例-系统帮助1：
用户输入："怎么入库"
{{"action": "系统帮助", "products": null}}

示例-系统帮助2：
用户输入："退货流程是什么"
{{"action": "系统帮助", "products": null}}

示例-系统帮助3：
用户输入："系统有哪些功能"
{{"action": "系统帮助", "products": null}}

示例6（创建客户）：
用户输入："新建客户：张三 电话13800138000"
{{"action": "创建客户", "customer_name": "张三", "phone": "13800138000", "products": null}}

示例-创建供应商：
用户输入："新建供应商：鑫韵珠宝 电话13900139000 联系人王经理"
{{"action": "创建供应商", "supplier_name": "鑫韵珠宝", "phone": "13900139000", "contact_person": "王经理", "products": null}}

示例-闲聊1：
用户输入："你好"
{{"action": "闲聊", "products": null}}

示例-闲聊2：
用户输入："谢谢"
{{"action": "闲聊", "products": null}}

示例-闲聊3：
用户输入："1+1等于几"
{{"action": "闲聊", "products": null}}

示例-闲聊4：
用户输入："今天天气怎么样"
{{"action": "闲聊", "products": null}}
"""


def _get_ambiguous_product_prompt(message: str, context: str) -> str:
    """当用户输入包含商品信息但意图不明确时使用的通用 prompt。
    让 AI 根据用户角色和上下文来判断是入库、销售还是退货。"""
    
    return f"""{_SYSTEM_HEADER}
{context}
用户当前输入：{message}

用户输入了商品信息（包含克重和工费），但没有明确说明是什么操作。
请根据**用户角色**和输入内容推断最可能的意图：

可选的 action：
- "入库"：商品从供应商进入仓库（通常商品专员执行，输入中提到"供应商"时更可能）
- "创建销售单"：卖商品给客户（通常柜台执行，输入中提到"客户"时更可能）
- "退货"：退商品给供应商（输入中提到"退"时）
- "闲聊"：如果确实无法判断，返回闲聊

**推断规则**：
- 商品专员(product) + 供应商信息 → 大概率是"入库"
- 柜台(counter) + 客户信息 → 大概率是"创建销售单"
- 有"供应商"关键词 → 倾向于"入库"
- 有"客户"关键词 → 倾向于"创建销售单"
- 管理层且无法判断 → 返回"闲聊"，并建议用户明确操作类型

请返回JSON格式：
- action: 从上述选项中选择
- 入库时需要: products 数组（product_name, weight, labor_cost, supplier）
- 销售时需要: customer_name, items 数组（product_name, weight, labor_cost）, salesperson
- 退货时需要: return_product_name, return_weight, return_supplier_name, return_type

{_JSON_INSTRUCTION}

示例1（商品专员 + 供应商信息 → 入库）：
用户角色：商品专员
用户输入："足金手镯 10g 工费15 供应商测试珠宝"
{{"action": "入库", "products": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 15, "supplier": "测试珠宝"}}]}}

示例2（柜台 + 客户信息 → 销售）：
用户角色：柜台人员
用户输入："足金手镯 10g 工费15 客户张三"
{{"action": "创建销售单", "customer_name": "张三", "items": [{{"product_name": "足金手镯", "weight": 10, "labor_cost": 15}}]}}

示例3（管理层 + 无法判断 → 闲聊提示）：
用户角色：管理层
用户输入："足金手镯 10g 工费15"
{{"action": "闲聊"}}
"""


# ============================================================
# 4. get_category_prompt - 分发器
# ============================================================

def get_category_prompt(category: str, message: str, context: str, user_role: str = "manager") -> str:
    """根据分类结果调用对应的提示词生成器。

    Args:
        category: pre_classify() 返回的类别
        message: 用户原始输入
        context: build_context() 构建的对话上下文
        user_role: 当前用户角色

    Returns:
        完整的提示词字符串
    """
    # 将角色上下文注入到 context 中
    role_context = _build_role_context(user_role)
    enriched_context = context + role_context

    # 检测模糊输入：包含商品特征（数字+克/g+工费）但没有明确动词
    # 这类输入应该用通用 prompt 让 AI 根据角色自行判断
    has_product_info = bool(re.search(r'\d+[gG克]', message) and re.search(r'工费|元/[gG克]', message))
    has_explicit_verb = any(kw in message for kw in [
        '入库', '帮我入', '查询', '退', '卖给', '开单', '销售',
        '来料', '交料', '付料', '提料', '收款', '确认', '反确认',
        '怎么', '如何', '教我', '新建', '创建', '添加',
        '结算', '暂借', '借出', '归还', '还货', '对账', '凭证', '报销',
    ])
    
    if has_product_info and not has_explicit_verb and category in ("query", "system"):
        # 模糊商品输入 → 使用通用 prompt，让 AI 根据角色判断
        return _get_ambiguous_product_prompt(message, enriched_context)

    dispatch = {
        "inbound": get_inbound_prompt,
        "sales": get_sales_prompt,
        "return": get_return_prompt,
        "finance": get_finance_prompt,
        "query": get_query_prompt,
        "system": get_system_prompt,
    }

    prompt_fn = dispatch.get(category, get_system_prompt)
    return prompt_fn(message, enriched_context)
