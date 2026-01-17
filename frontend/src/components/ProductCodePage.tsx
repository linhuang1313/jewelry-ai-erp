import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { hasPermission } from '../config/permissions';
import { API_BASE_URL } from '../config';

interface ProductCode {
  id: number;
  code: string;
  name: string;
  code_type: string;
  is_unique: number;
  is_used: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  remark: string | null;
  supplier_name: string | null;
}

interface ProductAttribute {
  id: number;
  value: string;
  sort_order: number;
}

interface ProductAttributes {
  fineness: ProductAttribute[];
  craft: ProductAttribute[];
  style: ProductAttribute[];
}

interface ProductCodePageProps {
  userRole: string;
}

const API_BASE = API_BASE_URL;

const ProductCodePage: React.FC<ProductCodePageProps> = ({ userRole }) => {
  const [activeTab, setActiveTab] = useState<'predefined' | 'f_single' | 'fl_batch' | 'attributes'>('predefined');
  const [codes, setCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  
  // 新增/编辑表单
  const [showModal, setShowModal] = useState(false);
  const [editingCode, setEditingCode] = useState<ProductCode | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    code_type: 'f_single',
    remark: ''
  });
  
  // 商品属性配置状态
  const [attributes, setAttributes] = useState<ProductAttributes>({
    fineness: [],
    craft: [],
    style: []
  });
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [newAttributeValue, setNewAttributeValue] = useState({
    fineness: '',
    craft: '',
    style: ''
  });
  
  // 权限检查
  const canManage = hasPermission(userRole, 'canManageProductCodes');
  
  // 加载编码列表
  const loadCodes = useCallback(async () => {
    if (activeTab === 'attributes') return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/product-codes?code_type=${activeTab}`);
      if (response.ok) {
        const data = await response.json();
        setCodes(data);
      } else {
        toast.error('加载商品编码失败');
      }
    } catch (error) {
      console.error('加载商品编码失败:', error);
      toast.error('加载商品编码失败');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);
  
  // 加载商品属性配置
  const loadAttributes = useCallback(async () => {
    setAttributesLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/product-codes/attributes`);
      if (response.ok) {
        const data = await response.json();
        setAttributes(data);
      } else {
        toast.error('加载商品属性失败');
      }
    } catch (error) {
      console.error('加载商品属性失败:', error);
      toast.error('加载商品属性失败');
    } finally {
      setAttributesLoading(false);
    }
  }, []);
  
  // 添加新属性
  const handleAddAttribute = async (category: 'fineness' | 'craft' | 'style') => {
    const value = newAttributeValue[category].trim();
    if (!value) {
      toast.error('请输入属性值');
      return;
    }
    
    try {
      const response = await fetch(
        `${API_BASE}/api/product-codes/attributes?category=${category}&value=${encodeURIComponent(value)}`,
        { method: 'POST' }
      );
      
      if (response.ok) {
        toast.success('添加成功');
        setNewAttributeValue(prev => ({ ...prev, [category]: '' }));
        loadAttributes();
      } else {
        const error = await response.json();
        toast.error(error.detail || '添加失败');
      }
    } catch (error) {
      console.error('添加属性失败:', error);
      toast.error('添加失败');
    }
  };
  
  // 删除属性
  const handleDeleteAttribute = async (id: number, value: string) => {
    if (!confirm(`确定要删除属性 "${value}" 吗？`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/product-codes/attributes/${id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast.success('删除成功');
        loadAttributes();
      } else {
        const error = await response.json();
        toast.error(error.detail || '删除失败');
      }
    } catch (error) {
      console.error('删除属性失败:', error);
      toast.error('删除失败');
    }
  };
  
  // 初始化属性（首次使用时）
  const handleInitAttributes = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/product-codes/attributes/init`);
      if (response.ok) {
        const data = await response.json();
        toast.success(data.message);
        loadAttributes();
      }
    } catch (error) {
      console.error('初始化属性失败:', error);
      toast.error('初始化失败');
    }
  };
  
  useEffect(() => {
    if (activeTab === 'attributes') {
      loadAttributes();
    } else {
      loadCodes();
    }
  }, [activeTab, loadCodes, loadAttributes]);
  
  // 搜索编码
  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      loadCodes();
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/product-codes/search?keyword=${encodeURIComponent(searchKeyword)}&code_type=${activeTab}`
      );
      if (response.ok) {
        const data = await response.json();
        setCodes(data.codes);
      }
    } catch (error) {
      console.error('搜索失败:', error);
      toast.error('搜索失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 获取下一个编码
  const getNextCode = async () => {
    try {
      const endpoint = formData.code_type === 'f_single' 
        ? '/api/product-codes/next-f-code'
        : '/api/product-codes/next-fl-code';
      const response = await fetch(`${API_BASE}${endpoint}`);
      if (response.ok) {
        const data = await response.json();
        setFormData(prev => ({ ...prev, code: data.code }));
      }
    } catch (error) {
      console.error('获取编码失败:', error);
    }
  };
  
  // 打开新增弹窗
  const handleAdd = async () => {
    setEditingCode(null);
    const codeType = activeTab === 'predefined' ? 'f_single' : activeTab;
    setFormData({
      code: '',
      name: '',
      code_type: codeType,
      remark: ''
    });
    setShowModal(true);
    
    // 自动获取下一个编码
    if (codeType === 'f_single') {
      try {
        const response = await fetch(`${API_BASE}/api/product-codes/next-f-code`);
        if (response.ok) {
          const data = await response.json();
          setFormData(prev => ({ ...prev, code: data.code }));
        }
      } catch (error) {
        console.error('获取F编码失败:', error);
      }
    }
  };
  
  // 打开编辑弹窗
  const handleEdit = (code: ProductCode) => {
    setEditingCode(code);
    setFormData({
      code: code.code,
      name: code.name,
      code_type: code.code_type,
      remark: code.remark || ''
    });
    setShowModal(true);
  };
  
  // 提交表单
  const handleSubmit = async () => {
    if (!formData.code.trim() || !formData.name.trim()) {
      toast.error('请填写完整信息');
      return;
    }
    
    try {
      if (editingCode) {
        // 编辑
        const response = await fetch(`${API_BASE}/api/product-codes/${editingCode.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            remark: formData.remark
          })
        });
        
        if (response.ok) {
          toast.success('更新成功');
          setShowModal(false);
          loadCodes();
        } else {
          const error = await response.json();
          toast.error(error.detail || '更新失败');
        }
      } else {
        // 新增
        const response = await fetch(`${API_BASE}/api/product-codes?created_by=${userRole}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        if (response.ok) {
          toast.success('创建成功');
          setShowModal(false);
          loadCodes();
        } else {
          const error = await response.json();
          toast.error(error.detail || '创建失败');
        }
      }
    } catch (error) {
      console.error('操作失败:', error);
      toast.error('操作失败');
    }
  };
  
  // 删除编码
  const handleDelete = async (code: ProductCode) => {
    if (!confirm(`确定要删除编码 ${code.code} 吗？`)) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/product-codes/${code.id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast.success('删除成功');
        loadCodes();
      } else {
        const error = await response.json();
        toast.error(error.detail || '删除失败');
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    }
  };
  
  // 获取编码类型中文名
  const getCodeTypeName = (type: string) => {
    switch (type) {
      case 'predefined': return '预定义编码';
      case 'f_single': return 'F编码（一码一件）';
      case 'fl_batch': return 'FL编码（批量）';
      default: return type;
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* 页面标题 - 珠宝风格 */}
        <div className="mb-6 flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-amber-400 to-yellow-500 rounded-xl shadow-lg shadow-amber-200/50">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">商品编码管理</h1>
            <p className="text-gray-500 text-sm">管理预定义编码、F编码和商品属性</p>
          </div>
        </div>
      
        {/* 标签页 - 珠宝风格 */}
        <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-amber-50/30 p-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('predefined')}
                className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                  activeTab === 'predefined'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
                    : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
                }`}
              >
                预定义编码（35个）
              </button>
              <button
                onClick={() => setActiveTab('f_single')}
                className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                  activeTab === 'f_single'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
                    : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
                }`}
              >
                F编码（一码一件）
              </button>
              <button
                onClick={() => setActiveTab('fl_batch')}
                className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                  activeTab === 'fl_batch'
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
                    : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
                }`}
              >
                FL编码（批量）
              </button>
              <button
                onClick={() => setActiveTab('attributes')}
                className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                  activeTab === 'attributes'
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-200/50'
                    : 'bg-white text-gray-600 hover:bg-purple-50 border border-gray-200'
                }`}
              >
                商品属性配置
              </button>
            </div>
          </div>
        </div>
      
      {/* 搜索和操作栏 - 仅在编码 Tab 显示 */}
      {activeTab !== 'attributes' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="输入编码或名称搜索..."
              style={{
                padding: '10px 15px',
                border: '1px solid #ddd',
                borderRadius: '5px',
                width: '250px'
              }}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              onClick={handleSearch}
              style={{
                padding: '10px 20px',
                backgroundColor: '#666',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              搜索
            </button>
            <button
              onClick={() => { setSearchKeyword(''); loadCodes(); }}
              style={{
                padding: '10px 20px',
                backgroundColor: '#999',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              重置
            </button>
          </div>
          
          {canManage && activeTab !== 'predefined' && (
            <button
              onClick={handleAdd}
              style={{
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              + 新增{activeTab === 'f_single' ? 'F' : 'FL'}编码
            </button>
          )}
        </div>
      )}
      
      {/* 商品属性配置界面 */}
      {activeTab === 'attributes' && (
        <div style={{ marginBottom: '20px' }}>
          {attributesLoading ? (
            <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>
              加载中...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              {/* 成色列 */}
              <div style={{ backgroundColor: '#f8f9fa', borderRadius: '10px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#9C27B0', borderBottom: '2px solid #9C27B0', paddingBottom: '10px' }}>
                  成色 ({attributes.fineness.length}个)
                </h3>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {attributes.fineness.map((attr) => (
                    <div key={attr.id} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 12px',
                      backgroundColor: 'white',
                      borderRadius: '5px',
                      marginBottom: '8px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                      <span>{attr.value}</span>
                      {canManage && (
                        <button
                          onClick={() => handleDeleteAttribute(attr.id, attr.value)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#f44336',
                            cursor: 'pointer',
                            fontSize: '18px',
                            padding: '0 5px'
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                    <input
                      type="text"
                      value={newAttributeValue.fineness}
                      onChange={(e) => setNewAttributeValue(prev => ({ ...prev, fineness: e.target.value }))}
                      placeholder="输入新的成色..."
                      style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddAttribute('fineness')}
                    />
                    <button
                      onClick={() => handleAddAttribute('fineness')}
                      style={{
                        padding: '8px 15px',
                        backgroundColor: '#9C27B0',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer'
                      }}
                    >
                      添加
                    </button>
                  </div>
                )}
              </div>
              
              {/* 工艺列 */}
              <div style={{ backgroundColor: '#f8f9fa', borderRadius: '10px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#FF9800', borderBottom: '2px solid #FF9800', paddingBottom: '10px' }}>
                  工艺 ({attributes.craft.length}个)
                </h3>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {attributes.craft.map((attr) => (
                    <div key={attr.id} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 12px',
                      backgroundColor: 'white',
                      borderRadius: '5px',
                      marginBottom: '8px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                      <span>{attr.value}</span>
                      {canManage && (
                        <button
                          onClick={() => handleDeleteAttribute(attr.id, attr.value)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#f44336',
                            cursor: 'pointer',
                            fontSize: '18px',
                            padding: '0 5px'
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                    <input
                      type="text"
                      value={newAttributeValue.craft}
                      onChange={(e) => setNewAttributeValue(prev => ({ ...prev, craft: e.target.value }))}
                      placeholder="输入新的工艺..."
                      style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddAttribute('craft')}
                    />
                    <button
                      onClick={() => handleAddAttribute('craft')}
                      style={{
                        padding: '8px 15px',
                        backgroundColor: '#FF9800',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer'
                      }}
                    >
                      添加
                    </button>
                  </div>
                )}
              </div>
              
              {/* 款式列 */}
              <div style={{ backgroundColor: '#f8f9fa', borderRadius: '10px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50', borderBottom: '2px solid #4CAF50', paddingBottom: '10px' }}>
                  款式 ({attributes.style.length}个)
                </h3>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {attributes.style.map((attr) => (
                    <div key={attr.id} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '8px 12px',
                      backgroundColor: 'white',
                      borderRadius: '5px',
                      marginBottom: '8px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                      <span>{attr.value}</span>
                      {canManage && (
                        <button
                          onClick={() => handleDeleteAttribute(attr.id, attr.value)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#f44336',
                            cursor: 'pointer',
                            fontSize: '18px',
                            padding: '0 5px'
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                    <input
                      type="text"
                      value={newAttributeValue.style}
                      onChange={(e) => setNewAttributeValue(prev => ({ ...prev, style: e.target.value }))}
                      placeholder="输入新的款式..."
                      style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddAttribute('style')}
                    />
                    <button
                      onClick={() => handleAddAttribute('style')}
                      style={{
                        padding: '8px 15px',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer'
                      }}
                    >
                      添加
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 初始化按钮 */}
          {attributes.fineness.length === 0 && attributes.craft.length === 0 && attributes.style.length === 0 && !attributesLoading && (
            <div style={{ textAlign: 'center', marginTop: '30px' }}>
              <p style={{ color: '#666', marginBottom: '15px' }}>暂无属性配置，点击下方按钮初始化默认属性</p>
              <button
                onClick={handleInitAttributes}
                style={{
                  padding: '12px 30px',
                  backgroundColor: '#9C27B0',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}
              >
                初始化默认属性
              </button>
            </div>
          )}
          
          {/* 说明 */}
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f3e5f5', borderRadius: '5px' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#7B1FA2' }}>属性配置说明</h4>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#666' }}>
              <li><strong>成色</strong>：金料的纯度和材质，如足金、18K金、S925银等</li>
              <li><strong>工艺</strong>：产品的制作工艺，如3D硬金、古法、5D镶嵌等</li>
              <li><strong>款式</strong>：首饰的类型，如戒指、项链、挂坠等</li>
              <li>这些属性将在快速入库的珐琅产品批量生成中作为下拉选项使用</li>
            </ul>
          </div>
        </div>
      )}
      
      {/* 编码表格 */}
      {activeTab !== 'attributes' && loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>
          加载中...
        </div>
      ) : activeTab !== 'attributes' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5' }}>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>编码</th>
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>商品名称</th>
              <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #ddd' }}>类型</th>
              {activeTab === 'f_single' && (
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #ddd' }}>使用状态</th>
              )}
              {activeTab === 'f_single' && (
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>供应商</th>
              )}
              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>备注</th>
              {canManage && activeTab !== 'predefined' && (
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #ddd' }}>操作</th>
              )}
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: '#999' }}>
                  暂无数据
                </td>
              </tr>
            ) : (
              codes.map((code) => (
                <tr key={code.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '12px', fontWeight: 'bold', color: '#D4AF37' }}>
                    {code.code}
                  </td>
                  <td style={{ padding: '12px' }}>{code.name}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: code.code_type === 'predefined' ? '#e3f2fd' : 
                                       code.code_type === 'f_single' ? '#fff3e0' : '#e8f5e9',
                      color: code.code_type === 'predefined' ? '#1565c0' : 
                             code.code_type === 'f_single' ? '#e65100' : '#2e7d32'
                    }}>
                      {code.code_type === 'predefined' ? '预定义' : 
                       code.code_type === 'f_single' ? '一码一件' : '批量'}
                    </span>
                  </td>
                  {activeTab === 'f_single' && (
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: code.is_used ? '#ffebee' : '#e8f5e9',
                        color: code.is_used ? '#c62828' : '#2e7d32'
                      }}>
                        {code.is_used ? '已使用' : '未使用'}
                      </span>
                    </td>
                  )}
                  {activeTab === 'f_single' && (
                    <td style={{ padding: '12px', color: '#666' }}>
                      {code.supplier_name || '-'}
                    </td>
                  )}
                  <td style={{ padding: '12px', color: '#666' }}>{code.remark || '-'}</td>
                  {canManage && activeTab !== 'predefined' && (
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleEdit(code)}
                        style={{
                          padding: '5px 10px',
                          backgroundColor: '#2196F3',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          marginRight: '5px'
                        }}
                      >
                        编辑
                      </button>
                      {!code.is_used && (
                        <button
                          onClick={() => handleDelete(code)}
                          style={{
                            padding: '5px 10px',
                            backgroundColor: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer'
                          }}
                        >
                          删除
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      
      {/* 提示信息 - 仅在编码 Tab 显示 */}
      {activeTab !== 'attributes' && (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3e0', borderRadius: '5px' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#e65100' }}>编码规则说明</h4>
          <ul style={{ margin: 0, paddingLeft: '20px', color: '#666' }}>
            <li><strong>预定义编码</strong>：35个固定编码，对应足金999精品、古法、3D硬金、5D硬金等商品类型，不可修改删除</li>
            <li><strong>F编码（一码一件）</strong>：格式为 F + 8位数字（如 F00000001），用于珐琅产品，每个编码对应唯一商品</li>
            <li><strong>FL编码（批量）</strong>：格式为 FL + 4位数字（如 FL0001），用于批量珐琅产品，如直营电商，无需一码一件</li>
          </ul>
        </div>
      )}
      
      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '10px',
            width: '500px',
            maxWidth: '90%'
          }}>
            <h3 style={{ marginTop: 0, color: '#333' }}>
              {editingCode ? '编辑商品编码' : '新增商品编码'}
            </h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>编码类型</label>
              <select
                value={formData.code_type}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, code_type: e.target.value, code: '' }));
                }}
                disabled={!!editingCode}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '5px'
                }}
              >
                <option value="f_single">F编码（一码一件）</option>
                <option value="fl_batch">FL编码（批量）</option>
              </select>
            </div>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>编码</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  disabled={!!editingCode || formData.code_type === 'f_single'}
                  placeholder={formData.code_type === 'f_single' ? 'F00000001' : 'FL0001'}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '5px',
                    backgroundColor: (editingCode || formData.code_type === 'f_single') ? '#f5f5f5' : 'white'
                  }}
                />
                {!editingCode && formData.code_type === 'f_single' && (
                  <button
                    onClick={getNextCode}
                    style={{
                      padding: '10px 15px',
                      backgroundColor: '#D4AF37',
                      color: 'white',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: 'pointer'
                    }}
                  >
                    自动生成
                  </button>
                )}
              </div>
              {formData.code_type === 'f_single' && (
                <small style={{ color: '#666' }}>F编码自动生成，格式：F + 8位数字</small>
              )}
              {formData.code_type === 'fl_batch' && (
                <small style={{ color: '#666' }}>FL编码手动输入，格式：FL + 4位数字</small>
              )}
            </div>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>商品名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="请输入商品名称"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>备注</label>
              <textarea
                value={formData.remark}
                onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                placeholder="可选"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '5px',
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#999',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#D4AF37',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ProductCodePage;

