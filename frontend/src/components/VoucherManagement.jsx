import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import * as XLSX from 'xlsx';

const VoucherManagement = () => {
    const [vouchers, setVouchers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const [showFilters, setShowFilters] = useState(false);
    const [expandedVouchers, setExpandedVouchers] = useState(new Set());

    const [voucherTypes, setVoucherTypes] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newVoucher, setNewVoucher] = useState({
        voucher_date: new Date().toISOString().split('T')[0],
        voucher_type_id: '',
        entry_rows: [
            { summary: '', account_id: '', debit: '', credit: '' },
            { summary: '', account_id: '', debit: '', credit: '' },
            { summary: '', account_id: '', debit: '', credit: '' },
            { summary: '', account_id: '', debit: '', credit: '' }
        ],
        maker: 'System'
    });

    const [admins, setAdmins] = useState([]);

    const fetchAdmins = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/admins`);
            const data = await response.json();
            if (data.success) {
                setAdmins(data.data);
            }
        } catch (error) {
            console.error('Fetch admins failed:', error);
        }
    };

    const [filters, setFilters] = useState({
        page_size: 20,
        start_date: '',
        end_date: '',
        voucher_code: '',
        account_code: '',
        voucher_type: '',
        related_unit: '',
        maker: ''
    });

    const fetchVouchers = async (page = 1) => {
        setLoading(true);
        try {
            const queryParams = new URLSearchParams({
                page: page,
                page_size: pageSize,
                ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
            });

            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers?${queryParams}`);
            const data = await response.json();

            if (data.success) {
                setVouchers(data.data);
                setTotalItems(data.total);
                setTotalPages(Math.ceil(data.total / pageSize));
                setCurrentPage(data.page);
            } else {
                alert(data.message || '获取凭证列表失败');
            }
        } catch (error) {
            console.error('Fetch vouchers failed:', error);
            alert('网络错误，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const fetchVoucherTypes = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/voucher-types`);
            const data = await response.json();
            if (data.success) {
                setVoucherTypes(data.data);
                if (data.data.length > 0) {
                    setNewVoucher(prev => ({ ...prev, voucher_type_id: data.data[0].id }));
                }
            }
        } catch (error) {
            console.error('Fetch voucher types failed:', error);
        }
    };

    const fetchAccounts = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/accounts`);
            const data = await response.json();
            if (data.success) {
                setAccounts(data.data);
            }
        } catch (error) {
            console.error('Fetch accounts failed:', error);
        }
    };

    useEffect(() => {
        fetchVoucherTypes();
        fetchAccounts();
        fetchAdmins();
        fetchVouchers(1);
    }, [pageSize]); // Page size change triggers reload, page change handled by pagination click

    const handleSearch = (e) => {
        e.preventDefault();
        fetchVouchers(1);
    };

    const handleFilterChange = (e) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const toggleExpand = (id) => {
        const newExpanded = new Set(expandedVouchers);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedVouchers(newExpanded);
    };

    const handleDelete = async (id, code) => {
        if (!window.confirm(`确定要删除凭证 ${code} 吗？此操作不可恢复。`)) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers/${id}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                alert('删除成功');
                fetchVouchers(currentPage);
            } else {
                alert('删除失败: ' + data.message);
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('删除出错，请稍后重试');
        }
    };

    const handleExport = async () => {
        try {
            // Fetch all vouchers with current filters (no pagination)
            const queryParams = new URLSearchParams({
                page: 1,
                page_size: 10000, // Get all matching records (backend limit)
                ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
            });

            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers?${queryParams}`);
            const data = await response.json();

            if (!data.success) {
                alert('导出失败：' + data.message);
                return;
            }

            // Prepare data for Excel
            const exportData = [];

            data.data.forEach(voucher => {
                voucher.entries.forEach((entry, idx) => {
                    exportData.push({
                        '日期': voucher.voucher_date,
                        '凭证字': voucher.voucher_type_name,
                        '凭证号': voucher.code,
                        '往来单位': voucher.related_units || '',
                        '制单人': voucher.maker,
                        '分录序号': idx + 1,
                        '摘要': entry.summary,
                        '科目代码': entry.account_code,
                        '科目名称': entry.account_name,
                        '借方金额': entry.debit > 0 ? entry.debit : '',
                        '贷方金额': entry.credit > 0 ? entry.credit : ''
                    });
                });
            });

            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(exportData);

            // Set column widths
            ws['!cols'] = [
                { wch: 12 },  // 日期
                { wch: 8 },   // 凭证字
                { wch: 12 },  // 凭证号
                { wch: 20 },  // 往来单位
                { wch: 10 },  // 制单人
                { wch: 8 },   // 分录序号
                { wch: 30 },  // 摘要
                { wch: 12 },  // 科目代码
                { wch: 25 },  // 科目名称
                { wch: 15 },  // 借方金额
                { wch: 15 }   // 贷方金额
            ];

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '凭证数据');

            // Generate filename with current date
            const now = new Date();
            const filename = `凭证导出_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.xlsx`;

            // Download file
            XLSX.writeFile(wb, filename);

            alert(`成功导出 ${data.data.length} 条凭证记录！`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('导出失败，请稍后重试');
        }
    };

    return (
        <div className="p-6 bg-gray-50 flex flex-col h-full overflow-hidden">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-4">
                    <h1 className="text-2xl font-bold text-gray-800">梵贝琳凭证管理</h1>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${showFilters ? 'bg-gray-200 text-gray-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                    >
                        {showFilters ? '收起筛选' : '展开筛选'}
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-3 py-1 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                    >
                        填制凭证
                    </button>
                    <button
                        onClick={handleExport}
                        className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        disabled={loading}
                    >
                        导出Excel
                    </button>
                </div>
                <div className="text-sm text-gray-500">
                    数据来源：梵贝琳财务系统
                </div>
            </div>

            {/* 筛选区域 */}
            {showFilters && (
                <div className="bg-white p-4 rounded-lg shadow mb-4 transition-all duration-300 ease-in-out">
                    <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
                            <input
                                type="date"
                                name="start_date"
                                value={filters.start_date}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
                            <input
                                type="date"
                                name="end_date"
                                value={filters.end_date}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">凭证号</label>
                            <input
                                type="text"
                                name="voucher_code"
                                placeholder="输入凭证号"
                                value={filters.voucher_code}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">科目代码/名称</label>
                            <input
                                type="text"
                                name="account_code"
                                placeholder="输入科目"
                                value={filters.account_code}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">凭证类别</label>
                            <select
                                name="voucher_type"
                                value={filters.voucher_type}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="">全部</option>
                                {voucherTypes.map((type) => (
                                    <option key={type.id} value={type.id}>
                                        {type.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">往来单位</label>
                            <input
                                type="text"
                                name="related_unit"
                                placeholder="输入往来单位"
                                value={filters.related_unit || ''}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">制单人</label>
                            <input
                                type="text"
                                name="maker"
                                placeholder="输入制单人"
                                value={filters.maker || ''}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <button
                                type="submit"
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200"
                                disabled={loading}
                            >
                                {loading ? '查询中...' : '查询'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* 凭证列表 */}
            <div className="flex-1 bg-white rounded-lg shadow overflow-hidden flex flex-col">
                <div className="overflow-x-auto flex-1">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">凭证字</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">凭证号</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">往来单位</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">制单人</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">分录摘要 (首行)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">借方总额</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">贷方总额</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan="9" className="text-center py-10">加载中...</td></tr>
                            ) : vouchers.length === 0 ? (
                                <tr><td colSpan="9" className="text-center py-10">暂无凭证数据</td></tr>
                            ) : (
                                vouchers.map((voucher) => {
                                    // 计算总借贷
                                    const totalDebit = voucher.entries.reduce((sum, e) => sum + e.debit, 0);
                                    const totalCredit = voucher.entries.reduce((sum, e) => sum + e.credit, 0);
                                    const firstEntry = voucher.entries[0] || {};

                                    return (
                                        <React.Fragment key={voucher.id}>
                                            <tr className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{voucher.voucher_date}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{voucher.voucher_type_name}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                    {voucher.code}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs" title={voucher.related_units}>
                                                    {voucher.related_units}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{voucher.maker}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs" title={firstEntry.summary}>
                                                    {firstEntry.summary}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                                                    {totalDebit.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                                                    {totalCredit.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <button
                                                        onClick={() => toggleExpand(voucher.id)}
                                                        className="text-blue-600 hover:text-blue-900 mr-4 hover:underline"
                                                    >
                                                        {expandedVouchers.has(voucher.id) ? '收起' : '详情'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(voucher.id, voucher.code)}
                                                        className="text-red-600 hover:text-red-900 hover:underline"
                                                    >
                                                        删除
                                                    </button>
                                                </td>
                                            </tr>
                                            {/* 展开的详情行 */}
                                            {expandedVouchers.has(voucher.id) && (
                                                <tr>
                                                    <td colSpan="8" className="px-0 py-0 border-none">
                                                        <div className="bg-gray-50 px-6 py-2 shadow-inner">
                                                            <table className="min-w-full text-xs">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="text-left font-medium text-gray-500 py-1 w-2/5">摘要</th>
                                                                        <th className="text-left font-medium text-gray-500 py-1 w-1/5">科目</th>
                                                                        <th className="text-right font-medium text-gray-500 py-1 w-1/5">借方</th>
                                                                        <th className="text-right font-medium text-gray-500 py-1 w-1/5">贷方</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {voucher.entries.map((entry, idx) => (
                                                                        <tr key={`${voucher.code}-${idx}`} className="border-t border-gray-100">
                                                                            <td className="py-1 text-gray-700 truncate" title={entry.summary}>{entry.summary}</td>
                                                                            <td className="py-1 text-gray-700 truncate" title={`${entry.account_name} (${entry.account_code})`}>
                                                                                {entry.account_name} <span className="text-gray-400 font-mono text-xs">({entry.account_code})</span>
                                                                            </td>
                                                                            <td className="py-1 text-right text-gray-700 font-mono">{entry.debit > 0 ? entry.debit.toLocaleString() : ''}</td>
                                                                            <td className="py-1 text-right text-gray-700 font-mono">{entry.credit > 0 ? entry.credit.toLocaleString() : ''}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* 分页 */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                        共 {totalItems} 条记录，当前第 {currentPage} / {totalPages} 页
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => fetchVouchers(currentPage - 1)}
                            disabled={currentPage === 1 || loading}
                            className={`px-3 py-1 rounded border ${currentPage === 1 ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                        >
                            上一页
                        </button>
                        <button
                            onClick={() => fetchVouchers(currentPage + 1)}
                            disabled={currentPage === totalPages || loading}
                            className={`px-3 py-1 rounded border ${currentPage === totalPages ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                        >
                            下一页
                        </button>
                    </div>
                </div>
            </div>
            {/* 填制凭证 Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-11/12 max-w-6xl max-h-[90vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-gray-800">填制凭证</h2>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1">
                            {/* 表头 */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">凭证字</label>
                                    <select
                                        value={newVoucher.voucher_type_id}
                                        onChange={(e) => setNewVoucher({ ...newVoucher, voucher_type_id: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                    >
                                        {voucherTypes.map((type) => (
                                            <option key={type.id} value={type.id}>{type.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                                    <input
                                        type="date"
                                        value={newVoucher.voucher_date}
                                        onChange={(e) => setNewVoucher({ ...newVoucher, voucher_date: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                <div>

                                    <label className="block text-sm font-medium text-gray-700 mb-1">制单人</label>
                                    <select
                                        value={newVoucher.maker}
                                        onChange={(e) => setNewVoucher({ ...newVoucher, maker: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                    >
                                        <option value="System">System</option>
                                        {admins.map((admin) => (
                                            <option key={admin.id} value={admin.name}>{admin.id} - {admin.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* 分录表 */}
                            <table className="min-w-full divide-y divide-gray-200 mb-4 border border-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-12">序号</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-1/4">摘要</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-1/4">会计科目</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-1/6">借方金额</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-1/6">贷方金额</th>
                                        <th className="px-4 py-2 text-center w-12">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {newVoucher.entry_rows.map((row, index) => (
                                        <tr key={index}>
                                            <td className="px-4 py-2 text-center text-sm text-gray-500">{index + 1}</td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="text"
                                                    value={row.summary}
                                                    onChange={(e) => {
                                                        const newRows = [...newVoucher.entry_rows];
                                                        newRows[index].summary = e.target.value;
                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                    }}
                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm"
                                                    placeholder="摘要"
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <select
                                                    value={row.account_id}
                                                    onChange={(e) => {
                                                        const newRows = [...newVoucher.entry_rows];
                                                        newRows[index].account_id = e.target.value;
                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                    }}
                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm"
                                                >
                                                    <option value="">选择科目...</option>
                                                    {accounts.map(acc => (
                                                        <option key={acc.id} value={acc.id}>{acc.code} {acc.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={row.debit}
                                                    onChange={(e) => {
                                                        const newRows = [...newVoucher.entry_rows];
                                                        newRows[index].debit = e.target.value;
                                                        newRows[index].credit = ''; // Clear credit if debit is entered
                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                    }}
                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-right text-sm"
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={row.credit}
                                                    onChange={(e) => {
                                                        const newRows = [...newVoucher.entry_rows];
                                                        newRows[index].credit = e.target.value;
                                                        newRows[index].debit = ''; // Clear debit if credit is entered
                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                    }}
                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-right text-sm"
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                <button
                                                    onClick={() => {
                                                        const newRows = newVoucher.entry_rows.filter((_, i) => i !== index);
                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                    }}
                                                    className="text-red-500 hover:text-red-700"
                                                    title="删除行"
                                                >
                                                    &times;
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-gray-50 font-bold">
                                    <tr>
                                        <td colSpan="3" className="px-4 py-2 text-right">合计：</td>
                                        <td className="px-4 py-2 text-right text-blue-700">
                                            {newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.debit) || 0), 0).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2 text-right text-green-700">
                                            {newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.credit) || 0), 0).toLocaleString()}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>

                            <button
                                onClick={() => {
                                    setNewVoucher({
                                        ...newVoucher,
                                        entry_rows: [...newVoucher.entry_rows, { summary: '', account_id: '', debit: '', credit: '' }]
                                    });
                                }}
                                className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                            >
                                + 增加分录
                            </button>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3 bg-gray-50 rounded-b-lg">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100"
                            >
                                取消
                            </button>
                            <button
                                onClick={async () => {
                                    // Basic validation
                                    const totalDebit = newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.debit) || 0), 0);
                                    const totalCredit = newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.credit) || 0), 0);

                                    if (Math.abs(totalDebit - totalCredit) > 0.01) {
                                        alert(`借贷不平衡！借方: ${totalDebit}, 贷方: ${totalCredit}, 差额: ${Math.abs(totalDebit - totalCredit)}`);
                                        return;
                                    }

                                    if (totalDebit === 0 && totalCredit === 0) {
                                        alert("凭证金额不能为0");
                                        return;
                                    }

                                    const validRows = newVoucher.entry_rows.filter(r => r.account_id && (r.debit || r.credit));
                                    if (validRows.length === 0) {
                                        alert("请至少录入一条有效分录");
                                        return;
                                    }

                                    // Prepare payload
                                    const payload = {
                                        voucher_date: newVoucher.voucher_date,
                                        voucher_type_id: parseInt(newVoucher.voucher_type_id),
                                        entry_rows: validRows.map(r => ({
                                            summary: r.summary,
                                            account_id: parseInt(r.account_id),
                                            debit: parseFloat(r.debit) || 0,
                                            credit: parseFloat(r.credit) || 0
                                        }))
                                    };

                                    try {
                                        const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(payload)
                                        });
                                        const data = await response.json();
                                        if (data.success) {
                                            alert("凭证保存成功！");
                                            setShowCreateModal(false);
                                            fetchVouchers(1);
                                            // Reset form
                                            setNewVoucher({
                                                ...newVoucher,
                                                entry_rows: [
                                                    { summary: '', account_id: '', debit: '', credit: '' },
                                                    { summary: '', account_id: '', debit: '', credit: '' },
                                                    { summary: '', account_id: '', debit: '', credit: '' },
                                                    { summary: '', account_id: '', debit: '', credit: '' }
                                                ]
                                            });
                                        } else {
                                            alert("保存失败: " + data.message);
                                        }
                                    } catch (e) {
                                        console.error(e);
                                        alert("保存出错: " + e.message);
                                    }
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )
            }
        </div>
    );
};

export default VoucherManagement;
