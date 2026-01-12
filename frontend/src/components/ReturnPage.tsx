import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';

interface ReturnOrder {
  id: number;
  return_no: string;
  return_type: string;
  product_name: string;
  return_weight: number;
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
}

interface Location {
  id: number;
  code: string;
  name: string;
  location_type: string;
}

interface Supplier {
  id: number;
  name: string;
  supplier_no: string;
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

const RETURN_REASONS = ['质量问题', '款式不符', '数量差异', '工艺瑕疵', '其他'];

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
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<ReturnStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<ReturnOrder | null>(null);
  
  // 筛选条件
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  
  // 根据角色确定默认退货类型
  const getDefaultReturnType = () => {
    if (userRole === 'counter') return 'to_warehouse';  // 柜台只能退给商品部
    return 'to_supplier';  // 商品专员和管理层默认退给供应商
  };

  // 新建表单
  const [formData, setFormData] = useState({
    return_type: getDefaultReturnType(),
    product_name: '',
    return_weight: '',
    from_location_id: '',
    supplier_id: '',
    return_reason: '质量问题',
    reason_detail: '',
    remark: '',
  });

  // 判断是否显示退货类型选择（只有管理层可以选择）
  const canSelectReturnType = userRole === 'manager';

  // 加载数据
  useEffect(() => {
    fetchReturns();
    fetchLocations();
    fetchSuppliers();
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

  const fetchLocations = async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/locations`);
      const data = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('获取位置失败:', error);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/suppliers`);
      const data = await res.json();
      if (data.success) {
        setSuppliers(data.suppliers || []);
      }
    } catch (error) {
      console.error('获取供应商失败:', error);
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

  const handleCreate = async () => {
    if (!formData.product_name || !formData.return_weight) {
      alert('请填写商品名称和退货克重');
      return;
    }
    
    if (formData.return_type === 'to_supplier' && !formData.supplier_id) {
      alert('退给供应商时必须选择供应商');
      return;
    }

    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/returns?created_by=${userRole}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          return_weight: parseFloat(formData.return_weight),
          from_location_id: formData.from_location_id ? parseInt(formData.from_location_id) : null,
          supplier_id: formData.supplier_id ? parseInt(formData.supplier_id) : null,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(data.message);
        setShowCreateModal(false);
        resetForm();
        fetchReturns();
        fetchStats();
      } else {
        alert(data.message || '创建失败');
      }
    } catch (error) {
      console.error('创建退货单失败:', error);
      alert('创建失败，请重试');
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

  const resetForm = () => {
    setFormData({
      return_type: getDefaultReturnType(),
      product_name: '',
      return_weight: '',
      from_location_id: '',
      supplier_id: '',
      return_reason: '质量问题',
      reason_detail: '',
      remark: '',
    });
  };

  const canApprove = userRole === 'manager' || userRole === 'product';
  const canCreate = userRole === 'product' || userRole === 'counter' || userRole === 'manager';

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
              <th style={{ padding: '14px', textAlign: 'left', color: '#94a3b8', fontWeight: '500' }}>创建时间</th>
              <th style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>加载中...</td>
              </tr>
            ) : returns.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>暂无退货记录</td>
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
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建退货单弹窗 */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', width: '500px', maxHeight: '90vh', overflow: 'auto', border: '1px solid #475569', position: 'relative' }}>
            {/* 标题栏带关闭按钮 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>📦 新建退货单</h3>
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
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
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 退货类型 - 只有管理层可以选择，其他角色自动确定 */}
              {canSelectReturnType ? (
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>退货类型 *</label>
                  <select
                    value={formData.return_type}
                    onChange={(e) => setFormData({ ...formData, return_type: e.target.value, supplier_id: '' })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0' }}
                  >
                    <option value="to_supplier">退给供应商</option>
                    <option value="to_warehouse">退给商品部</option>
                  </select>
                </div>
              ) : (
                <div style={{ padding: '12px', background: '#0f172a', borderRadius: '8px', border: '1px solid #475569' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>退货类型：</span>
                  <span style={{ color: '#fbbf24', fontWeight: '600', marginLeft: '8px' }}>
                    {formData.return_type === 'to_supplier' ? '退给供应商' : '退给商品部'}
                  </span>
                </div>
              )}
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>商品名称 *</label>
                <input
                  type="text"
                  value={formData.product_name}
                  onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                  placeholder="输入商品名称"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0', boxSizing: 'border-box' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>退货克重 *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.return_weight}
                  onChange={(e) => setFormData({ ...formData, return_weight: e.target.value })}
                  placeholder="输入克重"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0', boxSizing: 'border-box' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>发起位置</label>
                <select
                  value={formData.from_location_id}
                  onChange={(e) => setFormData({ ...formData, from_location_id: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0' }}
                >
                  <option value="">选择位置（可选）</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              
              {formData.return_type === 'to_supplier' && (
                <div>
                  <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>供应商 *</label>
                  <select
                    value={formData.supplier_id}
                    onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0' }}
                  >
                    <option value="">选择供应商</option>
                    {suppliers.map((sup) => (
                      <option key={sup.id} value={sup.id}>{sup.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>退货原因 *</label>
                <select
                  value={formData.return_reason}
                  onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0' }}
                >
                  {RETURN_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>详细说明</label>
                <textarea
                  value={formData.reason_detail}
                  onChange={(e) => setFormData({ ...formData, reason_detail: e.target.value })}
                  placeholder="详细描述问题..."
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#94a3b8', fontSize: '13px' }}>备注</label>
                <input
                  type="text"
                  value={formData.remark}
                  onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                  placeholder="其他备注信息"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid #475569', color: '#e2e8f0', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                style={{ padding: '10px 20px', borderRadius: '8px', background: '#475569', border: 'none', color: '#e2e8f0', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                style={{ padding: '10px 20px', borderRadius: '8px', background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', border: 'none', color: 'white', cursor: 'pointer', fontWeight: '600' }}
              >
                提交退货
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>商品名称</span>
                <span style={{ color: '#f8fafc' }}>{selectedReturn.product_name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                <span style={{ color: '#94a3b8' }}>退货克重</span>
                <span style={{ color: '#fbbf24', fontWeight: '600' }}>{selectedReturn.return_weight}g</span>
              </div>
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
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button
                onClick={() => { setShowDetailModal(false); setSelectedReturn(null); }}
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

