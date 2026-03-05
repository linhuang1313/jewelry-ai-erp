import React, { useState, useEffect, useMemo } from 'react';
import { Settings, BookOpen, FileText, Users, Plus, Pencil, Trash2, ChevronRight, ChevronDown, ChevronsUpDown, Search, Calendar } from 'lucide-react';
import ConfirmationDialog from './ui/ConfirmationDialog';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const FinanceSettings = () => {
    const [activeTab, setActiveTab] = useState('accounts');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [parentItem, setParentItem] = useState(null);
    const [formData, setFormData] = useState({ code: '', name: '', docword: '' });
    const [collapsedCodes, setCollapsedCodes] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [confirmDialog, setConfirmDialog] = useState({isOpen: false, title: '', message: '', onConfirm: () => {}, isDestructive: false});
    const [accountYears, setAccountYears] = useState([]);
    const [selectedYear, setSelectedYear] = useState('');

    const tabs = [
        { id: 'accounts', label: '会计科目', icon: BookOpen, endpoint: '/settings/accounts', desc: '管理会计科目体系' },
        { id: 'voucher-types', label: '凭证类别', icon: FileText, endpoint: '/settings/voucher-types', desc: '设置凭证字与类别' },
        { id: 'partners', label: '往来单位', icon: Users, endpoint: '/settings/partners', desc: '客户与供应商档案' }
    ];

    const currentTab = tabs.find(t => t.id === activeTab);

    const fetchAccountYears = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/settings/account-years`);
            const result = await response.json();
            if (result.success && result.data.length > 0) {
                setAccountYears(result.data);
                if (!selectedYear) {
                    setSelectedYear(result.data[0]);
                }
            }
        } catch (error) {
            console.error('Fetch account years failed:', error);
        }
    };

    useEffect(() => {
        fetchAccountYears();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            let url = `${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}`;
            if (activeTab === 'accounts' && selectedYear) {
                url += `?year=${selectedYear}`;
            }
            const response = await fetch(url);
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
        if (activeTab !== 'accounts' || selectedYear) {
            fetchData();
        }
        setCollapsedCodes(new Set());
        setSearchTerm('');
    }, [activeTab, selectedYear]);

    // 科目树相关逻辑
    const hasChildren = (item) => {
        if (activeTab !== 'accounts') return false;
        return data.some(d => d.code !== item.code && d.code.startsWith(item.code));
    };

    const isHidden = (item) => {
        if (activeTab !== 'accounts') return false;
        for (const collapsedCode of collapsedCodes) {
            if (item.code !== collapsedCode && item.code.startsWith(collapsedCode)) {
                return true;
            }
        }
        return false;
    };

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

    const expandAll = () => setCollapsedCodes(new Set());

    const collapseAll = () => {
        const level1Codes = data.filter(d => d.depth === 1).map(d => d.code);
        setCollapsedCodes(new Set(level1Codes));
    };

    const visibleData = useMemo(() => {
        let items = activeTab === 'accounts' ? data.filter(item => !isHidden(item)) : data;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            items = items.filter(item =>
                (item.code && item.code.toLowerCase().includes(term)) ||
                (item.name && item.name.toLowerCase().includes(term))
            );
        }
        return items;
    }, [data, collapsedCodes, activeTab, searchTerm]);

    const handleAdd = () => {
        setEditItem(null);
        setParentItem(null);
        setFormData({ code: '', name: '', docword: '' });
        setShowModal(true);
    };

    const handleAddChild = async (parent) => {
        setEditItem(null);
        setParentItem(parent);
        // 获取下一个子科目编码
        try {
            const resp = await fetch(`${API_BASE_URL}/api/fbl-finance/settings/accounts/${parent.id}/next-child-code`);
            const result = await resp.json();
            if (result.success) {
                setFormData({ code: result.data.next_code, name: '' });
            } else {
                setFormData({ code: parent.code, name: '' });
            }
        } catch {
            setFormData({ code: parent.code, name: '' });
        }
        setShowModal(true);
        // 确保父科目展开
        setCollapsedCodes(prev => {
            const newSet = new Set(prev);
            newSet.delete(parent.code);
            return newSet;
        });
    };

    const handleEdit = (item) => {
        setEditItem(item);
        setParentItem(null);
        setFormData({ code: item.code || '', name: item.name || '', docword: item.docword || '' });
        setShowModal(true);
    };

    const handleDelete = (id) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除设置',
            message: '确定要删除吗？',
            isDestructive: true,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                try {
                    const response = await fetch(`${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}/${id}`, { method: 'DELETE' });
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
            }
        });
    };

    const handleToggleStatus = async (item) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}/${item.id}/toggle`, { method: 'PATCH' });
            const result = await response.json();
            if (result.success) {
                // 直接更新本地数据，避免重新请求
                setData(prev => prev.map(d => d.id === item.id ? { ...d, disabled: result.disabled } : d));
            } else {
                alert(result.message || '状态切换失败');
            }
        } catch (error) {
            console.error('Toggle failed:', error);
            alert('状态切换失败');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editItem
                ? `${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}/${editItem.id}`
                : `${API_BASE_URL}/api/fbl-finance${currentTab.endpoint}`;
            const method = editItem ? 'PUT' : 'POST';
            const payload = { ...formData };
            // 新增子科目时带上 parent_id
            if (!editItem && parentItem) {
                payload.parent_id = parentItem.id;
            }
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                setShowModal(false);
                setParentItem(null);
                fetchData();
            } else {
                alert(result.message || '保存失败');
            }
        } catch (error) {
            console.error('Save failed:', error);
            alert('保存失败');
        }
    };

    // 深度颜色映射
    const depthStyles = {
        1: 'bg-amber-50/60 font-semibold',
        2: 'bg-orange-50/30',
        3: 'bg-gray-50/50',
        4: '',
        5: '',
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 overflow-y-auto">
            <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6">

                {/* 页面标题 */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center shadow-sm">
                        <Settings className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">基础设置</h1>
                        <p className="text-xs text-gray-400">梵贝琳财务系统基础数据管理</p>
                    </div>
                </div>

                {/* Tab 切换 */}
                <div className="flex gap-2 mb-5">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                                    isActive
                                        ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                                }`}
                            >
                                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-500' : 'text-gray-400'}`} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* 主内容区 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 overflow-hidden">

                    {/* 工具栏 */}
                    <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 flex items-center gap-3">
                            <h2 className="text-base font-semibold text-gray-800">{currentTab.label}</h2>
                            <span className="text-xs text-gray-400 hidden sm:inline">{currentTab.desc}</span>
                            <span className="ml-auto sm:ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                                {visibleData.length} 条
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {activeTab === 'accounts' && accountYears.length > 0 && (
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                                        className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none bg-white"
                                    >
                                        {accountYears.map(y => (
                                            <option key={y} value={y}>{y}年</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="搜索编码或名称..."
                                    className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none w-44 transition-all"
                                />
                            </div>
                            {activeTab === 'accounts' && (
                                <button
                                    onClick={() => collapsedCodes.size > 0 ? expandAll() : collapseAll()}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                    title={collapsedCodes.size > 0 ? '展开全部' : '收起全部'}
                                >
                                    <ChevronsUpDown className="w-3.5 h-3.5" />
                                    {collapsedCodes.size > 0 ? '展开' : '收起'}
                                </button>
                            )}
                            {activeTab !== 'accounts' && (
                                <button
                                    onClick={handleAdd}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-500 rounded-lg hover:from-amber-600 hover:to-yellow-600 shadow-sm transition-all"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    新增
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 表格 */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-gray-50/80">
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">编码</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名称</th>
                                    {activeTab === 'voucher-types' && (
                                        <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">凭证字</th>
                                    )}
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">状态</th>
                                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="px-5 py-16 text-center">
                                            <div className="flex flex-col items-center gap-2 text-gray-400">
                                                <div className="w-6 h-6 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-sm">加载中...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : visibleData.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-5 py-16 text-center">
                                            <div className="flex flex-col items-center gap-2 text-gray-400">
                                                <BookOpen className="w-8 h-8 text-gray-300" />
                                                <span className="text-sm">{searchTerm ? '未找到匹配项' : '暂无数据'}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    visibleData.map(item => {
                                        const isCollapsed = collapsedCodes.has(item.code);
                                        const itemHasChildren = hasChildren(item);
                                        const depth = item.depth || 1;
                                        const rowStyle = depthStyles[Math.min(depth, 5)] || '';

                                        return (
                                            <tr
                                                key={item.id}
                                                className={`${rowStyle} hover:bg-amber-50/40 transition-colors group`}
                                            >
                                                <td className="px-5 py-2.5 whitespace-nowrap text-sm text-gray-800">
                                                    <div className="flex items-center" style={{ paddingLeft: `${(depth - 1) * 18}px` }}>
                                                        {activeTab === 'accounts' && itemHasChildren && (
                                                            <button
                                                                onClick={() => toggleCollapse(item.code)}
                                                                className="mr-1.5 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                                            >
                                                                {isCollapsed
                                                                    ? <ChevronRight className="w-3.5 h-3.5" />
                                                                    : <ChevronDown className="w-3.5 h-3.5" />
                                                                }
                                                            </button>
                                                        )}
                                                        {activeTab === 'accounts' && !itemHasChildren && depth > 1 && (
                                                            <span className="mr-1.5 w-5 h-5 flex items-center justify-center text-gray-200 text-xs">─</span>
                                                        )}
                                                        <span className={`font-mono text-xs ${depth === 1 ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
                                                            {item.code}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-2.5 whitespace-nowrap text-sm">
                                                    <span className={depth === 1 ? 'font-semibold text-gray-800' : 'text-gray-700'}>
                                                        {item.name}
                                                    </span>
                                                </td>
                                                {activeTab === 'voucher-types' && (
                                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-gray-600">{item.docword}</td>
                                                )}
                                                <td className="px-5 py-2.5 whitespace-nowrap">
                                                    <button
                                                        onClick={() => handleToggleStatus(item)}
                                                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full cursor-pointer transition-all hover:shadow-sm ${
                                                            item.disabled
                                                                ? 'bg-red-50 text-red-600 border border-red-100 hover:bg-red-100'
                                                                : 'bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100'
                                                        }`}
                                                        title={item.disabled ? '点击启用' : '点击禁用'}
                                                    >
                                                        {item.disabled ? '禁用' : '启用'}
                                                    </button>
                                                </td>
                                                <td className="px-5 py-2.5 whitespace-nowrap text-right">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {activeTab === 'accounts' && (
                                                            <button
                                                                onClick={() => handleAddChild(item)}
                                                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                                                title="新增子科目"
                                                            >
                                                                <Plus className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleEdit(item)}
                                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                            title="编辑"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(item.id)}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="删除"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
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

            {/* 编辑/新增 Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-yellow-50">
                            <h3 className="text-base font-semibold text-gray-800">
                                {editItem ? '编辑' : parentItem ? '新增子科目' : '新增'}{!parentItem && !editItem ? currentTab.label : ''}
                            </h3>
                            {parentItem && (
                                <p className="text-xs text-gray-500 mt-1">
                                    上级科目：<span className="font-mono text-amber-700">{parentItem.code}</span> {parentItem.name}
                                </p>
                            )}
                        </div>
                        <form onSubmit={handleSubmit} className="p-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-600 mb-1.5">编码</label>
                                    <input
                                        type="text"
                                        value={formData.code}
                                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none transition-all"
                                        required
                                        placeholder={parentItem ? `${parentItem.code}xx` : '请输入编码'}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-600 mb-1.5">名称</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none transition-all"
                                        required
                                        placeholder="请输入名称"
                                    />
                                </div>
                                {activeTab === 'voucher-types' && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-600 mb-1.5">凭证字</label>
                                        <input
                                            type="text"
                                            value={formData.docword}
                                            onChange={(e) => setFormData({ ...formData, docword: e.target.value })}
                                            className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none transition-all"
                                            placeholder="请输入凭证字"
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-500 rounded-xl hover:from-amber-600 hover:to-yellow-600 shadow-sm transition-all"
                                >
                                    保存
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <ConfirmationDialog
                isOpen={confirmDialog.isOpen}
                onClose={() => setConfirmDialog(prev => ({...prev, isOpen: false}))}
                onConfirm={confirmDialog.onConfirm}
                title={confirmDialog.title}
                message={confirmDialog.message}
                isDestructive={confirmDialog.isDestructive}
            />
        </div>
    );
};

export default FinanceSettings;
