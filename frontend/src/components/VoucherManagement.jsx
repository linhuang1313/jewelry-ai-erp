import React, { useState, useEffect, useRef, useMemo } from 'react';
import { API_BASE_URL } from '../config';
import * as XLSX from 'xlsx';
import { fetchWithCacheJson } from '../utils/fetchCache';
import SearchableSelect from './SearchableSelect';
import ConfirmationDialog from './ui/ConfirmationDialog';

const VoucherManagement = () => {
    // Unit conversion factors (Gold standard: Troy Ounce)
    const UNIT_FACTORS = {
        '克': 1,
        '千克': 1000,
        '盎司': 31.1035
    };

    const updateEntryAmount = (row, isForeignMode = false) => {
        let newRow = { ...row };

        if (isForeignMode && newRow.currency_id && newRow.exchange_rate) {
            // 外币模式：本币金额 = 原币金额 × 汇率
            const origAmount = parseFloat(newRow.orig_amount) || 0;
            const rate = parseFloat(newRow.exchange_rate) || 0;
            const localAmount = (origAmount * rate).toFixed(2);

            if (newRow.direction === 'debit') {
                newRow.debit = localAmount == 0 ? '' : localAmount;
                newRow.credit = '';
            } else {
                newRow.credit = localAmount == 0 ? '' : localAmount;
                newRow.debit = '';
            }
        } else {
            // 本币模式：金额 = 数量 × 单价 × 单位换算
            const factor = UNIT_FACTORS[newRow.unit] || 1;
            const qty = parseFloat(newRow.quantity) || 0;
            const price = parseFloat(newRow.price) || 0;
            const amount = (qty * price * factor).toFixed(3);

            if (newRow.direction === 'debit') {
                newRow.debit = amount == 0 ? '' : amount;
                newRow.credit = '';
            } else {
                newRow.credit = amount == 0 ? '' : amount;
                newRow.debit = '';
            }
        }
        return newRow;
    };

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
    const [foreignCurrencyMode, setForeignCurrencyMode] = useState(false);
    const [measureMode, setMeasureMode] = useState(false);  // 计量模式：数量×单价
    const [currencies, setCurrencies] = useState([]);
    const [partners, setPartners] = useState([]);
    const [newVoucher, setNewVoucher] = useState({
        voucher_date: new Date().toISOString().split('T')[0],
        voucher_type_id: '',
        entry_rows: [
            { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'debit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
            { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'credit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
            { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'debit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
            { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'credit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' }
        ],
        maker: 'System'
    });

    const [admins, setAdmins] = useState([]);
    const [confirmDialog, setConfirmDialog] = useState({isOpen: false, title: '', message: '', onConfirm: () => {}, isDestructive: false});

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
        filter_year: '',
        filter_month: '',
        voucher_code: '',
        account_code: '',
        voucher_type: '',
        related_unit: '',
        maker: '',
        summary: '', // 新增
        posted_status: 'all', // 新增: all/posted/unposted
        date_filter_mode: 'range' // 'range' or 'month'
    });

    const [filterAccountId, setFilterAccountId] = useState('');
    const [filterPartnerId, setFilterPartnerId] = useState('');
    const [filterVoucherTypeId, setFilterVoucherTypeId] = useState('');
    const [filterMaker, setFilterMaker] = useState('');

    const makerOptions = useMemo(() =>
        admins.map(a => ({ id: a.name, code: String(a.id), name: a.name })),
        [admins]
    );

    // 排序状态
    const [sortBy, setSortBy] = useState('');
    const [sortOrder, setSortOrder] = useState('desc');

    // 新增: 批量记账状态
    const [showBatchPostModal, setShowBatchPostModal] = useState(false);
    const [batchPostData, setBatchPostData] = useState({
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1
    });

    const fetchVouchers = async (page = 1) => {
        setLoading(true);
        try {
            const queryParams = new URLSearchParams({
                page: page,
                page_size: pageSize,
                ...Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && !(k === 'posted_status' && v === 'all') && k !== 'date_filter_mode' && k !== 'page_size')),
                ...(sortBy ? { sort_by: sortBy, sort_order: sortOrder } : {})
            });

            const processData = (data) => {
                if (data.success) {
                    setVouchers(data.data);
                    setTotalItems(data.total);
                    setTotalPages(Math.ceil(data.total / pageSize));
                    setCurrentPage(data.page);
                } else {
                    alert(data.message || '获取凭证列表失败');
                }
            };

            const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/vouchers?${queryParams}`, {}, (cachedData) => {
                processData(cachedData);
                setLoading(false);
            });
            processData(data);
        } catch (error) {
            console.error('Fetch vouchers failed:', error);
            alert('网络错误，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const fetchVoucherTypes = async () => {
        try {
            const processData = (data) => {
                if (data.success) {
                    setVoucherTypes(data.data);
                    if (data.data.length > 0) {
                        setNewVoucher(prev => ({ ...prev, voucher_type_id: data.data[0].id }));
                    }
                }
            };

            const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/voucher-types`, {}, processData);
            processData(data);
        } catch (error) {
            console.error('Fetch voucher types failed:', error);
        }
    };

    const fetchAccounts = async (year) => {
        try {
            const processData = (data) => {
                if (data.success) {
                    setAccounts(data.data);
                }
            };
            const url = year
                ? `${API_BASE_URL}/api/fbl-finance/accounts?year=${year}`
                : `${API_BASE_URL}/api/fbl-finance/accounts`;
            const data = await fetchWithCacheJson(url, {}, processData);
            processData(data);
        } catch (error) {
            console.error('Fetch accounts failed:', error);
        }
    };

    const fetchCurrencies = async () => {
        try {
            const processData = (data) => {
                if (data.success) {
                    setCurrencies(data.data.filter(c => !c.is_native));
                }
            };
            const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/currencies`, {}, processData);
            processData(data);
        } catch (error) {
            console.error('Fetch currencies failed:', error);
        }
    };

    const fetchPartners = async () => {
        try {
            const processData = (data) => {
                if (data.success) {
                    setPartners(data.data);
                }
            };
            const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/partners`, {}, processData);
            processData(data);
        } catch (error) {
            console.error('Fetch partners failed:', error);
        }
    };

    useEffect(() => {
        fetchVoucherTypes();
        fetchAccounts(filters.filter_year || undefined);
        fetchAdmins();
        fetchCurrencies();
        fetchPartners();
        fetchVouchers(1);
    }, [pageSize]);

    useEffect(() => {
        fetchAccounts(filters.filter_year || undefined);
    }, [filters.filter_year]);

    useEffect(() => {
        fetchVouchers(1);
    }, [filters.posted_status]);

    // 排序变化时自动重新查询
    useEffect(() => {
        fetchVouchers(1);
    }, [sortBy, sortOrder]);

    const handleSearch = (e) => {
        e.preventDefault();
        fetchVouchers(1);
    };

    const handleFilterChange = (e) => {
        setFilters({ ...filters, [e.target.name]: e.target.value });
    };

    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
    };

    const SortIcon = ({ field }) => {
        if (sortBy !== field) return <span className="ml-1 text-gray-300">↕</span>;
        return <span className="ml-1 text-blue-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>;
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

    const handleDelete = (id, code) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除凭证',
            message: `确定要删除凭证 ${code} 吗？此操作不可恢复。`,
            isDestructive: true,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
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
            }
        });
    };

    const handlePost = (id, code) => {
        setConfirmDialog({
            isOpen: true,
            title: '凭证记账',
            message: `确定要将凭证 ${code} 标记为已记账吗？`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                try {
                    const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers/${id}/post`, { method: 'POST' });
                    const data = await response.json();
                    if (data.success) {
                        alert('记账成功');
                        fetchVouchers(currentPage);
                    } else {
                        alert('记账失败: ' + data.message);
                    }
                } catch (error) {
                    console.error('Post failed:', error);
                    alert('记账出错，请稍后重试');
                }
            }
        });
    };

    const handleUnpost = (id, code) => {
        setConfirmDialog({
            isOpen: true,
            title: '凭证反记账',
            message: `确定要将凭证 ${code} 反记账吗？`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                try {
                    const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers/${id}/unpost`, { method: 'POST' });
                    const data = await response.json();
                    if (data.success) {
                        alert('反记账成功');
                        fetchVouchers(currentPage);
                    } else {
                        alert('反记账失败: ' + data.message);
                    }
                } catch (error) {
                    console.error('Unpost failed:', error);
                    alert('反记账出错，请稍后重试');
                }
            }
        });
    };

    const handleBatchPost = () => {
        setConfirmDialog({
            isOpen: true,
            title: '批量记账',
            message: `确定要将 ${batchPostData.year}年${batchPostData.month}月 的所有未记账凭证标记为已记账吗？`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                try {
                    const response = await fetch(`${API_BASE_URL}/api/fbl-finance/vouchers/batch-post`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(batchPostData)
                    });
                    const data = await response.json();
                    if (data.success) {
                        alert(data.message);
                        setShowBatchPostModal(false);
                        fetchVouchers(1);
                    } else {
                        alert('批量记账失败: ' + data.message);
                    }
                } catch (error) {
                    console.error('Batch post failed:', error);
                    alert('批量记账出错，请稍后重试');
                }
            }
        });
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
                        '凭证日期': voucher.voucher_date,
                        '凭证字': voucher.voucher_type_name,
                        '凭证号': voucher.code,
                        '记账状态': voucher.ispost ? '已记账' : '未记账',
                        '记账日期': voucher.post_date ? voucher.post_date.split('T')[0] : '',
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col max-w-[1600px] w-full mx-auto px-4 py-5 sm:px-6 overflow-hidden">

                {/* 页面标题 + 操作栏 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-800">凭证管理</h1>
                            <p className="text-xs text-gray-400">梵贝琳财务系统</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showFilters
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                            筛选
                        </button>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-500 rounded-lg hover:from-amber-600 hover:to-yellow-600 shadow-sm transition-all"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            填制凭证
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            导出
                        </button>
                    </div>
                </div>

                {/* 筛选区域 */}
                {showFilters && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 p-4 mb-4 transition-all">
                        <form onSubmit={handleSearch} className="space-y-3">
                            <div className="flex items-center gap-4 flex-wrap">
                                <span className="text-xs font-semibold text-gray-500 uppercase">日期方式</span>
                                <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm text-gray-600">
                                    <input type="radio" name="date_filter_mode" value="range" checked={filters.date_filter_mode === 'range'}
                                        onChange={() => setFilters({ ...filters, date_filter_mode: 'range', filter_year: '', filter_month: '' })}
                                        className="w-3.5 h-3.5 text-amber-500 focus:ring-amber-300" />
                                    日期范围
                                </label>
                                <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm text-gray-600">
                                    <input type="radio" name="date_filter_mode" value="month" checked={filters.date_filter_mode === 'month'}
                                        onChange={() => setFilters({ ...filters, date_filter_mode: 'month', start_date: '', end_date: '' })}
                                        className="w-3.5 h-3.5 text-amber-500 focus:ring-amber-300" />
                                    指定月份
                                </label>
                                <div className="flex-1" />
                                <label className="inline-flex items-center gap-1.5 cursor-pointer bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-200">
                                    <input type="checkbox" checked={filters.summary === '结转'}
                                        onChange={(e) => setFilters({ ...filters, summary: e.target.checked ? '结转' : '' })}
                                        className="w-3.5 h-3.5 text-orange-500 focus:ring-orange-300 rounded" />
                                    <span className="text-xs font-medium text-orange-700">只看结转</span>
                                </label>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                {filters.date_filter_mode === 'range' ? (
                                    <>
                                        <input type="date" name="start_date" value={filters.start_date} onChange={handleFilterChange}
                                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none" placeholder="开始" />
                                        <input type="date" name="end_date" value={filters.end_date} onChange={handleFilterChange}
                                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none" placeholder="结束" />
                                    </>
                                ) : (
                                    <>
                                        <select name="filter_year" value={filters.filter_year} onChange={handleFilterChange}
                                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none">
                                            <option value="">全部年份</option>
                                            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                        <select name="filter_month" value={filters.filter_month} onChange={handleFilterChange}
                                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none">
                                            <option value="">全部月份</option>
                                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                                <option key={m} value={m}>{m}月</option>
                                            ))}
                                        </select>
                                    </>
                                )}
                                <input type="text" name="voucher_code" placeholder="凭证号" value={filters.voucher_code} onChange={handleFilterChange}
                                    className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none" />
                                <SearchableSelect
                                    options={accounts}
                                    value={filterAccountId}
                                    onChange={(id) => {
                                        setFilterAccountId(id);
                                        const acct = accounts.find(a => a.id === id);
                                        setFilters(f => ({ ...f, account_code: acct ? acct.name : '' }));
                                    }}
                                    placeholder="科目"
                                    inputClassName="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none"
                                />
                                <SearchableSelect
                                    options={voucherTypes}
                                    value={filterVoucherTypeId}
                                    onChange={(id) => {
                                        setFilterVoucherTypeId(id);
                                        setFilters(f => ({ ...f, voucher_type: id || '' }));
                                    }}
                                    placeholder="凭证类别"
                                    inputClassName="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none"
                                />
                                <SearchableSelect
                                    options={partners}
                                    value={filterPartnerId}
                                    onChange={(id) => {
                                        setFilterPartnerId(id);
                                        const p = partners.find(a => a.id === id);
                                        setFilters(f => ({ ...f, related_unit: p ? p.name : '' }));
                                    }}
                                    placeholder="往来单位"
                                    inputClassName="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none"
                                />
                                <SearchableSelect
                                    options={makerOptions}
                                    value={filterMaker}
                                    onChange={(id) => {
                                        setFilterMaker(id);
                                        setFilters(f => ({ ...f, maker: id || '' }));
                                    }}
                                    placeholder="制单人"
                                    inputClassName="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-300 outline-none"
                                />
                                <button type="submit" disabled={loading}
                                    className="px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-yellow-500 rounded-lg hover:from-amber-600 hover:to-yellow-600 shadow-sm transition-all disabled:opacity-50">
                                    {loading ? '查询中...' : '查询'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* 记账状态标签 + 表格 */}
                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100/80 overflow-hidden flex flex-col">

                    {/* 状态标签栏 */}
                    <div className="flex items-center border-b border-gray-100 px-1">
                        {[
                            { key: 'all', label: '全部' },
                            { key: 'unposted', label: '未记账' },
                            { key: 'posted', label: '已记账' },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setFilters({ ...filters, posted_status: tab.key })}
                                className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${filters.posted_status === tab.key
                                    ? 'text-amber-700'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                {tab.label}
                                {filters.posted_status === tab.key && (
                                    <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-amber-500 rounded-full" />
                                )}
                            </button>
                        ))}
                        <div className="flex-1" />
                        {filters.posted_status === 'unposted' && (
                            <button
                                onClick={() => setShowBatchPostModal(true)}
                                className="mr-3 px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                            >
                                批量记账
                            </button>
                        )}
                    </div>

                    {/* 凭证列表 */}
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm min-w-[600px]">
                            <thead className="bg-gray-50/80 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none" onClick={() => handleSort('voucher_date')}>日期<SortIcon field="voucher_date" /></th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none" onClick={() => handleSort('voucher_type_name')}>类别<SortIcon field="voucher_type_name" /></th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none" onClick={() => handleSort('code')}>凭证号<SortIcon field="code" /></th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none" onClick={() => handleSort('post_date')}>记账日期<SortIcon field="post_date" /></th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">往来单位</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-amber-600 select-none" onClick={() => handleSort('maker')}>制单人<SortIcon field="maker" /></th>
                                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">摘要</th>
                                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">借方</th>
                                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">贷方</th>
                                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="10" className="py-16 text-center">
                                            <div className="flex flex-col items-center gap-2 text-gray-400">
                                                <div className="w-6 h-6 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-sm">加载中...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : vouchers.length === 0 ? (
                                    <tr>
                                        <td colSpan="10" className="py-16 text-center">
                                            <div className="flex flex-col items-center gap-2 text-gray-400">
                                                <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                <span className="text-sm">暂无凭证数据</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    vouchers.map((voucher) => {
                                        const totalDebit = voucher.entries.reduce((sum, e) => sum + e.debit, 0);
                                        const totalCredit = voucher.entries.reduce((sum, e) => sum + e.credit, 0);
                                        const firstEntry = voucher.entries[0] || {};

                                        return (
                                            <React.Fragment key={voucher.id}>
                                                <tr className="hover:bg-amber-50/30 transition-colors group">
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-700">{voucher.voucher_date}</td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-600">{voucher.voucher_type_name}</td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm font-semibold text-gray-800 font-mono">{voucher.code}</td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500">
                                                        {voucher.post_date ? (
                                                            <span className="text-emerald-600">{voucher.post_date.split('T')[0]}</span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500 truncate max-w-[160px]" title={voucher.related_units}>
                                                        {voucher.related_units}
                                                    </td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500">{voucher.maker}</td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500 truncate max-w-[180px]" title={firstEntry.summary}>
                                                        {firstEntry.summary}
                                                    </td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right font-mono text-blue-700 font-medium">
                                                        {(totalDebit !== 0 && totalDebit !== null && totalDebit !== undefined) ? totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                                    </td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-right font-mono text-emerald-700 font-medium">
                                                        {(totalCredit !== 0 && totalCredit !== null && totalCredit !== undefined) ? totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                                    </td>
                                                    <td className="px-4 py-2.5 whitespace-nowrap text-center">
                                                        <div className="inline-flex items-center gap-1">
                                                            <button
                                                                onClick={() => toggleExpand(voucher.id)}
                                                                className="px-2 py-0.5 text-xs font-medium text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                                            >
                                                                {expandedVouchers.has(voucher.id) ? '收起' : '详情'}
                                                            </button>
                                                            {voucher.ispost ? (
                                                                <button
                                                                    onClick={() => handleUnpost(voucher.id, voucher.code)}
                                                                    className="px-2 py-0.5 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded transition-colors"
                                                                >
                                                                    反记账
                                                                </button>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => handlePost(voucher.id, voucher.code)}
                                                                        className="px-2 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                                                                    >
                                                                        记账
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(voucher.id, voucher.code)}
                                                                        className="px-2 py-0.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                                    >
                                                                        删除
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedVouchers.has(voucher.id) && (
                                                    <tr>
                                                        <td colSpan="10" className="p-0">
                                                            <div className="bg-amber-50/40 px-6 py-2.5 border-y border-amber-100/60 overflow-x-auto">
                                                                <table className="min-w-[400px] text-xs">
                                                                    <thead>
                                                                        <tr>
                                                                            <th className="text-left font-semibold text-gray-500 py-1 w-2/5">摘要</th>
                                                                            <th className="text-left font-semibold text-gray-500 py-1 w-1/5">科目</th>
                                                                            <th className="text-right font-semibold text-gray-500 py-1 w-1/5">借方</th>
                                                                            <th className="text-right font-semibold text-gray-500 py-1 w-1/5">贷方</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {voucher.entries.map((entry, idx) => (
                                                                            <tr key={`${voucher.code}-${idx}`} className="border-t border-amber-100/40">
                                                                                <td className="py-1.5 text-gray-700">{entry.summary}</td>
                                                                                <td className="py-1.5 text-gray-700">
                                                                                    {entry.account_name} <span className="text-gray-400 font-mono">({entry.account_code})</span>
                                                                                </td>
                                                                                <td className="py-1.5 text-right text-blue-700 font-mono">{(entry.debit !== 0 && entry.debit !== null && entry.debit !== undefined) ? entry.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}</td>
                                                                                <td className="py-1.5 text-right text-emerald-700 font-mono">{(entry.credit !== 0 && entry.credit !== null && entry.credit !== undefined) ? entry.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}</td>
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
                    <div className="px-5 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                            共 <span className="font-semibold text-gray-700">{totalItems}</span> 条 &middot; 第 {currentPage}/{totalPages} 页
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => fetchVouchers(currentPage - 1)}
                                disabled={currentPage === 1 || loading}
                                className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                上一页
                            </button>
                            <button
                                onClick={() => fetchVouchers(currentPage + 1)}
                                disabled={currentPage === totalPages || loading}
                                className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {/* 填制凭证 Modal */}
            {
                showCreateModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg shadow-xl w-[95vw] max-w-[1400px] max-h-[95vh] flex flex-col">
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
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
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
                                        <label className="block text-sm font-medium text-gray-700 mb-1">凭证日期</label>
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

                                {/* 模式切换 */}
                                <div className="flex items-center gap-6 mb-3">
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <div className={`relative w-10 h-5 rounded-full transition-colors ${measureMode ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                            onClick={() => setMeasureMode(!measureMode)}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${measureMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                        </div>
                                        <span className="text-sm font-medium text-gray-700">计量模式</span>
                                        {measureMode && <span className="text-xs text-emerald-500">数量 x 单价自动计算金额</span>}
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <div className={`relative w-10 h-5 rounded-full transition-colors ${foreignCurrencyMode ? 'bg-blue-500' : 'bg-gray-300'}`}
                                            onClick={() => setForeignCurrencyMode(!foreignCurrencyMode)}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${foreignCurrencyMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                        </div>
                                        <span className="text-sm font-medium text-gray-700">外币模式</span>
                                        {foreignCurrencyMode && <span className="text-xs text-blue-500">指定外币币种和汇率</span>}
                                    </label>
                                </div>

                                {/* 分录表 */}
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 mb-4 border border-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">序号</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{ minWidth: '120px' }}>摘要</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{ minWidth: '140px' }}>会计科目</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{ minWidth: '130px' }}>往来单位</th>
                                                {foreignCurrencyMode && (
                                                    <>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">币种</th>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">汇率</th>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">原币金额</th>
                                                    </>
                                                )}
                                                {measureMode && (
                                                    <>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">计量单位</th>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">数量</th>
                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">单价</th>
                                                    </>
                                                )}
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-16">方向</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">借方本币</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">贷方本币</th>
                                                <th className="px-3 py-2 text-left w-10">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {newVoucher.entry_rows.map((row, index) => (
                                                <tr key={index}>
                                                    <td className="px-3 py-2 text-center text-sm text-gray-500">{index + 1}</td>
                                                    <td className="px-3 py-2">
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
                                                    <td className="px-3 py-2">
                                                        <SearchableSelect
                                                            options={accounts}
                                                            value={row.account_id}
                                                            onChange={(id) => {
                                                                const newRows = [...newVoucher.entry_rows];
                                                                newRows[index].account_id = id;
                                                                setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                            }}
                                                            placeholder="选择或搜索科目..."
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <SearchableSelect
                                                            options={partners}
                                                            value={row.partner_id}
                                                            onChange={(id) => {
                                                                const newRows = [...newVoucher.entry_rows];
                                                                newRows[index].partner_id = id;
                                                                setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                            }}
                                                            placeholder="选择往来单位..."
                                                        />
                                                    </td>

                                                    {/* 外币模式：币种、汇率、原币金额 */}
                                                    {foreignCurrencyMode && (
                                                        <>
                                                            <td className="px-3 py-2">
                                                                <select
                                                                    value={row.currency_id || ''}
                                                                    onChange={(e) => {
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        const cid = e.target.value;
                                                                        newRows[index].currency_id = cid;
                                                                        // 自动填充最新汇率
                                                                        if (cid) {
                                                                            const cur = currencies.find(c => String(c.id) === cid);
                                                                            if (cur && cur.latest_rate) {
                                                                                newRows[index].exchange_rate = String(cur.latest_rate);
                                                                            }
                                                                        } else {
                                                                            newRows[index].exchange_rate = '';
                                                                        }
                                                                        newRows[index] = updateEntryAmount(newRows[index], true);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm"
                                                                >
                                                                    <option value="">本币</option>
                                                                    {currencies.map(c => (
                                                                        <option key={c.id} value={c.id}>{c.code} {c.name}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <input
                                                                    type="text"
                                                                    value={row.exchange_rate || ''}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        if (val && !/^\d*\.?\d*$/.test(val)) return;
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        newRows[index].exchange_rate = val;
                                                                        newRows[index] = updateEntryAmount(newRows[index], true);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    disabled={!row.currency_id}
                                                                    placeholder={row.currency_id ? "汇率" : "-"}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm disabled:bg-gray-100"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <input
                                                                    type="text"
                                                                    value={row.orig_amount || ''}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        if (val && !/^-?\d*\.?\d*$/.test(val)) return;
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        newRows[index].orig_amount = val;
                                                                        newRows[index] = updateEntryAmount(newRows[index], true);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    disabled={!row.currency_id}
                                                                    placeholder={row.currency_id ? "原币金额" : "-"}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm disabled:bg-gray-100"
                                                                />
                                                            </td>
                                                        </>
                                                    )}

                                                    {/* 计量模式：计量单位、数量、单价 */}
                                                    {measureMode && (
                                                        <>
                                                            <td className="px-3 py-2">
                                                                <select
                                                                    value={row.unit}
                                                                    onChange={(e) => {
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        newRows[index].unit = e.target.value;
                                                                        newRows[index] = updateEntryAmount(newRows[index], false);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-left"
                                                                >
                                                                    {Object.keys(UNIT_FACTORS).map(u => (
                                                                        <option key={u} value={u}>{u}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <input
                                                                    type="text"
                                                                    value={row.quantity}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        if (!/^\d*\.?\d*$/.test(val)) return;
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        newRows[index].quantity = val;
                                                                        newRows[index] = updateEntryAmount(newRows[index], false);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-left text-sm"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <input
                                                                    type="text"
                                                                    value={row.price}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        if (!/^\d*\.?\d*$/.test(val)) return;
                                                                        const newRows = [...newVoucher.entry_rows];
                                                                        newRows[index].price = val;
                                                                        newRows[index] = updateEntryAmount(newRows[index], false);
                                                                        setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                    }}
                                                                    className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-left text-sm"
                                                                />
                                                            </td>
                                                        </>
                                                    )}

                                                    <td className="px-3 py-2 text-center text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 rounded select-none"
                                                        onClick={() => {
                                                            const dir = row.direction === 'debit' ? 'credit' : 'debit';
                                                            const newRows = [...newVoucher.entry_rows];
                                                            newRows[index].direction = dir;

                                                            if (foreignCurrencyMode && newRows[index].currency_id) {
                                                                newRows[index] = updateEntryAmount(newRows[index], true);
                                                            } else if (measureMode) {
                                                                // 计量模式：重新计算
                                                                newRows[index] = updateEntryAmount(newRows[index], false);
                                                            } else {
                                                                // 默认模式：移动已有金额到对应方向
                                                                let amount = newRows[index].debit || newRows[index].credit || '';
                                                                if (dir === 'debit') {
                                                                    newRows[index].debit = amount;
                                                                    newRows[index].credit = '';
                                                                } else {
                                                                    newRows[index].credit = amount;
                                                                    newRows[index].debit = '';
                                                                }
                                                            }
                                                            setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                        }}
                                                    >
                                                        {row.direction === 'debit' ? '借' : '贷'}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {(measureMode || (foreignCurrencyMode && row.currency_id)) ? (
                                                            <div className="w-full px-2 py-1 text-right text-sm text-gray-700 font-mono min-h-[28px] flex items-center justify-end bg-gray-50 rounded">
                                                                {row.debit ? parseFloat(row.debit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                                            </div>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={row.debit}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    if (val && !/^\d*\.?\d*$/.test(val)) return;
                                                                    const newRows = [...newVoucher.entry_rows];
                                                                    newRows[index].debit = val;
                                                                    if (val) {
                                                                        newRows[index].credit = '';
                                                                        newRows[index].direction = 'debit';
                                                                    }
                                                                    setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                }}
                                                                placeholder=""
                                                                className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-right text-sm font-mono"
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {(measureMode || (foreignCurrencyMode && row.currency_id)) ? (
                                                            <div className="w-full px-2 py-1 text-right text-sm text-gray-700 font-mono min-h-[28px] flex items-center justify-end bg-gray-50 rounded">
                                                                {row.credit ? parseFloat(row.credit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                                                            </div>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={row.credit}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    if (val && !/^\d*\.?\d*$/.test(val)) return;
                                                                    const newRows = [...newVoucher.entry_rows];
                                                                    newRows[index].credit = val;
                                                                    if (val) {
                                                                        newRows[index].debit = '';
                                                                        newRows[index].direction = 'credit';
                                                                    }
                                                                    setNewVoucher({ ...newVoucher, entry_rows: newRows });
                                                                }}
                                                                placeholder=""
                                                                className="w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-right text-sm font-mono"
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
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
                                                <td colSpan={5 + (foreignCurrencyMode ? 3 : 0) + (measureMode ? 3 : 0)} className="px-3 py-2 text-right text-sm font-bold text-gray-700">合计：</td>
                                                <td className="px-3 py-2 text-right text-sm font-bold text-blue-700">
                                                    {newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.debit) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-2 text-right text-sm font-bold text-green-700">
                                                    {newVoucher.entry_rows.reduce((sum, r) => sum + (parseFloat(r.credit) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                <button
                                    onClick={() => {
                                        setNewVoucher({
                                            ...newVoucher,
                                            entry_rows: [
                                                ...newVoucher.entry_rows,
                                                { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'debit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
                                                { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'credit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' }
                                            ]
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
                                            maker: newVoucher.maker,
                                            entry_rows: validRows.map(r => ({
                                                summary: r.summary,
                                                account_id: parseInt(r.account_id),
                                                debit: parseFloat(r.debit) || 0,
                                                credit: parseFloat(r.credit) || 0,
                                                ...(r.currency_id ? {
                                                    currency_id: parseInt(r.currency_id),
                                                    exchange_rate: parseFloat(r.exchange_rate) || 1,
                                                    orig_amount: parseFloat(r.orig_amount) || 0,
                                                } : {}),
                                                ...(r.partner_id ? { partner_id: parseInt(r.partner_id) } : {})
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
                                                        { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'debit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
                                                        { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'credit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
                                                        { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'debit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' },
                                                        { summary: '', account_id: '', debit: '', credit: '', unit: '克', quantity: '', price: '', direction: 'credit', currency_id: '', exchange_rate: '', orig_amount: '', partner_id: '' }
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

            {/* 批量记账 Modal */}
            {showBatchPostModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-96 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-green-50">
                            <h2 className="text-base font-semibold text-gray-800">批量记账</h2>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-gray-500 mb-4">选择要记账的年月，该月份所有未记账凭证将标记为已记账。</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5">年份</label>
                                    <select
                                        value={batchPostData.year}
                                        onChange={(e) => setBatchPostData({ ...batchPostData, year: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 outline-none"
                                    >
                                        {[...Array(5)].map((_, i) => {
                                            const y = new Date().getFullYear() - 2 + i;
                                            return <option key={y} value={y}>{y}年</option>;
                                        })}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1.5">月份</label>
                                    <select
                                        value={batchPostData.month}
                                        onChange={(e) => setBatchPostData({ ...batchPostData, month: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 outline-none"
                                    >
                                        {[...Array(12)].map((_, i) => (
                                            <option key={i + 1} value={i + 1}>{i + 1}月</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
                            <button
                                onClick={() => setShowBatchPostModal(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleBatchPost}
                                className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl hover:from-emerald-600 hover:to-green-600 shadow-sm transition-all"
                            >
                                确认记账
                            </button>
                        </div>
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

export default VoucherManagement;
