import React, { useState, useEffect, useMemo } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const FinanceSettings = () => {
    const [activeTab, setActiveTab] = useState('accounts');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({ code: '', name: '', docword: '' });
    const [collapsedCodes, setCollapsedCodes] = useState(new Set()); // 收起的父级科目code前缀

    const tabs = [
        { id: 'accounts', label: '科目', endpoint: '/settings/accounts' },
        { id: 'voucher-types', label: '凭证类别', endpoint: '/settings/voucher-types' },
        { id: 'partners', label: '往来单位', endpoint: '/settings/partners' }
    ];

    const currentTab = tabs.find(t => t.id === activeTab);

    const fetchData = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}`);
            const result = await response.json();
            if (result.success) {
                setData(result.data);
            } else {
                alert(result.message || '获取数据失败');
            }
        } catch (error) {
            console.error('Fetch failed:', error);
            alert('网络错误，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setCollapsedCodes(new Set()); // 切换 tab 时重置折叠状态
    }, [activeTab]);

    // 根据 depth 获取背景色（深度越大颜色越浅）
    const getDepthBgColor = (depth) => {
        const colors = {
            1: 'bg-blue-100',      // 一级：深蓝色
            2: 'bg-blue-50',       // 二级：浅蓝色
            3: 'bg-slate-50',      // 三级：浅灰色
            4: 'bg-gray-50',       // 四级：更浅
            5: 'bg-white',         // 五级及以上：白色
        };
        return colors[Math.min(depth || 1, 5)] || 'bg-white';
    };

    // 检查一个科目是否有子科目（通过 code 前缀判断）
    const hasChildren = (item) => {
        if (activeTab !== 'accounts') return false;
        // 检查是否有其他科目的 code 以当前科目的 code 为前缀
        return data.some(d => d.code !== item.code && d.code.startsWith(item.code));
    };

    // 检查一个科目是否应该被隐藏（父级被收起）
    const isHidden = (item) => {
        if (activeTab !== 'accounts') return false;
        // 检查是否有任何父级被收起
        for (const collapsedCode of collapsedCodes) {
            if (item.code !== collapsedCode && item.code.startsWith(collapsedCode)) {
                return true;
            }
        }
        return false;
    };

    // 切换展开/收起
    const toggleCollapse = (code) => {
        setCollapsedCodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(code)) {
                newSet.delete(code);
            } else {
                newSet.add(code);
            }
            return newSet;
        });
    };

    // 展开全部
    const expandAll = () => {
        setCollapsedCodes(new Set());
    };

    // 收起全部（只显示一级）
    const collapseAll = () => {
        const level1Codes = data.filter(d => d.depth === 1).map(d => d.code);
        setCollapsedCodes(new Set(level1Codes));
    };

    // 过滤显示的数据
    const visibleData = useMemo(() => {
        if (activeTab !== 'accounts') return data;
        return data.filter(item => !isHidden(item));
    }, [data, collapsedCodes, activeTab]);

    const handleAdd = () => {
        setEditItem(null);
        setFormData({ code: '', name: '', docword: '' });
        setShowModal(true);
    };

    const handleEdit = (item) => {
        setEditItem(item);
        setFormData({ code: item.code || '', name: item.name || '', docword: item.docword || '' });
        setShowModal(true);
    };

    const handleDelete = async (id) => {
        if (!confirm('确定要删除吗？')) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}/${id}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                fetchData();
            } else {
                alert(result.message || '删除失败');
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('删除失败');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editItem
                ? `${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}/${editItem.id}`
                : `${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}`;
            const method = editItem ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const result = await response.json();
            if (result.success) {
                setShowModal(false);
                fetchData();
            } else {
                alert(result.message || '保存失败');
            }
        } catch (error) {
            console.error('Save failed:', error);
            alert('保存失败');
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-2xl font-bold text-gray-800 mb-6">财务系统基础设置</h1>

                {/* Tabs */}
                <div className="flex space-x-2 mb-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === tab.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="bg-white rounded-lg shadow">
                    <div className="p-4 border-b flex justify-between items-center">
                        <h2 className="text-lg font-semibold">{currentTab.label}列表</h2>
                        <div className="flex space-x-2">
                            {activeTab === 'accounts' && (
                                <>
                                    <button
                                        onClick={expandAll}
                                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                                    >
                                        展开全部
                                    </button>
                                    <button
                                        onClick={collapseAll}
                                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                                    >
                                        收起全部
                                    </button>
                                </>
                            )}
                            <button
                                onClick={handleAdd}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                            >
                                新增
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">编码</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
                                    {activeTab === 'voucher-types' && (
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">凭证字</th>
                                    )}
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {loading ? (
                                    <tr><td colSpan="5" className="px-6 py-4 text-center text-gray-500">加载中...</td></tr>
                                ) : visibleData.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-4 text-center text-gray-500">暂无数据</td></tr>
                                ) : (
                                    visibleData.map(item => {
                                        const isCollapsed = collapsedCodes.has(item.code);
                                        const itemHasChildren = hasChildren(item);
                                        const depth = item.depth || 1;

                                        return (
                                            <tr
                                                key={item.id}
                                                className={`${getDepthBgColor(depth)} hover:bg-opacity-80 transition-colors`}
                                            >
                                                <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900">
                                                    <div className="flex items-center" style={{ paddingLeft: `${(depth - 1) * 20}px` }}>
                                                        {activeTab === 'accounts' && itemHasChildren && (
                                                            <button
                                                                onClick={() => toggleCollapse(item.code)}
                                                                className="mr-2 w-5 h-5 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                            >
                                                                {isCollapsed ? (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                )}
                                                            </button>
                                                        )}
                                                        {activeTab === 'accounts' && !itemHasChildren && depth > 1 && (
                                                            <span className="mr-2 w-5 h-5 flex items-center justify-center text-gray-300">
                                                                ─
                                                            </span>
                                                        )}
                                                        <span className={depth === 1 ? 'font-semibold' : ''}>
                                                            {item.code}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900">
                                                    <span className={depth === 1 ? 'font-semibold text-gray-800' : ''}>
                                                        {item.name}
                                                    </span>
                                                </td>
                                                {activeTab === 'voucher-types' && (
                                                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900">{item.docword}</td>
                                                )}
                                                <td className="px-6 py-3 whitespace-nowrap">
                                                    <span className={`px-2 py-1 text-xs rounded-full ${item.disabled ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                        {item.disabled ? '禁用' : '启用'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 whitespace-nowrap text-right text-sm">
                                                    <button
                                                        onClick={() => handleEdit(item)}
                                                        className="text-blue-600 hover:text-blue-900 mr-4"
                                                    >
                                                        编辑
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(item.id)}
                                                        className="text-red-600 hover:text-red-900"
                                                    >
                                                        删除
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h3 className="text-lg font-semibold mb-4">{editItem ? '编辑' : '新增'}{currentTab.label}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">编码</label>
                                    <input
                                        type="text"
                                        value={formData.code}
                                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        required
                                    />
                                </div>
                                {activeTab === 'voucher-types' && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">凭证字</label>
                                        <input
                                            type="text"
                                            value={formData.docword}
                                            onChange={(e) => setFormData({ ...formData, docword: e.target.value })}
                                            className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                >
                                    保存
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FinanceSettings;
