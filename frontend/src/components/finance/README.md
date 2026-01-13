# 财务对账模块

## 功能概述

财务对账模块提供了完整的应收账款管理功能，包括：

1. **统计概览**：总应收账款、本月回款、逾期金额、待催款客户数量
2. **应收明细**：查看、筛选、搜索应收账款记录
3. **收款记录**：记录和管理客户收款
4. **催款管理**：管理逾期客户的催款记录和话术生成
5. **对账单**：生成和导出客户对账单

## 使用方法

### 方法1：在App.jsx中集成

在 `App.jsx` 中添加简单的路由切换：

```jsx
import { FinancePage } from './components/finance';

// 在App组件中添加状态
const [currentPage, setCurrentPage] = useState('chat'); // 'chat' 或 'finance'

// 在渲染中添加导航
{currentPage === 'finance' ? (
  <FinancePage />
) : (
  // 原有的聊天界面
)}
```

### 方法2：创建独立路由

如果使用 React Router，可以这样配置：

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { FinancePage } from './components/finance';

<BrowserRouter>
  <Routes>
    <Route path="/" element={<App />} />
    <Route path="/finance" element={<FinancePage />} />
  </Routes>
</BrowserRouter>
```

### 方法3：临时测试

修改 `main.jsx` 临时切换到财务页面：

```jsx
import FinanceTestPage from './FinanceTestPage';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FinanceTestPage />
  </React.StrictMode>,
)
```

## 组件结构

```
components/finance/
├── FinancePage.tsx              # 主页面组件
├── FinanceStatsCards.tsx        # 统计卡片组件
├── AccountReceivableTable.tsx   # 应收明细表格
├── PaymentRecordTable.tsx       # 收款记录表格
├── ReminderManagement.tsx       # 催款管理组件
├── ReconciliationGenerator.tsx  # 对账单生成器
└── index.ts                     # 统一导出
```

## 数据源

目前使用 Mock 数据（`mockFinanceData.ts`），后续需要：

1. 创建后端 API 接口
2. 创建 `services/financeService.ts` 调用 API
3. 在组件中替换 Mock 数据为真实 API 调用

## 待实现功能

- [ ] 记录收款弹窗
- [ ] 催款记录弹窗
- [ ] AI生成催款话术
- [ ] 对账单生成API
- [ ] 导出PDF功能
- [ ] 发送对账单给客户
- [ ] 打印功能

## 样式说明

所有组件使用 Tailwind CSS，已实现响应式布局，支持移动端和桌面端。


