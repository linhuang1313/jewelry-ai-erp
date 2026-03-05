import React, { useState } from 'react'
import { X, MessageSquare, Users, Package, Calculator, Scale, DollarSign, BarChart3, HelpCircle, ChevronRight, Paperclip, Bell, AtSign, ArrowRight } from 'lucide-react'

const ROLE_GUIDES = {
  sales: {
    name: '业务员',
    icon: Users,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    description: '你负责跟客户对接，了解欠款和存料情况，客户打款后通知财务和结算确认。',
    capabilities: [
      '查询客户信息（欠款、存料、销售记录）',
      '发起收款协同（@财务 @结算）',
      '查看客户列表（只读）',
    ],
    chatExamples: [
      { label: '查客户欠款', text: '查一下李老板的欠款' },
      { label: '查客户存料', text: '张三目前存料多少' },
      { label: '客户打款通知', text: '@财务 @结算 李老板打款了5万，金款4万，工费1万', note: '需附带转账截图' },
    ],
    workbenchPages: ['客户管理（只读）'],
    tips: ['发起收款协同时必须上传转账截图，否则系统不允许发送。'],
  },
  counter: {
    name: '柜台',
    icon: Calculator,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    description: '你负责在展厅接待客户，开销售单、接收转移、管理客户和暂借。',
    capabilities: [
      '创建销售单',
      '接收库存转移',
      '退货给商品部',
      '管理客户（增删改查）',
      '暂借管理（创建、确认、归还）',
      '发起结算协同',
    ],
    chatExamples: [
      { label: '开销售单', text: '帮李老板开销售单，金镯子50克工费30' },
      { label: '发起结算（结料）', text: '@结算 李老板要结算，结料' },
      { label: '发起结算（结价）', text: '@结算 李老板要结价，金价680' },
      { label: '查今天销售单', text: '查一下今天的销售单' },
      { label: '创建暂借单', text: '帮张三借出金手链，30克' },
    ],
    workbenchPages: ['分仓转移', '客户管理', '退库管理', '暂借管理'],
    tips: ['结价方式必须在消息里写明金价。', '发起结算前需要先有已确认的销售单。'],
  },
  product: {
    name: '商品专员',
    icon: Package,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    description: '你负责管理仓库商品，包括入库、转移、退供应商和商品编码。',
    capabilities: [
      '商品入库（单件或批量）',
      '发起库存转移（仓库→展厅）',
      '退货给供应商',
      '管理供应商（增删改查）',
      '管理商品编码（F码/FL码）',
      '标签设计和打印',
    ],
    chatExamples: [
      { label: '入库', text: '入库 金镯子 50克 工费30 供应商张三金店' },
      { label: '查入库单', text: '查一下今天的入库单' },
      { label: '查库存', text: '金镯子库存多少' },
      { label: '查供应商', text: '查一下供应商张三金店的信息' },
    ],
    workbenchPages: ['分仓转移', '供应商管理', '退库管理', '商品编码', '标签样式管理'],
    tips: [],
  },
  settlement: {
    name: '结算专员',
    icon: Scale,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    description: '你负责确认结算方式、处理收款、金料收料和销退。',
    capabilities: [
      '创建/确认结算单（结料/结价/混合）',
      '登记客户收款',
      '创建收料单',
      '处理销退（客户退货）',
      '暂借管理',
      '发起收款协同',
    ],
    chatExamples: [
      { label: '创建结算单（结料）', text: '帮李老板创建结算单，结料' },
      { label: '创建结算单（结价）', text: '帮李老板创建结算单，结价，金价680' },
      { label: '查结算单', text: '查询今天的结算单' },
      { label: '通知财务收款', text: '@财务 李老板打款了3万，都是工费', note: '需附带转账截图' },
      { label: '创建暂借单', text: '帮张三借出金手链，30克' },
    ],
    workbenchPages: ['结算管理', '金料管理', '客户管理', '暂借管理', '退库管理', '销退管理'],
    tips: ['结价方式必须在消息里写明金价。', '结算单必须基于已确认的销售单。'],
  },
  material: {
    name: '料部',
    icon: Scale,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    description: '你负责管理实物金料，确认收料、付料、提料和转料。',
    capabilities: [
      '确认收到原料',
      '付料给供应商',
      '完成客户提料',
      '确认转料',
      '查看供应商金料账户',
    ],
    chatExamples: [
      { label: '查收料记录', text: '查一下今天的收料记录' },
      { label: '查供应商金料', text: '查一下供应商张三金店的金料余额' },
      { label: '查客户存料', text: '李老板目前存料多少' },
    ],
    workbenchPages: ['金料管理', '客户管理', '供应商管理'],
    tips: ['当有人 @你确认提料时，你会看到提料确认卡片，核实后点"确认"即可。'],
  },
  finance: {
    name: '财务',
    icon: DollarSign,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    description: '你负责整个财务体系：凭证管理、收付款确认、对账和期末结转。',
    capabilities: [
      '管理财务凭证（创建、记账、反记账）',
      '确认收款（协同卡片）',
      '财务对账',
      '期末结转',
      '查看/导出所有数据',
      '管理客户和供应商',
    ],
    chatExamples: [
      { label: '查对账单', text: '查一下李老板2月的对账单' },
      { label: '查凭证', text: '查询本月的收款凭证' },
      { label: '费用报销', text: '帮我报销 出差费用 500元' },
      { label: '查欠款', text: '查一下所有客户的欠款情况' },
    ],
    workbenchPages: ['财务对账', '凭证管理', '基础设置', '期末结转', '财务报表', '及其他所有页面'],
    tips: [
      '收到收款确认卡片时，系统已自动 OCR 核对过截图金额。',
      '确认后系统会自动更新款料表、生成收据、创建未记账凭证。',
    ],
  },
  manager: {
    name: '管理层',
    icon: BarChart3,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    description: '你拥有系统所有功能的权限，负责全面管理和监控。',
    capabilities: [
      '全部功能',
      '数据分析和报表',
      '审批和确认操作',
      '系统管理和数据维护',
    ],
    chatExamples: [
      { label: '查库存', text: '当前库存多少' },
      { label: '查客户', text: '查一下李老板的所有信息' },
      { label: '开销售单', text: '帮张三开销售单，金镯子50克工费30' },
      { label: '查对账单', text: '查一下李老板本月的对账单' },
    ],
    workbenchPages: ['全部页面'],
    tips: ['你可以使用所有角色的聊天指令。'],
  },
}

const COMMON_GUIDE = [
  { icon: MessageSquare, title: '聊天框', desc: '打开系统首页就是聊天框，直接打字让 AI 帮你操作。' },
  { icon: Paperclip, title: '上传图片', desc: '点聊天框左边的 📎 按钮选择图片，和文字一起发送。' },
  { icon: AtSign, title: '@角色 协同', desc: '输入 @ 弹出角色列表，选中后发送。对方确认后自动执行。' },
  { icon: Bell, title: '待办通知', desc: '右上角铃铛显示待处理任务数量，点击查看协同确认卡片。' },
]

export default function HelpGuide({ isOpen, onClose, userRole }) {
  const [activeTab, setActiveTab] = useState('role')
  const guide = ROLE_GUIDES[userRole] || ROLE_GUIDES.sales
  const RoleIcon = guide.icon

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white shadow-2xl animate-in slide-in-from-right duration-300 
                      flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">使用帮助</h2>
              <p className="text-xs text-gray-500">当前角色：{guide.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          <button
            onClick={() => setActiveTab('role')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'role'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            我的角色指南
          </button>
          <button
            onClick={() => setActiveTab('common')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'common'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            通用操作
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {activeTab === 'role' ? (
            <RoleGuideContent guide={guide} RoleIcon={RoleIcon} />
          ) : (
            <CommonGuideContent />
          )}
        </div>
      </div>
    </div>
  )
}

function RoleGuideContent({ guide, RoleIcon }) {
  return (
    <>
      {/* Role header card */}
      <div className={`rounded-xl p-4 ${guide.bg} border ${guide.border}`}>
        <div className="flex items-center gap-3 mb-2">
          <RoleIcon className={`w-5 h-5 ${guide.color}`} />
          <span className={`font-semibold ${guide.color}`}>{guide.name}</span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{guide.description}</p>
      </div>

      {/* Capabilities */}
      <Section title="你能做什么">
        <ul className="space-y-1.5">
          {guide.capabilities.map((cap, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-amber-500 mt-0.5">•</span>
              <span>{cap}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Chat examples */}
      <Section title="聊天框怎么用">
        <div className="space-y-2.5">
          {guide.chatExamples.map((ex, i) => (
            <div key={i} className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs font-medium text-gray-500 mb-1">{ex.label}</div>
              <div className="text-sm text-gray-800 bg-white rounded-md px-3 py-2 border border-gray-200 font-mono">
                {ex.text}
              </div>
              {ex.note && (
                <div className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  {ex.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Workbench */}
      <Section title="工作台入口">
        <div className="flex flex-wrap gap-2">
          {guide.workbenchPages.map((page, i) => (
            <span
              key={i}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
            >
              {page}
            </span>
          ))}
        </div>
      </Section>

      {/* Tips */}
      {guide.tips.length > 0 && (
        <Section title="注意事项">
          <div className="space-y-2">
            {guide.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <span className="shrink-0">⚠️</span>
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function CommonGuideContent() {
  return (
    <>
      <p className="text-sm text-gray-500">以下操作所有角色都可以使用。</p>

      <div className="space-y-3">
        {COMMON_GUIDE.map((item, i) => {
          const Icon = item.icon
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-gray-50 p-4">
              <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                <div className="text-sm text-gray-600 mt-0.5 leading-relaxed">{item.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* FAQ */}
      <Section title="常见问题">
        <div className="space-y-3">
          <FAQ q="发消息后没反应？" a="检查网络是否正常，AI 服务繁忙时稍等几秒再试。" />
          <FAQ q={'提示「请附带转账截图」？'} a="收款协同必须上传截图。先点 📎 上传图片，再输入消息一起发送。" />
          <FAQ q={'结算时提示「必须提供金价」？'} a="结价方式需在消息里写明金价，如：@结算 李老板结价，金价680" />
          <FAQ q={'提示「没有已确认的销售单」？'} a="结算单需基于已确认的销售单，请先开好销售单再发起结算。" />
          <FAQ q="看不到某个菜单？" a="不同角色权限不同。需要某功能请联系管理员调整角色。" />
        </div>
      </Section>
    </>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5">
        <ChevronRight className="w-4 h-4 text-amber-500" />
        {title}
      </h3>
      {children}
    </div>
  )
}

function FAQ({ q, a }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-sm font-medium text-gray-800">Q：{q}</div>
      <div className="text-sm text-gray-600 mt-1">{a}</div>
    </div>
  )
}
