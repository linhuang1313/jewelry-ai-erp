/**
 * 角色权限配置文件
 * 定义每个角色的功能权限和可访问页面
 */

// 角色权限矩阵
export const ROLE_PERMISSIONS = {
  // 柜台
  counter: {
    // 功能权限
    canInbound: false,              // 不能入库
    canCreateSales: true,           // 可以开销售单
    canCreateSettlement: false,     // 不能创建结算单
    canTransfer: false,             // 不能发起转移
    canReceiveTransfer: true,       // 可以接收转移
    canManageCustomers: true,       // 可以管理客户（创建/编辑/删除）
    canViewCustomers: true,         // 可以查看客户（查询/往来账）
    canManageSuppliers: false,      // 不能管理供应商
    canManageSalespersons: false,   // 不能管理业务员
    canViewAnalytics: false,        // 不能看数据分析
    canExport: false,               // 不能导出数据
    canDelete: false,               // 不能删除数据
    canReturnToSupplier: false,     // 不能退货给供应商
    canReturnToWarehouse: true,     // 可以退货给商品部
    canViewFinance: false,          // 不能查看财务
    // 暂借单权限
    canCreateLoan: true,            // 可以创建暂借单
    canManageLoan: true,            // 可以管理暂借单（确认借出、归还、撤销）
    
    // 可访问页面
    pages: ['chat', 'warehouse', 'customer', 'return', 'loan'],
  },
  
  // 商品专员
  product: {
    canInbound: true,               // 可以入库
    canCreateSales: false,          // 不能开销售单
    canCreateSettlement: false,     // 不能创建结算单
    canTransfer: true,              // 可以发起转移
    canReceiveTransfer: false,      // 不能接收转移（在商品部）
    canManageCustomers: false,      // 不能管理客户
    canViewCustomers: false,        // 不能查看客户
    canManageSuppliers: true,       // 可以管理供应商（但不能删除）
    canManageSalespersons: false,   // 不能管理业务员
    canViewAnalytics: false,        // 不能看数据分析
    canExport: false,               // 不能导出数据
    canDelete: false,               // 不能删除数据
    canReturnToSupplier: true,      // 可以退货给供应商
    canReturnToWarehouse: false,    // 不能退货给商品部
    canViewFinance: false,          // 不能查看财务
    canManageProductCodes: true,    // 可以管理商品编码（F/FL编码）
    // 采购单权限
    canViewPurchaseOrders: true,    // 可以查看采购单
    canViewPurchaseReturns: true,   // 可以查看采购退货单
    
    pages: ['chat', 'warehouse', 'supplier', 'return', 'product-codes', 'document-center'],
  },
  
  // 结算专员
  settlement: {
    canInbound: false,
    canCreateSales: false,
    canCreateSettlement: true,      // 可以创建结算单
    canTransfer: false,
    canReceiveTransfer: false,
    canManageCustomers: false,
    canViewCustomers: true,         // 可以查看客户（查询欠款）
    canQueryCustomerSales: true,    // 可以查询客户销售记录
    canManageSuppliers: false,
    canManageSalespersons: false,
    canViewAnalytics: false,
    canExport: false,
    canDelete: false,
    canReturnToSupplier: false,
    canReturnToWarehouse: true,     // 可以查看和操作退货到商品部（销退后查看退货单）
    canViewFinance: false,
    // 金料管理权限
    canCreateGoldReceipt: true,     // 可以创建收料单（收到客户原料后）
    canViewGoldMaterial: true,      // 可以查看金料记录
    canConfirmGoldReceive: false,   // 不能确认收到原料（料部职责）
    canCreateGoldPayment: false,    // 不能创建付料单（料部职责）
    canManageGoldMaterial: false,   // 不能管理金料流转
    // 客户取料/转料权限
    canCreateWithdrawal: true,      // 可以创建取料单
    canCompleteWithdrawal: false,   // 不能完成取料（料部职责）
    canCreateTransfer: true,        // 可以创建转料单
    canConfirmTransfer: false,      // 不能确认转料（料部职责）
    // 暂借单权限
    canCreateLoan: true,            // 可以创建暂借单
    canManageLoan: true,            // 可以管理暂借单（确认借出、归还、撤销）
    
    pages: ['chat', 'settlement', 'gold-material', 'customer', 'loan', 'returns'],
  },
  
  // 业务员 - 只能查询客户相关信息
  sales: {
    // 操作权限全部关闭
    canInbound: false,
    canCreateSales: false,          // 不能开销售单（只有柜台可以）
    canCreateSettlement: false,
    canTransfer: false,
    canReceiveTransfer: false,
    canManageCustomers: false,      // 不能管理客户（不能创建/编辑/删除）
    canManageSuppliers: false,
    canManageSalespersons: false,
    canViewAnalytics: false,
    canExport: false,
    canDelete: false,
    canReturnToSupplier: false,
    canReturnToWarehouse: false,
    canViewFinance: false,
    
    // 查询权限开启
    canViewCustomers: true,              // 可以查看客户列表
    canQueryCustomerSales: true,         // 可以查询客户销售记录
    canQueryCustomerReturns: true,       // 可以查询客户退货记录
    canQueryCustomerBalance: true,       // 可以查询客户欠款/存料余额
    canQueryCustomerTransactions: true,  // 可以查询客户往来账目
    
    pages: ['chat', 'customer'],
  },
  
  // 财务 - 权限与管理层一致
  finance: {
    canInbound: true,               // 可以查看入库单
    canCreateSales: false,          // 不能开销售单（财务不需要）
    canCreateSettlement: true,      // 可以查看结算单
    canTransfer: true,              // 可以查看转移单
    canReceiveTransfer: true,
    canManageCustomers: true,       // 可以管理客户
    canViewCustomers: true,         // 可以查看客户
    canManageSuppliers: true,       // 可以管理供应商
    canViewSuppliers: true,         // 可以查看供应商
    canManageSalespersons: true,    // 可以管理业务员
    canViewAnalytics: true,         // 可以看数据分析
    canExport: true,                // 可以导出数据
    canDelete: true,                // 可以删除数据
    canReturnToSupplier: true,      // 可以查看退货给供应商
    canReturnToWarehouse: true,     // 可以查看退货给商品部
    canViewFinance: true,           // 可以查看财务
    // 金料管理权限（全部）
    canCreateGoldReceipt: true,
    canViewGoldMaterial: true,
    canConfirmGoldReceive: true,
    canCreateGoldPayment: true,
    canManageGoldMaterial: true,
    // 客户取料/转料权限（全部）
    canCreateWithdrawal: true,
    canCompleteWithdrawal: true,
    canCreateTransfer: true,
    canConfirmTransfer: true,
    // 商品编码管理
    canManageProductCodes: true,
    // 暂借单权限
    canCreateLoan: true,
    canManageLoan: true,
    // 采购单权限
    canViewPurchaseOrders: true,
    canViewPurchaseReturns: true,
    
    pages: ['chat', 'warehouse', 'settlement', 'finance', 'analytics', 'export', 'salesperson', 'customer', 'supplier', 'return', 'gold-material', 'product-codes', 'loan', 'document-center'],
  },
  
  // 料部 - 管理金料的收发
  material: {
    canInbound: false,
    canCreateSales: false,
    canCreateSettlement: false,
    canTransfer: false,
    canReceiveTransfer: false,
    canManageCustomers: false,
    canViewCustomers: true,         // 可以查看客户（查询关联信息）
    canManageSuppliers: true,       // 可以管理供应商（添加、编辑，但不能删除）
    canViewSuppliers: true,         // 可以查看供应商（查询关联信息）
    canManageSalespersons: false,
    canViewAnalytics: false,
    canExport: false,
    canDelete: false,
    canReturnToSupplier: false,
    canReturnToWarehouse: false,
    canViewFinance: false,
    // 金料管理权限（核心职责）
    canCreateGoldReceipt: false,    // 不能创建收料单（结算专员职责）
    canViewGoldMaterial: true,      // 可以查看金料记录
    canConfirmGoldReceive: true,    // 可以确认收到原料（从结算同事处）
    canCreateGoldPayment: true,     // 可以创建付料单（支付供应商）
    canManageGoldMaterial: true,    // 可以管理金料流转（核心权限）
    // 客户取料/转料权限
    canCreateWithdrawal: false,     // 不能创建取料单（结算职责）
    canCompleteWithdrawal: true,    // 可以完成取料（发出金料）
    canCreateTransfer: false,       // 不能创建转料单（结算职责）
    canConfirmTransfer: true,       // 可以确认转料
    
    pages: ['chat', 'gold-material', 'customer', 'supplier'],
  },
  
  // 管理层 - 拥有所有权限
  manager: {
    canInbound: true,
    canCreateSales: true,
    canCreateSettlement: true,
    canTransfer: true,
    canReceiveTransfer: true,
    canManageCustomers: true,
    canViewCustomers: true,         // 可以查看客户
    canManageSuppliers: true,
    canViewSuppliers: true,         // 可以查看供应商
    canManageSalespersons: true,
    canViewAnalytics: true,
    canExport: true,
    canDelete: true,
    canReturnToSupplier: true,
    canReturnToWarehouse: true,
    canViewFinance: true,
    // 金料管理权限（全部）
    canCreateGoldReceipt: true,
    canViewGoldMaterial: true,
    canConfirmGoldReceive: true,
    canCreateGoldPayment: true,
    canManageGoldMaterial: true,
    // 客户取料/转料权限（全部）
    canCreateWithdrawal: true,
    canCompleteWithdrawal: true,
    canCreateTransfer: true,
    canConfirmTransfer: true,
    // 商品编码管理
    canManageProductCodes: true,
    // 暂借单权限
    canCreateLoan: true,            // 可以创建暂借单
    canManageLoan: true,            // 可以管理暂借单
    // 采购单权限
    canViewPurchaseOrders: true,    // 可以查看采购单
    canViewPurchaseReturns: true,   // 可以查看采购退货单
    
    pages: ['chat', 'warehouse', 'settlement', 'finance', 'analytics', 'export', 'salesperson', 'customer', 'supplier', 'return', 'gold-material', 'product-codes', 'loan', 'document-center'],
  }
};

/**
 * 检查角色是否有某个权限
 * @param {string} role - 角色ID
 * @param {string} permission - 权限名称
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }
  return ROLE_PERMISSIONS[role][permission] === true;
}

/**
 * 检查角色是否可以访问某个页面
 * @param {string} role - 角色ID
 * @param {string} page - 页面名称
 * @returns {boolean}
 */
export function canAccessPage(role, page) {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }
  return ROLE_PERMISSIONS[role].pages?.includes(page) || false;
}

/**
 * 获取角色的所有权限
 * @param {string} role - 角色ID
 * @returns {object|null}
 */
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || null;
}

/**
 * 获取权限不足的错误消息
 * @param {string} action - 操作名称
 * @returns {string}
 */
export function getPermissionDeniedMessage(action) {
  const actionMessages = {
    'inbound': '您没有商品入库的权限，请联系商品专员或管理层',
    'createSales': '您没有创建销售单的权限，请联系柜台人员或管理层',
    'createSettlement': '您没有创建结算单的权限，请联系结算专员或管理层',
    'transfer': '您没有发起库存转移的权限，请联系商品专员或管理层',
    'receiveTransfer': '您没有接收库存的权限，请联系柜台人员或管理层',
    'manageCustomers': '您没有客户管理的权限（创建/编辑/删除），请联系柜台人员或管理层',
    'viewCustomers': '您没有查看客户的权限，请联系柜台人员、业务员或管理层',
    'manageSuppliers': '您没有供应商管理的权限，请联系商品专员或管理层',
    'viewSuppliers': '您没有查看供应商的权限，请联系商品专员、料部或管理层',
    'manageSalespersons': '您没有业务员管理的权限，请联系管理层',
    'viewAnalytics': '您没有查看数据分析的权限，请联系管理层',
    'export': '您没有数据导出的权限，请联系管理层',
    'delete': '您没有删除数据的权限，请联系管理层',
    'returnToSupplier': '您没有退货给供应商的权限，请联系商品专员或管理层',
    'returnToWarehouse': '您没有退货给商品部的权限，请联系柜台人员或管理层',
    // 金料管理
    'createGoldReceipt': '您没有创建收料单的权限，请联系结算专员或管理层',
    'viewGoldMaterial': '您没有查看金料记录的权限，请联系结算专员、料部或管理层',
    'confirmGoldReceive': '您没有确认收到原料的权限，请联系料部或管理层',
    'createGoldPayment': '您没有创建付料单的权限，请联系料部或管理层',
    'manageGoldMaterial': '您没有管理金料流转的权限，请联系料部或管理层',
    // 客户取料/转料
    'createWithdrawal': '您没有创建取料单的权限，请联系结算专员或管理层',
    'completeWithdrawal': '您没有完成取料的权限，请联系料部或管理层',
    'createTransfer': '您没有创建转料单的权限，请联系结算专员或管理层',
    'confirmTransfer': '您没有确认转料的权限，请联系料部或管理层',
    // 暂借单
    'createLoan': '您没有创建暂借单的权限，请联系结算专员或管理层',
    'manageLoan': '您没有管理暂借单的权限，请联系结算专员或管理层',
  };
  
  return actionMessages[action] || '您没有执行此操作的权限';
}

// 权限名称映射（用于后端通信）
export const PERMISSION_ACTIONS = {
  '入库': 'canInbound',
  '创建销售单': 'canCreateSales',
  '创建结算单': 'canCreateSettlement',
  '创建转移单': 'canTransfer',
  '接收库存': 'canReceiveTransfer',
  '客户管理': 'canManageCustomers',
  '供应商管理': 'canManageSuppliers',
  '业务员管理': 'canManageSalespersons',
  '数据分析': 'canViewAnalytics',
  '数据导出': 'canExport',
  '删除': 'canDelete',
  // 金料管理
  '创建收料单': 'canCreateGoldReceipt',
  '查看金料': 'canViewGoldMaterial',
  '确认收料': 'canConfirmGoldReceive',
  '创建付料单': 'canCreateGoldPayment',
  '金料管理': 'canManageGoldMaterial',
  // 客户取料/转料
  '创建取料单': 'canCreateWithdrawal',
  '完成取料': 'canCompleteWithdrawal',
  '创建转料单': 'canCreateTransfer',
  '确认转料': 'canConfirmTransfer',
  // 暂借单
  '创建暂借单': 'canCreateLoan',
  '管理暂借单': 'canManageLoan',
};

