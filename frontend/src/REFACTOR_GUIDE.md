# 珠宝ERP前端代码拆分指南

## 已完成的组件拆分

### 1. 目录结构

```
frontend/src/
├── components/
│   ├── layout/           # 布局组件
│   │   ├── Sidebar.jsx       # 侧边栏（历史对话）
│   │   ├── Header.jsx        # 顶部导航栏
│   │   └── index.js
│   ├── chat/             # 聊天组件
│   │   ├── InputArea.jsx     # 输入区域
│   │   ├── ThinkingIndicator.jsx  # AI思考动画
│   │   ├── ThinkingMessage.jsx    # 思考步骤消息
│   │   ├── WelcomeScreen.jsx      # 欢迎界面
│   │   └── index.js
│   ├── modals/           # 弹窗组件
│   │   ├── OCRModal.jsx          # OCR编辑弹窗
│   │   ├── QuickReceiptModal.jsx # 快捷收料弹窗
│   │   ├── QuickWithdrawalModal.jsx # 快捷提料弹窗
│   │   └── index.js
│   └── ... (其他已有组件)
├── hooks/                # 自定义Hooks
│   ├── useUserRole.js        # 用户角色管理
│   ├── useConversationHistory.js  # 对话历史管理
│   └── index.js
├── services/             # API服务
│   └── chatService.js        # 聊天相关API
└── utils/                # 工具函数
    ├── messageParser.js      # 消息解析
    └── userIdentifier.js     # 用户标识
```

### 2. 如何在App.jsx中使用新组件

#### 2.1 导入新组件

在App.jsx顶部添加导入：

```jsx
// 布局组件
import { Sidebar, Header } from './components/layout'
// 聊天组件
import { InputArea, ThinkingIndicator, ThinkingMessage, WelcomeScreen } from './components/chat'
// 弹窗组件
import { OCRModal, QuickReceiptModal, QuickWithdrawalModal } from './components/modals'
// Hooks
import { useConversationHistory } from './hooks'
// 工具函数
import { parseMessageHiddenMarkers } from './utils/messageParser'
// 服务
import chatService from './services/chatService'
```

#### 2.2 替换侧边栏

将原来的侧边栏代码替换为：

```jsx
<Sidebar
  isOpen={sidebarOpen}
  onClose={() => setSidebarOpen(false)}
  conversationHistory={conversationHistory}
  currentConversationId={currentConversationId}
  userRole={userRole}
  onNewConversation={newConversation}
  onLoadConversation={loadConversation}
  onDeleteConversation={(id) => deleteConversation(id, { stopPropagation: () => {} })}
/>
```

#### 2.3 替换顶部导航栏

将原来的Header代码替换为：

```jsx
<Header
  currentPage={currentPage}
  setCurrentPage={setCurrentPage}
  userRole={userRole}
  roleDropdownOpen={roleDropdownOpen}
  setRoleDropdownOpen={setRoleDropdownOpen}
  roleLoading={roleLoading}
  roleDropdownRef={roleDropdownRef}
  getCurrentRole={getCurrentRole}
  changeUserRole={changeUserRole}
  sidebarOpen={sidebarOpen}
  setSidebarOpen={setSidebarOpen}
  pendingTransferCount={pendingTransferCount}
  pendingSalesCount={pendingSalesCount}
  setShowQuickOrderModal={setShowQuickOrderModal}
  setShowSalesSearchModal={setShowSalesSearchModal}
  setShowHistoryPanel={setShowHistoryPanel}
  currentLanguage={currentLanguage}
  i18n={i18n}
/>
```

#### 2.4 替换输入区域

将原来的footer代码替换为：

```jsx
<InputArea
  input={input}
  setInput={setInput}
  onSend={sendMessage}
  loading={loading}
  uploading={uploading}
  userRole={userRole}
  onImageUpload={handleImageUpload}
  onQuickInbound={() => setShowQuickInboundModal(true)}
  onQuickOrder={() => setShowQuickOrderModal(true)}
  onQuickReturn={() => setShowQuickReturnModal(true)}
  onQuickReceipt={openQuickReceiptModal}
  onQuickWithdrawal={openQuickWithdrawalModal}
/>
```

#### 2.5 替换欢迎界面

将聊天页面的空消息提示替换为：

```jsx
{messages.length === 0 && (
  <WelcomeScreen
    userRole={userRole}
    setInput={setInput}
    setShowQuickOrderModal={setShowQuickOrderModal}
    setShowQuickInboundModal={setShowQuickInboundModal}
    setShowQuickReturnModal={setShowQuickReturnModal}
    setCurrentPage={setCurrentPage}
  />
)}
```

#### 2.6 替换思考指示器

将AI思考动画替换为：

```jsx
{(loading || uploading) && (
  <ThinkingIndicator uploading={uploading} />
)}
```

#### 2.7 替换弹窗组件

```jsx
{/* OCR编辑弹窗 */}
<OCRModal
  isOpen={showOCRModal}
  onClose={() => {
    setShowOCRModal(false)
    setOcrResult('')
    setUploadedImage(null)
  }}
  ocrResult={ocrResult}
  setOcrResult={setOcrResult}
  uploadedImage={uploadedImage}
  onConfirm={handleConfirmInbound}
  loading={loading}
/>

{/* 快捷收料弹窗 */}
<QuickReceiptModal
  isOpen={showQuickReceiptModal}
  onClose={() => setShowQuickReceiptModal(false)}
  onSuccess={(result) => {
    // 处理成功回调
    const downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${result.id}/print`
    setMessages(prev => [...prev, {
      id: Date.now(),
      type: 'system',
      content: `✅ 收料单已生成...`,
      goldReceiptDownloadUrl: downloadUrl,
      goldReceiptId: result.id
    }])
  }}
  showToast={showToast}
/>

{/* 快捷提料弹窗 */}
<QuickWithdrawalModal
  isOpen={showQuickWithdrawalModal}
  onClose={() => setShowQuickWithdrawalModal(false)}
  onSuccess={(result) => {
    // 处理成功回调
  }}
  userRole={userRole}
  showToast={showToast}
/>
```

### 3. 使用自定义Hooks

#### 3.1 使用 useConversationHistory

```jsx
const {
  conversationHistory,
  currentConversationId,
  conversationTitle,
  currentSessionId,
  loadRoleHistory,
  saveConversation,
  loadConversation,
  newConversation,
  deleteConversation
} = useConversationHistory(userRole)
```

### 4. 使用API服务

```jsx
import chatService from './services/chatService'

// 获取客户列表
const customers = await chatService.getCustomers()

// 获取客户存料余额
const deposit = await chatService.getCustomerDeposit(customerId)

// 创建收料单
const result = await chatService.createGoldReceipt(data)

// 获取待处理转移单数量
const count = await chatService.getPendingTransferCount(userRole)
```

### 5. 渐进式迁移建议

1. **第一阶段**：替换布局组件（Sidebar, Header）
   - 风险低，不影响核心业务逻辑

2. **第二阶段**：替换输入区域和欢迎界面
   - 测试聊天功能是否正常

3. **第三阶段**：替换弹窗组件
   - 逐个替换，每次替换后测试

4. **第四阶段**：使用自定义Hooks重构状态管理
   - 需要仔细测试对话历史功能

5. **第五阶段**：消息渲染组件化
   - 这是最复杂的部分，建议创建MessageBubble组件处理不同消息类型

### 6. 组件规格

| 组件 | 行数 | 功能 |
|------|------|------|
| Sidebar.jsx | ~120 | 侧边栏历史对话列表 |
| Header.jsx | ~500 | 顶部导航栏、角色切换、页面导航 |
| InputArea.jsx | ~160 | 聊天输入区域、快捷按钮 |
| ThinkingIndicator.jsx | ~30 | AI思考动画 |
| ThinkingMessage.jsx | ~50 | 思考步骤展示 |
| WelcomeScreen.jsx | ~350 | 欢迎界面、快捷操作卡片 |
| OCRModal.jsx | ~130 | OCR编辑弹窗 |
| QuickReceiptModal.jsx | ~180 | 快捷收料弹窗 |
| QuickWithdrawalModal.jsx | ~230 | 快捷提料弹窗 |
| useUserRole.js | ~100 | 用户角色Hook |
| useConversationHistory.js | ~230 | 对话历史Hook |
| chatService.js | ~180 | 聊天API服务 |
| messageParser.js | ~120 | 消息解析工具 |

### 7. 原App.jsx备份

原文件已备份为 `App.jsx.backup`，如需回滚可直接恢复。

### 8. 注意事项

- 消息渲染逻辑（各种卡片类型、图表等）由于过于复杂，建议后续单独处理
- 所有新组件都保持了与原代码相同的样式和功能
- API调用路径保持不变
