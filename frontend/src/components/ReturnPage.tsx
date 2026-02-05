import React, { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config';
import { hasPermission } from '../config/permissions';
import { QuickReturnModal } from './QuickReturnModal';

// 退货商品明细
interface ReturnOrderItem {
  id: number;
  product_name: string;
  return_weight: number;
  labor_cost: number;
  piece_count: number | null;
  piece_labor_cost: number | null;
  total_labor_cost: number;
  remark: string | null;
}

interface ReturnOrder {
  id: number;
  return_no: string;
  return_type: string;
  product_name: string;
  return_weight: number;
  // 多商品汇总字段
  total_weight: number;
  total_labor_cost: number;
  item_count: number;
  items: ReturnOrderItem[];
  // 位置和供应商
  from_location_id: number | null;
  from_location_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  inbound_order_id: number | null;
  inbound_order_no: string | null;
  return_reason: string;
  reason_detail: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  completed_by: string | null;
  completed_at: string | null;
  images: string | null;
  remark: string | null;
  // 财务审核字段
  is_audited?: boolean;
  audited_by?: string | null;
  audited_at?: string | null;
}

interface ReturnStats {
  total_count: number;
  pending_count: number;
  approved_count: number;
  completed_count: number;
  rejected_count: number;
  to_supplier_count: number;
  to_warehouse_count: number;
  total_completed_weight: number;
  reason_stats: Record<string, { count: number; weight: number }>;
}

interface ReturnPageProps {
  userRole: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: '#f59e0b' },
  approved: { label: '已批准', color: '#3b82f6' },
  completed: { label: '已完成', color: '#10b981' },
  rejected: { label: '已驳回', color: '#ef4444' },
};

const TYPE_MAP: Record<string, string> = {
  to_supplier: '退给供应商',
  to_warehouse: '退给商品部',
};

export default function ReturnPage({ userRole }: ReturnPageProps) {
  const [returns, setReturns] = useState<ReturnOrder[]>([]);
  const [stats, setStats] = useState<ReturnStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<ReturnOrder | null>(null);
  
  // 筛选条件
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  
  // 下载菜单
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // 加载数据
  useEffect(() => {
    fetchReturns();
    fetchStats();
  }, [filterType, filterStatus, keyword]);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.append('return_type', filterType);
      if (filterStatus) params.append('status', filterStatus);
      if (keyword) params.append('keyword', keyword);
      
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns?${params}`);
      const data = await res.json();
      if (data.success) {
        setReturns(data.returns);
      }
    } catch (error) {
      console.error('获取退货单失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns/stats/summary`);
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  };

  const handleApprove = async (returnOrder: ReturnOrder) => {
    if (!confirm(`确认审批通过退货单 ${returnOrder.return_no}？`)) return;
    
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns/${returnOrder.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: userRole }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(data.message);
        fetchReturns();
        fetchStats();
      } else {
        alert(data.message || '审批失败');
      }
    } catch (error) {
      console.error('审批失败:', error);
      alert('审批失败，请重试');
    }
  };

  const handleReject = async (returnOrder: ReturnOrder) => {
    const reason = prompt('请输入驳回原因:');
    if (!reason) return;
    
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns/${returnOrder.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejected_by: userRole, reject_reason: reason }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(data.message);
        fetchReturns();
        fetchStats();
      } else {
        alert(data.message || '驳回失败');
      }
    } catch (error) {
      console.error('驳回失败:', error);
      alert('驳回失败，请重试');
    }
  };

  const handleComplete = async (returnOrder: ReturnOrder) => {
    if (!confirm(`确认完成退货单 ${returnOrder.return_no}？\n完成后将扣减库存 ${returnOrder.return_weight}g`)) return;
    
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns/${returnOrder.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed_by: userRole }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(data.message);
        fetchReturns();
        fetchStats();
      } else {
        alert(data.message || '完成失败');
      }
    } catch (error) {
      console.error('完成退货失败:', error);
      alert('完成失败，请重试');
    }
  };

  // 点击外部关闭下载菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 打印退货单
  const handlePrintReturn = async (returnOrder: ReturnOrder, docType: string = 'return') => {
    try {
      const url = `${API_ENDPOINTS.API_BASE_URL}/api/returns/${returnOrder.id}/download?format=html&doc_type=${docType}`;
      const response = await fetch(url);
      const html = await response.text();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
      }
    } catch (error) {
      console.error('打印失败:', error);
      alert('打印失败，请重试');
    }
  };

  // 下载退货单 PDF
  const handleDownloadReturn = async (returnOrder: ReturnOrder, docType: string = 'return') => {
    try {
      const docTypeNames: Record<string, string> = {
        return: '退货单',
        stock_out: '退库单',
        purchase_return: '采购退货单'
      };
      const url = `${API_ENDPOINTS.API_BASE_URL}/api/returns/${returnOrder.id}/download?format=pdf&doc_type=${docType}`;
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${docTypeNames[docType] || '退货单'}_${returnOrder.return_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      setShowDownloadMenu(false);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败，请重试');
    }
  };

  // 审批权限：管理层或商品专员（可以退给供应商的角色）
  const canApprove = hasPermission(userRole, 'canDelete') || hasPermission(userRole, 'canReturnToSupplier');
  // 创建权限：任何有退货权限的角色
  const canCreate = hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse');
  // 财务审核权限：财务和管理层
  const canAuditReturn = hasPermission(userRole, 'canAuditReturn');
  
  // 财务审核退货单
  const handleAuditReturn = async (returnId: number) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.RETURNS}/${returnId}/audit?user_role=${encodeURIComponent(userRole)}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        alert('审核成功');
        fetchReturns();
      } else {
        alert(data.error || '审核失败');
      }
    } catch (error) {
      console.error('审核失败:', error);
      alert('审核失败，请重试');
    }
  };

  // 财务反审退货单
  const handleUnauditReturn = async (returnId: number) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.RETURNS}/${returnId}/unaudit?user_role=${encodeURIComponent(userRole)}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        alert('反审成功');
        fetchReturns();
      } else {
        alert(data.error || '反审失败');
      }
    } catch (error) {
      console.error('反审失败:', error);
      alert('反审失败，请重试');
    }
  };
  
  // 退货单创建成功后的回调
  const handleReturnSuccess = () => {
    setShowCreateModal(false);
    fetchReturns();
    fetchStats();
  };

  return (
    <div style={{ padding: '24px', backgroundColor: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
      {/* 统计卡片 */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '16px', borderRadius: '12px', border: '1px solid #475569' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>总退货单</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f8fafc' }}>{stats.total_count}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '16px', borderRadius: '12px', border: '1px solid #f59e0b' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>待审批</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>{stats.pending_count}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '16px', borderRadius: '12px', border: '1px solid #3b82f6' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>已批准待处理</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>{stats.approved_count}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '16px', borderRadius: '12px', border: '1px solid #10b981' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>已完成</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>{stats.completed_count}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '16px', borderRadius: '12px', border: '1px solid #10b981' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>已退货总重量</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>{stats.total_completed_weight.toFixed(2)}g</div>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }}
          >
            <option value="">全部类型</option>
            <option value="to_supplier">退给供应商</option>
            <option value="to_warehouse">退给商品部</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0' }}
          >
            <option value="">全部状态</option>
            <option value="pending">待审批</option>
            <option value="approved">已批准</option>
            <option value="completed">已完成</option>
            <option value="rejected">已驳回</option>
          </select>
          <input
            type="text"
            placeholder="搜索商品名称..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', background: '#1e293b', border: '1px solid #475569', color: '#e2e8f0', width: '200px' }}
          />
        </div>
        
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              border: 'none',
              color: 'white',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            📦 新建退货单
          </button>
        )}
      </div>

      {/* 退货单列表 */}
      <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>退货单号</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>类型</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>商品名称</th>
              <th style={{ padding: '14px', textAlign: 'right', color: '#94a3b8', fontWeight: '500' }}>克重</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>退货原因</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>状态</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>财务审核</th>
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>创建时间</th>
              <th style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>加载中...</td>
              </tr>
            ) : returns.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>暂无退货记录</td>
              </tr>
            ) : (
              returns.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={{ padding: '14px', color: '#f8fafc', fontFamily: 'monospace' }}>{r.return_no}</td>
                  <td style={{ padding: '14px', color: '#e2e8f0' }}>{TYPE_MAP[r.return_type] || r.return_type}</td>
                  <td style={{ padding: '14px', color: '#e2e8f0' }}>{r.product_name}</td>
                  <td style={{ padding: '14px', textAlign: 'right', color: '#fbbf24', fontWeight: '600' }}>{r.return_weight}g</td>
                  <td style={{ padding: '14px', color: '#e2e8f0' }}>{r.return_reason}</td>
                  <td style={{ padding: '14px' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '500',
                      backgroundColor: `${STATUS_MAP[r.status]?.color}20`,
                      color: STATUS_MAP[r.status]?.color || '#64748b',
                      border: `1px solid ${STATUS_MAP[r.status]?.color || '#64748b'}`
                    }}>
                      {STATUS_MAP[r.status]?.label || r.status}
                    </span>
                  </td>
                  <td style={{ padding: '14px' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '500',
                      backgroundColor: r.is_audited ? '#3b82f620' : '#64748b20',
                      color: r.is_audited ? '#3b82f6' : '#64748b',
                      border: `1px solid ${r.is_audited ? '#3b82f6' : '#64748b'}`
                    }}>
                      {r.is_audited ? '已审核' : '未审核'}
                    </span>
                  </td>
                  <td style={{ padding: '14px', color: '#94a3b8', fontSize: '13px' }}>
                    {r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td style={{ padding: '14px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button
                        onClick={() => { setSelectedReturn(r); setShowDetailModal(true); }}
                        style={{ padding: '6px 12px', borderRadius: '6px', background: '#334155', border: 'none', color: '#e2e8f0', cursor: 'pointer', fontSize: '12px' }}
                      >
                        详情
                      </button>
                      {r.status === 'pending' && canApprove && (
                        <>
                          <button
                            onClick={() => handleApprove(r)}
                            style={{ padding: '6px 12px', borderRadius: '6px', background: '#10b981', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px' }}
                          >
                            通过
                          </button>
                          <button
                            onClick={() => handleReject(r)}
                            style={{ padding: '6px 12px', borderRadius: '6px', background: '#ef4444', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px' }}
                          >
                            驳回
                          </button>
                        </>
                      )}
                      {r.status === 'approved' && canApprove && (
                        <button
                          onClick={() => handleComplete(r)}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px' }}
                        >
                          完成
                        </button>
                      )}
                      {/* 财务审核按钮 */}
                      {canAuditReturn && !r.is_audited && (
                        <button
                          onClick={() => handleAuditReturn(r.id)}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: '#6366f1', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px' }}
                        >
                          审核
                        </button>
                      )}
                      {canAuditReturn && r.is_audited && (
                        <button
                          onClick={() => handleUnauditReturn(r.id)}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: '#64748b', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px' }}
                        >
                          反审
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建退货单弹窗 - 使用 QuickReturnModal 组件 */}
      <QuickReturnModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleReturnSuccess}
        userRole={userRole}
      />

      {/* 详情弹窗 */}
      {showDetailModal && selectedReturn && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', width: '500px', maxHeight: '90vh', overflow: 'auto', border: '1px solid #475569' }}>
            {/* 标题栏带关闭按钮 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>📋 退货单详情</h3>
              <button
                onClick={() => { setShowDetailModal(false); setSelectedReturn(null); }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94a3b8', 
                  fontSize: '24px', 
                  cursor: 'pointer',
                  padding: '0 8px',
                  lineHeight: 1
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = '#f8fafc')}
                onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
              >
                ×
              </button>
            </div>
            
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>退货单号</span>
                <span style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{selectedReturn.return_no}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>退货类型</span>
                <span style={{ color: '#f8fafc' }}>{TYPE_MAP[selectedReturn.return_type]}</span>
              </div>
              {/* 商品明细列表 */}
              <div style={{ padding: '12px', background: '#0f172a', borderRadius: '8px' }}>
                <div style={{ color: '#94a3b8', marginBottom: '10px', fontWeight: '600' }}>
                  📦 商品明细 ({selectedReturn.item_count || 1} 件)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedReturn.items && selectedReturn.items.length > 0 ? (
                    selectedReturn.items.map((item, index) => (
                      <div key={item.id || index} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '8px 12px', 
                        background: '#1e293b', 
                        borderRadius: '6px',
                        borderLeft: '3px solid #fbbf24'
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#f8fafc', fontWeight: '500' }}>{item.product_name}</div>
                          <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '2px' }}>
                            工费: ¥{item.total_labor_cost?.toFixed(2) || '0.00'}
                            {item.piece_count ? ` | ${item.piece_count}件` : ''}
                          </div>
                        </div>
                        <div style={{ color: '#fbbf24', fontWeight: '600', fontSize: '14px' }}>
                          {item.return_weight}g
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 12px', 
                      background: '#1e293b', 
                      borderRadius: '6px',
                      borderLeft: '3px solid #fbbf24'
                    }}>
                      <span style={{ color: '#f8fafc' }}>{selectedReturn.product_name}</span>
                      <span style={{ color: '#fbbf24', fontWeight: '600' }}>{selectedReturn.return_weight}g</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 汇总信息 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>总退货克重</span>
                <span style={{ color: '#fbbf24', fontWeight: '600' }}>{selectedReturn.total_weight || selectedReturn.return_weight}g</span>
              </div>
              {(selectedReturn.total_labor_cost ?? 0) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>总工费</span>
                  <span style={{ color: '#10b981', fontWeight: '600' }}>¥{selectedReturn.total_labor_cost?.toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>退货原因</span>
                <span style={{ color: '#f8fafc' }}>{selectedReturn.return_reason}</span>
              </div>
              {selectedReturn.reason_detail && (
                <div style={{ padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <div style={{ color: '#94a3b8', marginBottom: '6px' }}>详细说明</div>
                  <div style={{ color: '#f8fafc' }}>{selectedReturn.reason_detail}</div>
                </div>
              )}
              {selectedReturn.supplier_name && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>供应商</span>
                  <span style={{ color: '#f8fafc' }}>{selectedReturn.supplier_name}</span>
                </div>
              )}
              {selectedReturn.from_location_name && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>发起位置</span>
                  <span style={{ color: '#f8fafc' }}>{selectedReturn.from_location_name}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>状态</span>
                <span style={{ color: STATUS_MAP[selectedReturn.status]?.color }}>{STATUS_MAP[selectedReturn.status]?.label}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>创建人</span>
                <span style={{ color: '#f8fafc' }}>{selectedReturn.created_by || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>创建时间</span>
                <span style={{ color: '#f8fafc' }}>{selectedReturn.created_at ? new Date(selectedReturn.created_at).toLocaleString('zh-CN') : '-'}</span>
              </div>
              {selectedReturn.approved_by && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>审批人</span>
                  <span style={{ color: '#f8fafc' }}>{selectedReturn.approved_by}</span>
                </div>
              )}
              {selectedReturn.approved_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>审批时间</span>
                  <span style={{ color: '#f8fafc' }}>{new Date(selectedReturn.approved_at).toLocaleString('zh-CN')}</span>
                </div>
              )}
              {selectedReturn.reject_reason && (
                <div style={{ padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <div style={{ color: '#ef4444', marginBottom: '6px' }}>驳回原因</div>
                  <div style={{ color: '#f8fafc' }}>{selectedReturn.reject_reason}</div>
                </div>
              )}
              {selectedReturn.completed_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>完成时间</span>
                  <span style={{ color: '#10b981' }}>{new Date(selectedReturn.completed_at).toLocaleString('zh-CN')}</span>
                </div>
              )}
              {/* 财务审核信息 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>财务审核</span>
                <span style={{ color: selectedReturn.is_audited ? '#3b82f6' : '#64748b' }}>
                  {selectedReturn.is_audited ? '已审核' : '未审核'}
                </span>
              </div>
              {selectedReturn.is_audited && selectedReturn.audited_by && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>审核人</span>
                  <span style={{ color: '#f8fafc' }}>{selectedReturn.audited_by}</span>
                </div>
              )}
              {selectedReturn.is_audited && selectedReturn.audited_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>审核时间</span>
                  <span style={{ color: '#3b82f6' }}>{new Date(selectedReturn.audited_at).toLocaleString('zh-CN')}</span>
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handlePrintReturn(selectedReturn)}
                style={{ padding: '10px 20px', borderRadius: '8px', background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                🖨️ 打印退货单
              </button>
              {/* 下载按钮组 */}
              <div style={{ position: 'relative' }} ref={downloadMenuRef}>
                <button
                  onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                  style={{ padding: '10px 20px', borderRadius: '8px', background: '#10b981', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  📥 下载单据 ▼
                </button>
                {showDownloadMenu && (
                  <div style={{ 
                    position: 'absolute', 
                    bottom: '100%', 
                    right: 0, 
                    marginBottom: '8px',
                    background: '#0f172a', 
                    borderRadius: '8px', 
                    border: '1px solid #475569',
                    overflow: 'hidden',
                    minWidth: '180px',
                    zIndex: 1001,
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.3)'
                  }}>
                    <button
                      onClick={() => handleDownloadReturn(selectedReturn, 'return')}
                      style={{ 
                        width: '100%', 
                        padding: '12px 16px', 
                        background: 'transparent', 
                        border: 'none', 
                        color: '#e2e8f0', 
                        cursor: 'pointer', 
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = '#1e293b')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: '#f59e0b' }}>📄</span>
                      <div>
                        <div>退货单</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>柜台/结算用</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDownloadReturn(selectedReturn, 'stock_out')}
                      style={{ 
                        width: '100%', 
                        padding: '12px 16px', 
                        background: 'transparent', 
                        border: 'none', 
                        borderTop: '1px solid #334155',
                        color: '#e2e8f0', 
                        cursor: 'pointer', 
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = '#1e293b')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: '#3b82f6' }}>📦</span>
                      <div>
                        <div>退库单</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>商品部内部用</div>
                      </div>
                    </button>
                    {selectedReturn.return_type === 'to_supplier' && (
                      <button
                        onClick={() => handleDownloadReturn(selectedReturn, 'purchase_return')}
                        style={{ 
                          width: '100%', 
                          padding: '12px 16px', 
                          background: 'transparent', 
                          border: 'none', 
                          borderTop: '1px solid #334155',
                          color: '#e2e8f0', 
                          cursor: 'pointer', 
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = '#1e293b')}
                        onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ color: '#10b981' }}>💰</span>
                        <div>
                          <div>采购退货单</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>财务对账用</div>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setShowDetailModal(false); setSelectedReturn(null); setShowDownloadMenu(false); }}
                style={{ padding: '10px 20px', borderRadius: '8px', background: '#475569', border: 'none', color: '#e2e8f0', cursor: 'pointer' }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

