# 珠宝ERP系统 UI/UX 设计技能

## 技能描述
为珠宝ERP系统提供专业的UI/UX设计指导，确保界面美观、现代且符合珠宝行业的高端定位。

## 设计原则

### 1. 色彩系统
```
主色调（品牌色）:
- 主色: #C9A86C (香槟金) - 体现珠宝的高贵感
- 次色: #1E3A5F (深海蓝) - 体现专业与信任
- 强调色: #D4AF37 (金色) - 用于重要操作和高亮

功能色:
- 成功: #10B981 (翠绿)
- 警告: #F59E0B (琥珀)
- 错误: #EF4444 (宝石红)
- 信息: #3B82F6 (蓝宝石)

中性色:
- 背景: #F8F9FA (浅灰白)
- 卡片: #FFFFFF (纯白)
- 边框: #E5E7EB (浅灰)
- 文字主色: #111827 (深灰黑)
- 文字次色: #6B7280 (中灰)
```

### 2. 字体系统
```
中文字体: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif
英文/数字: "Inter", "SF Pro Display", -apple-system, sans-serif

字号层级:
- 大标题: 24px / font-bold
- 页面标题: 20px / font-semibold
- 卡片标题: 16px / font-semibold
- 正文: 14px / font-normal
- 辅助文字: 12px / font-normal

金额显示:
- 使用等宽字体: "SF Mono", "Consolas", monospace
- 金额突出显示: text-lg font-bold text-amber-600
```

### 3. 间距系统
```
基础单位: 4px

常用间距:
- xs: 4px (padding-1)
- sm: 8px (padding-2)
- md: 16px (padding-4)
- lg: 24px (padding-6)
- xl: 32px (padding-8)

卡片间距: gap-4 到 gap-6
页面边距: px-6 py-4
```

### 4. 圆角系统
```
按钮: rounded-lg (8px)
卡片: rounded-xl (12px)
模态框: rounded-2xl (16px)
头像/标签: rounded-full
输入框: rounded-lg (8px)
```

### 5. 阴影系统
```
卡片悬浮: shadow-sm → hover:shadow-md
模态框: shadow-xl
下拉菜单: shadow-lg
悬浮按钮: shadow-md
```

## 组件规范

### 按钮样式
```jsx
// 主按钮 - 金色渐变
<button className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 
  text-white font-medium rounded-lg shadow-sm 
  hover:from-amber-600 hover:to-yellow-600 
  transition-all duration-200">
  确认
</button>

// 次要按钮 - 蓝色
<button className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg 
  hover:bg-blue-700 transition-colors">
  保存
</button>

// 危险按钮 - 红色
<button className="px-4 py-2 bg-red-500 text-white font-medium rounded-lg 
  hover:bg-red-600 transition-colors">
  删除
</button>

// 轮廓按钮
<button className="px-4 py-2 border border-gray-300 text-gray-700 
  font-medium rounded-lg hover:bg-gray-50 transition-colors">
  取消
</button>
```

### 卡片样式
```jsx
// 标准卡片
<div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 
  hover:shadow-md transition-shadow">
  <h3 className="text-lg font-semibold text-gray-900 mb-4">卡片标题</h3>
  <div className="text-gray-600">内容区域</div>
</div>

// 指标卡片
<div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl 
  border border-amber-200/50 p-5">
  <p className="text-sm text-amber-700">今日销售额</p>
  <p className="text-2xl font-bold text-amber-900 mt-1">¥125,800</p>
  <p className="text-xs text-amber-600 mt-2">↑ 12.5% 较昨日</p>
</div>
```

### 表格样式
```jsx
<table className="w-full text-sm">
  <thead className="bg-gray-50 border-b border-gray-200">
    <tr>
      <th className="px-4 py-3 text-left font-medium text-gray-600">列标题</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-gray-100">
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-gray-900">数据</td>
    </tr>
  </tbody>
</table>
```

### 输入框样式
```jsx
<input 
  type="text"
  className="w-full px-3 py-2 border border-gray-200 rounded-lg 
    focus:ring-2 focus:ring-amber-500 focus:border-amber-500 
    transition-colors placeholder:text-gray-400"
  placeholder="请输入..."
/>
```

### 标签/徽章样式
```jsx
// 状态标签
<span className="px-2 py-1 text-xs font-medium rounded-full 
  bg-green-100 text-green-700">已完成</span>
<span className="px-2 py-1 text-xs font-medium rounded-full 
  bg-amber-100 text-amber-700">进行中</span>
<span className="px-2 py-1 text-xs font-medium rounded-full 
  bg-red-100 text-red-700">待处理</span>
```

## 页面布局模板

### 管理页面布局
```jsx
<div className="min-h-screen bg-gray-50">
  {/* 页面头部 */}
  <div className="bg-white border-b border-gray-200 px-6 py-4">
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold text-gray-900">页面标题</h1>
      <button className="...">操作按钮</button>
    </div>
  </div>
  
  {/* 内容区域 */}
  <div className="p-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 卡片 */}
    </div>
  </div>
</div>
```

### 仪表盘布局
```jsx
<div className="p-6 bg-gray-50 min-h-screen">
  {/* 指标卡片区 */}
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
    {/* 指标卡片 */}
  </div>
  
  {/* 图表区 */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
    {/* 图表卡片 */}
  </div>
  
  {/* 数据表格区 */}
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    {/* 表格 */}
  </div>
</div>
```

## 动效规范

### 过渡动画
```css
/* 按钮/链接悬浮 */
transition-all duration-200

/* 卡片悬浮 */
transition-shadow duration-200

/* 颜色变化 */
transition-colors duration-150

/* 模态框进入 */
animate-in fade-in zoom-in-95 duration-200

/* 加载动画 */
animate-spin (用于加载图标)
animate-pulse (用于骨架屏)
```

### 微交互
```jsx
// 按钮点击反馈
<button className="active:scale-95 transition-transform">

// 卡片点击反馈
<div className="cursor-pointer active:scale-[0.98] transition-transform">

// 图标旋转
<RefreshCw className="w-4 h-4 animate-spin" />
```

## 响应式断点

```
sm: 640px   - 手机横屏
md: 768px   - 平板
lg: 1024px  - 笔记本
xl: 1280px  - 桌面
2xl: 1536px - 大屏
```

## 暗色模式（可选）

```jsx
// 暗色背景
dark:bg-gray-900

// 暗色卡片
dark:bg-gray-800 dark:border-gray-700

// 暗色文字
dark:text-gray-100 dark:text-gray-300

// 暗色边框
dark:border-gray-700
```

## 图标使用

推荐使用 Lucide React 图标库：
```jsx
import { 
  DollarSign,    // 金额
  Package,       // 库存/商品
  Users,         // 客户/用户
  TrendingUp,    // 趋势/增长
  ShoppingBag,   // 销售
  BarChart3,     // 图表
  Settings,      // 设置
  Search,        // 搜索
  Plus,          // 添加
  Download,      // 下载
  Printer        // 打印
} from 'lucide-react';
```

## 珠宝行业特色元素

### 克重显示
```jsx
<span className="font-mono text-gray-900">
  {weight.toFixed(2)}<span className="text-gray-500 text-sm ml-0.5">克</span>
</span>
```

### 金价显示
```jsx
<div className="bg-gradient-to-r from-amber-100 to-yellow-100 
  rounded-lg px-3 py-2 inline-flex items-center gap-2">
  <span className="text-amber-600 text-sm">今日金价</span>
  <span className="text-amber-900 font-bold">¥680/克</span>
</div>
```

### 工费计算
```jsx
<div className="text-right">
  <p className="text-sm text-gray-500">工费</p>
  <p className="text-lg font-semibold text-blue-600">
    ¥{(weight * laborCost).toFixed(2)}
  </p>
</div>
```

## 使用方式

当需要改进UI时，参考此技能文件中的设计规范。可以这样请求：

1. "按照珠宝ERP设计规范，优化这个页面"
2. "使用金色主题重新设计这个按钮"
3. "按照规范添加卡片悬浮效果"
4. "用珠宝行业风格改进仪表盘"

