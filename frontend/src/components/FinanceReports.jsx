import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    BarChart3, FileSpreadsheet, Download, RefreshCw,
    ChevronDown, ChevronRight, TrendingUp, TrendingDown,
    CheckCircle, AlertTriangle, Printer, Calendar, Lock,
    ChevronLeft, Search, X, List
} from 'lucide-react';
import { fetchWithCacheJson } from '../utils/fetchCache';
import SearchableSelect from './SearchableSelect';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const FinanceReports = ({ initialYear, initialPeriod }) => {
    // 默认期间：如果没有传入，使用上个月（财务数据通常滞后当前月份）
    const getDefaultPeriod = () => {
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth(); // 上个月 (getMonth() is 0-based, so this gives last month's 1-based value)
        if (m === 0) { y--; m = 12; }
        return { year: y, period: m };
    };
    const defaultPeriod = getDefaultPeriod();

    const [activeReport, setActiveReport] = useState('account-balance'); // 'balance-sheet' | 'income-statement' | 'account-balance'
    const [year, setYear] = useState(initialYear || defaultPeriod.year);
    const [period, setPeriod] = useState(initialPeriod || defaultPeriod.period);
    const [loading, setLoading] = useState(false);
    const [balanceSheet, setBalanceSheet] = useState(null);
    const [incomeStatement, setIncomeStatement] = useState(null);
    const [accountBalance, setAccountBalance] = useState(null);
    const reportRef = useRef(null);

    // 科目余额表筛选
    const [abAccountFilter, setAbAccountFilter] = useState('');       // 实际过滤用的科目编码
    const [abAccountFilterId, setAbAccountFilterId] = useState('');   // SearchableSelect 选中值
    const [abTypeFilter, setAbTypeFilter] = useState('');             // 科目类型筛选: '' | '资产' | '负债' | ...
    const [abPartnerFilter, setAbPartnerFilter] = useState('');       // 实际过滤用的往来单位名称
    const [abPartnerFilterId, setAbPartnerFilterId] = useState('');   // SearchableSelect 选中值
    const [abSubledgerFilter, setAbSubledgerFilter] = useState('');   // 应收/应付快捷筛选: '' | 'receivable' | 'payable'
    const [abShowZero, setAbShowZero] = useState(false);              // 显示无发生额科目
    const [expandedAccounts, setExpandedAccounts] = useState(new Set()); // 展开的科目ID

    // 科目余额表分页
    const [abPage, setAbPage] = useState(1);
    const [abPageSize, setAbPageSize] = useState(50);

    // 切换报表时重置筛选和分页
    useEffect(() => {
        setAbAccountFilter('');
        setAbAccountFilterId('');
        setAbTypeFilter('');
        setAbPartnerFilter('');
        setAbPartnerFilterId('');
        setAbSubledgerFilter('');
        setAbPage(1);
        setExpandedAccounts(new Set());
    }, [activeReport]);

    // SearchableSelect 清空后延迟同步过滤条件（避免打字时频繁触发表格重渲染）
    useEffect(() => {
        if (!abAccountFilterId && abAccountFilter) {
            const t = setTimeout(() => setAbAccountFilter(''), 300);
            return () => clearTimeout(t);
        }
    }, [abAccountFilterId]);

    useEffect(() => {
        if (!abPartnerFilterId && abPartnerFilter) {
            const t = setTimeout(() => setAbPartnerFilter(''), 300);
            return () => clearTimeout(t);
        }
    }, [abPartnerFilterId]);

    // 筛选条件变化时重置到第一页
    useEffect(() => {
        setAbPage(1);
    }, [abAccountFilter, abTypeFilter, abPartnerFilter, abSubledgerFilter]);

    // 应收/应付模式切换时自动展开所有科目的往来明细
    useEffect(() => {
        if (abSubledgerFilter && accountBalance) {
            const ids = new Set(
                accountBalance.accounts
                    .filter(a => a.has_partner_detail)
                    .map(a => a.account_id)
            );
            setExpandedAccounts(ids);
        } else if (!abSubledgerFilter) {
            setExpandedAccounts(new Set());
        }
    }, [abSubledgerFilter, accountBalance]);

    // 历史期间
    const [browseYear, setBrowseYear] = useState(initialYear || defaultPeriod.year);
    const [closedPeriods, setClosedPeriods] = useState([]); // [{year, period, is_closed, closed_at}]
    const [closedPeriodsLoading, setClosedPeriodsLoading] = useState(false);

    useEffect(() => {
        loadReport();
    }, [activeReport, year, period]);

    useEffect(() => {
        loadClosedPeriods();
    }, []);

    const loadClosedPeriods = async () => {
        setClosedPeriodsLoading(true);
        try {
            const processData = (data) => {
                if (data.success) {
                    setClosedPeriods(data.data.filter(s => s.is_closed));
                }
            };
            const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/closing/status`, {}, processData);
            processData(data);
        } catch (e) {
            console.error('加载结账状态失败:', e);
        } finally {
            setClosedPeriodsLoading(false);
        }
    };

    const selectPeriod = (y, p) => {
        setYear(y);
        setPeriod(p);
    };

    // 获取浏览年份的所有月份状态
    const getMonthStatuses = () => {
        const statuses = [];
        for (let m = 1; m <= 12; m++) {
            const closed = closedPeriods.find(s => s.year === browseYear && s.period === m);
            statuses.push({
                month: m,
                isClosed: !!closed,
                closedAt: closed?.closed_at,
                isSelected: year === browseYear && period === m
            });
        }
        return statuses;
    };

    const loadReport = async () => {
        setLoading(true);
        try {
            if (activeReport === 'balance-sheet') {
                const processData = (data) => {
                    if (data.success) setBalanceSheet(data.data);
                    else alert(data.message || '加载资产负债表失败');
                };
                const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/reports/balance-sheet?year=${year}&period=${period}`, {}, processData);
                processData(data);
            } else if (activeReport === 'income-statement') {
                const processData = (data) => {
                    if (data.success) setIncomeStatement(data.data);
                    else alert(data.message || '加载损益表失败');
                };
                const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/reports/income-statement?year=${year}&period=${period}`, {}, processData);
                processData(data);
            } else if (activeReport === 'account-balance') {
                const processData = (data) => {
                    if (data.success) setAccountBalance(data.data);
                    else alert(data.message || '加载科目余额表失败');
                };
                const data = await fetchWithCacheJson(`${API_BASE_URL}/api/fbl-finance/reports/account-balance?year=${year}&period=${period}&show_zero=${abShowZero}`, {}, processData);
                processData(data);
            }
        } catch (e) {
            console.error('加载报表失败:', e);
        } finally {
            setLoading(false);
        }
    };

    const formatAmount = (val) => {
        if (val === null || val === undefined) return '-';
        const num = Number(val);
        if (num === 0) return '-';
        return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const handlePrint = () => {
        window.print();
    };

    const REPORT_NAMES = {
        'balance-sheet': '资产负债表',
        'income-statement': '利润表',
        'account-balance': '科目余额表',
    };

    const handleExportCSV = () => {
        let csvContent = '';
        if (activeReport === 'balance-sheet' && balanceSheet) {
            csvContent = '资产负债表\n';
            csvContent += `编制单位：梵贝琳  ${year}年${period}期  单位：元\n\n`;
            csvContent += '资产,期末余额,,负债及所有者权益,期末余额\n';
            const bs = balanceSheet;
            const maxLen = Math.max(bs.assets.length, bs.liabilities.length + bs.equity.length);
            const rightSide = [...bs.liabilities, { code: '', name: '【所有者权益】', balance: '' }, ...bs.equity];
            for (let i = 0; i < maxLen; i++) {
                const left = bs.assets[i];
                const right = rightSide[i];
                csvContent += `${left ? left.name : ''},${left ? left.balance : ''},,${right ? right.name : ''},${right ? right.balance : ''}\n`;
            }
            csvContent += `\n资产总计,${bs.total_assets},,负债及权益总计,${bs.total_liabilities_equity}\n`;
        } else if (activeReport === 'income-statement' && incomeStatement) {
            csvContent = '利润表\n';
            csvContent += `编制单位：梵贝琳  ${year}年${period}期  单位：元\n\n`;
            csvContent += '项目,本期金额,本年累计\n';
            csvContent += '【营业收入】,,\n';
            for (const item of incomeStatement.revenue_items) {
                csvContent += `${item.name},${item.current},${item.ytd}\n`;
            }
            csvContent += `营业收入合计,${incomeStatement.total_revenue_current},${incomeStatement.total_revenue_ytd}\n`;
            csvContent += '【营业成本及费用】,,\n';
            for (const item of incomeStatement.expense_items) {
                csvContent += `${item.name},${item.current},${item.ytd}\n`;
            }
            csvContent += `成本费用合计,${incomeStatement.total_expense_current},${incomeStatement.total_expense_ytd}\n`;
            csvContent += `\n净利润,${incomeStatement.profit_current},${incomeStatement.profit_ytd}\n`;
        } else if (activeReport === 'account-balance' && accountBalance) {
            csvContent = '科目余额表\n';
            csvContent += `编制单位：梵贝琳  ${year}年${period}期  单位：元\n\n`;
            csvContent += '科目编码,科目名称,科目类型,期初余额,方向,本期借方,本期贷方,本年累计借方,本年累计贷方,期末余额,方向\n';
            for (const acc of filteredAccountBalance) {
                csvContent += `${acc.account_code},${acc.account_name},${acc.account_type},`;
                csvContent += `${acc.opening_balance},${acc.opening_direction},`;
                csvContent += `${acc.current_dr},${acc.current_cr},`;
                csvContent += `${acc.ytd_dr},${acc.ytd_cr},`;
                csvContent += `${acc.closing_balance},${acc.closing_direction}\n`;
                // 如果有往来明细，展开导出
                if (acc.has_partner_detail && acc.partner_detail.length > 0) {
                    for (const p of acc.partner_detail) {
                        csvContent += `${acc.account_code},  └ ${p.partner_name},${p.partner_code},`;
                        csvContent += `${p.opening_balance},${p.opening_direction},`;
                        csvContent += `${p.current_dr},${p.current_cr},`;
                        csvContent += `${p.ytd_dr},${p.ytd_cr},`;
                        csvContent += `${p.closing_balance},${p.closing_direction}\n`;
                    }
                }
            }
            const gt = accountBalance.grand_total;
            csvContent += `,,【合计】,${gt.opening_balance},${gt.opening_direction},`;
            csvContent += `${gt.current_dr},${gt.current_cr},`;
            csvContent += `${gt.ytd_dr},${gt.ytd_cr},`;
            csvContent += `${gt.closing_balance},${gt.closing_direction}\n`;
        }

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${REPORT_NAMES[activeReport] || activeReport}_${year}年${period}期.csv`;
        link.click();
    };

    // ==================== 资产负债表 ====================
    const renderBalanceSheet = () => {
        if (!balanceSheet) return null;
        const bs = balanceSheet;

        // 如果没有任何资产或负债数据，显示提示
        if (bs.assets.length === 0 && bs.liabilities.length === 0 && bs.equity.length === 0) {
            return (
                <div className="text-center py-16">
                    <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 text-sm">该期间暂无资产负债数据</p>
                    <p className="text-gray-400 text-xs mt-1">{year}年{period}期没有已过账的资产、负债或权益凭证</p>
                </div>
            );
        }

        const rightSide = [
            ...bs.liabilities.map(i => ({ ...i, section: 'liability' })),
            ...bs.equity.map(i => ({ ...i, section: 'equity' }))
        ];
        const maxRows = Math.max(bs.assets.length, rightSide.length);

        return (
            <div ref={reportRef} className="print:p-8">
                {/* 表头 */}
                <div className="text-center mb-4 print:mb-6">
                    <h2 className="text-lg font-bold text-gray-900">资产负债表</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        编制单位：梵贝琳&emsp;&emsp;{year}年{period}期&emsp;&emsp;单位：元
                    </p>
                </div>

                {/* 平衡检查 */}
                <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 print:hidden ${bs.is_balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                    {bs.is_balanced
                        ? <><CheckCircle className="w-3.5 h-3.5 shrink-0" /> 资产 = 负债 + 所有者权益，报表平衡</>
                        : <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /><span className="break-words">资产({formatAmount(bs.total_assets)}) ≠ 负债+权益({formatAmount(bs.total_liabilities_equity)})，差额 {formatAmount(bs.total_assets - bs.total_liabilities_equity)}</span></>
                    }
                </div>

                <div className="border border-gray-200 rounded-lg overflow-x-auto print:border-black">
                    <table className="w-full text-sm min-w-[600px]">
                        <thead>
                            <tr className="bg-gray-50 print:bg-white">
                                <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[28%]">资产</th>
                                <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[22%]">期末余额</th>
                                <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[28%]">负债及所有者权益</th>
                                <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 w-[22%]">期末余额</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: maxRows }).map((_, idx) => {
                                const leftItem = bs.assets[idx];
                                const rightItem = rightSide[idx];
                                // 分节标题
                                const isFirstEquity = rightItem?.section === 'equity' && (idx === 0 || rightSide[idx - 1]?.section !== 'equity');

                                return (
                                    <React.Fragment key={idx}>
                                        {isFirstEquity && (
                                            <tr className="bg-amber-50/50">
                                                <td className="border-b border-r border-gray-200" />
                                                <td className="border-b border-r border-gray-200" />
                                                <td colSpan={2} className="px-2 py-1 text-xs font-bold text-amber-700 border-b border-gray-200">
                                                    所有者权益
                                                </td>
                                            </tr>
                                        )}
                                        <tr className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-2 py-1.5 border-b border-r border-gray-100 text-gray-800 text-xs">
                                                {leftItem && (
                                                    <span className="flex items-center gap-1">
                                                        <span className="text-[10px] text-gray-400 font-mono w-9 shrink-0">{leftItem.code}</span>
                                                        <span className="truncate">{leftItem.name}</span>
                                                    </span>
                                                )}
                                            </td>
                                            <td className={`px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs whitespace-nowrap ${leftItem?.balance < 0 ? 'text-red-600' : 'text-gray-800'
                                                }`}>
                                                {leftItem ? formatAmount(leftItem.balance) : ''}
                                            </td>
                                            <td className="px-2 py-1.5 border-b border-r border-gray-100 text-gray-800 text-xs">
                                                {rightItem && (
                                                    <span className="flex items-center gap-1">
                                                        <span className="text-[10px] text-gray-400 font-mono w-9 shrink-0">{rightItem.code}</span>
                                                        <span className="truncate">{rightItem.name}</span>
                                                    </span>
                                                )}
                                            </td>
                                            <td className={`px-2 py-1.5 border-b border-gray-100 text-right font-mono text-xs whitespace-nowrap ${rightItem?.balance < 0 ? 'text-red-600' : 'text-gray-800'
                                                }`}>
                                                {rightItem ? formatAmount(rightItem.balance) : ''}
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                            {/* 负债小计 */}
                            <tr className="bg-gray-50/80 font-semibold">
                                <td className="px-2 py-2 border-b border-r border-gray-200" />
                                <td className="px-2 py-2 border-b border-r border-gray-200" />
                                <td className="px-2 py-2 border-b border-r border-gray-200 text-gray-700 text-xs">负债合计</td>
                                <td className="px-2 py-2 border-b border-gray-200 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                    {formatAmount(bs.total_liabilities)}
                                </td>
                            </tr>
                            <tr className="bg-gray-50/80 font-semibold">
                                <td className="px-2 py-2 border-b border-r border-gray-200" />
                                <td className="px-2 py-2 border-b border-r border-gray-200" />
                                <td className="px-2 py-2 border-b border-r border-gray-200 text-gray-700 text-xs">所有者权益合计</td>
                                <td className="px-2 py-2 border-b border-gray-200 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                    {formatAmount(bs.total_equity)}
                                </td>
                            </tr>
                            {/* 合计行 */}
                            <tr className="bg-amber-50 font-bold">
                                <td className="px-2 py-2.5 border-r border-gray-200 text-gray-900 text-xs">资产总计</td>
                                <td className="px-2 py-2.5 border-r border-gray-200 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                    {formatAmount(bs.total_assets)}
                                </td>
                                <td className="px-2 py-2.5 border-r border-gray-200 text-gray-900 text-xs">负债及所有者权益总计</td>
                                <td className="px-2 py-2.5 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                    {formatAmount(bs.total_liabilities_equity)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // ==================== 利润表 ====================
    const renderIncomeStatement = () => {
        if (!incomeStatement) return null;
        const is = incomeStatement;

        // 如果没有任何收入或费用数据，显示提示
        if (is.revenue_items.length === 0 && is.expense_items.length === 0) {
            return (
                <div className="text-center py-16">
                    <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 text-sm">该期间暂无损益数据</p>
                    <p className="text-gray-400 text-xs mt-1">{year}年{period}期没有已过账的收入或费用凭证</p>
                </div>
            );
        }

        const SectionRow = ({ label, className = '' }) => (
            <tr className={`bg-gray-50/60 ${className}`}>
                <td colSpan={3} className="px-2 py-1.5 text-xs font-bold text-gray-600 border-b border-gray-200">
                    {label}
                </td>
            </tr>
        );

        const ItemRow = ({ item }) => (
            <tr className="hover:bg-blue-50/30 transition-colors">
                <td className="px-2 py-1.5 border-b border-r border-gray-100 text-gray-800 text-xs">
                    <span className="flex items-center gap-1">
                        <span className="text-[10px] text-gray-400 font-mono w-9 shrink-0">{item.code}</span>
                        <span className="truncate">{item.name}</span>
                    </span>
                </td>
                <td className={`px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs whitespace-nowrap ${item.current < 0 ? 'text-red-600' : 'text-gray-800'
                    }`}>
                    {formatAmount(item.current)}
                </td>
                <td className={`px-2 py-1.5 border-b border-gray-100 text-right font-mono text-xs whitespace-nowrap ${item.ytd < 0 ? 'text-red-600' : 'text-gray-800'
                    }`}>
                    {formatAmount(item.ytd)}
                </td>
            </tr>
        );

        const TotalRow = ({ label, current, ytd, highlight = false }) => (
            <tr className={highlight ? 'bg-amber-50 font-bold' : 'bg-gray-50/80 font-semibold'}>
                <td className={`px-2 ${highlight ? 'py-2.5' : 'py-2'} border-b border-r border-gray-200 text-xs ${highlight ? 'text-gray-900' : 'text-gray-700'}`}>
                    {label}
                </td>
                <td className={`px-2 ${highlight ? 'py-2.5' : 'py-2'} border-b border-r border-gray-200 text-right font-mono text-xs whitespace-nowrap ${highlight ? 'text-gray-900' : 'text-gray-800'}`}>
                    {formatAmount(current)}
                </td>
                <td className={`px-2 ${highlight ? 'py-2.5' : 'py-2'} border-b border-gray-200 text-right font-mono text-xs whitespace-nowrap ${highlight ? 'text-gray-900' : 'text-gray-800'}`}>
                    {formatAmount(ytd)}
                </td>
            </tr>
        );

        return (
            <div ref={reportRef} className="print:p-8">
                {/* 表头 */}
                <div className="text-center mb-4 print:mb-6">
                    <h2 className="text-lg font-bold text-gray-900">利润表</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        编制单位：梵贝琳&emsp;&emsp;{year}年{period}期&emsp;&emsp;单位：元
                    </p>
                </div>

                {/* 利润概要 */}
                <div className="mb-3 grid grid-cols-2 sm:grid-cols-3 gap-2 print:hidden">
                    <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="text-[10px] text-emerald-600 mb-0.5">本期营业收入</div>
                        <div className="text-sm font-bold text-emerald-700 truncate">{formatAmount(is.total_revenue_current)}</div>
                    </div>
                    <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-[10px] text-blue-600 mb-0.5">本期成本费用</div>
                        <div className="text-sm font-bold text-blue-700 truncate">{formatAmount(is.total_expense_current)}</div>
                    </div>
                    <div className={`px-3 py-2 border rounded-lg ${is.profit_current >= 0
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-red-50 border-red-200'
                        }`}>
                        <div className={`text-[10px] mb-0.5 ${is.profit_current >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                            本期净利润
                        </div>
                        <div className={`text-sm font-bold flex items-center gap-1 ${is.profit_current >= 0 ? 'text-amber-700' : 'text-red-700'
                            }`}>
                            {is.profit_current >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                            <span className="truncate">{formatAmount(is.profit_current)}</span>
                        </div>
                    </div>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-x-auto print:border-black">
                    <table className="w-full text-sm min-w-[480px]">
                        <thead>
                            <tr className="bg-gray-50 print:bg-white">
                                <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[50%]">项目</th>
                                <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[25%]">本期金额</th>
                                <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 w-[25%]">本年累计</th>
                            </tr>
                        </thead>
                        <tbody>
                            <SectionRow label="一、营业收入" />
                            {is.revenue_items.map(item => <ItemRow key={item.code} item={item} />)}
                            <TotalRow label="营业收入合计" current={is.total_revenue_current} ytd={is.total_revenue_ytd} />

                            <SectionRow label="二、营业成本及费用" />
                            {is.expense_items.map(item => <ItemRow key={item.code} item={item} />)}
                            <TotalRow label="营业成本及费用合计" current={is.total_expense_current} ytd={is.total_expense_ytd} />

                            <TotalRow label={'三、营业利润（亏损以\u201C-\u201D号填列）'}
                                current={is.profit_current} ytd={is.profit_ytd} highlight />
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // ==================== 科目余额表 ====================

    // 科目类型选项
    const ACCOUNT_TYPES = ['资产', '负债', '共同', '权益', '损益'];

    // 筛选后的科目列表
    const filteredAccountBalance = useMemo(() => {
        if (!accountBalance || !accountBalance.accounts) return [];
        let list = accountBalance.accounts;

        // 应收/应付快捷筛选：只保留有往来辅助核算且属于对应类型的科目
        if (abSubledgerFilter === 'receivable') {
            // 应收：资产类(6) + 共同类(8)，且有往来明细
            list = list.filter(a => a.has_partner_detail && (a.account_type_id === 6 || a.account_type_id === 8));
        } else if (abSubledgerFilter === 'payable') {
            // 应付：负债类(7) + 共同类(8)，且有往来明细
            list = list.filter(a => a.has_partner_detail && (a.account_type_id === 7 || a.account_type_id === 8));
        }

        // 按科目类型筛选
        if (abTypeFilter) {
            list = list.filter(a => a.account_type === abTypeFilter);
        }

        // 按科目编码/名称搜索
        if (abAccountFilter.trim()) {
            const kw = abAccountFilter.trim();
            list = list.filter(a => a.account_code === kw || a.account_name.includes(kw) || a.account_code.startsWith(kw));
        }

        // 按往来单位筛选（只显示有该往来单位的科目）
        if (abPartnerFilter.trim()) {
            list = list.filter(a =>
                a.has_partner_detail && a.partner_detail.some(p => p.partner_name === abPartnerFilter)
            );
        }

        return list;
    }, [accountBalance, abTypeFilter, abAccountFilter, abPartnerFilter, abSubledgerFilter]);

    // 构建下拉选项
    const abAccountOptions = useMemo(() => {
        if (!accountBalance) return [];
        return accountBalance.accounts.map(a => ({
            id: a.account_code,
            code: a.account_code,
            name: a.account_name,
        }));
    }, [accountBalance]);

    const abPartnerOptions = useMemo(() => {
        if (!accountBalance) return [];
        const pMap = new Map();
        for (const acc of accountBalance.accounts) {
            if (acc.has_partner_detail) {
                for (const p of acc.partner_detail) {
                    if (p.partner_name && p.partner_name !== '（无往来单位）' && !pMap.has(p.partner_name)) {
                        pMap.set(p.partner_name, p.partner_code || '');
                    }
                }
            }
        }
        return Array.from(pMap.entries()).map(([name, code]) => ({
            id: name,
            code: code,
            name: name,
        }));
    }, [accountBalance]);

    // 展开/折叠
    const toggleAccountExpand = (accountId) => {
        setExpandedAccounts(prev => {
            const next = new Set(prev);
            if (next.has(accountId)) next.delete(accountId);
            else next.add(accountId);
            return next;
        });
    };

    const DirectionBadge = ({ direction, amount }) => {
        if (amount === 0) return <span className="text-gray-400">-</span>;
        return (
            <span className={`inline-flex items-center gap-0.5 ${direction === '借' ? 'text-blue-600' : 'text-orange-600'
                }`}>
                <span className="text-[10px] opacity-70">{direction}</span>
                <span>{formatAmount(amount)}</span>
            </span>
        );
    };

    const renderAccountBalance = () => {
        if (!accountBalance) return null;

        if (!accountBalance.accounts || accountBalance.accounts.length === 0) {
            return (
                <div className="text-center py-16">
                    <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 text-sm">该期间暂无科目余额数据</p>
                    <p className="text-gray-400 text-xs mt-1">{year}年{period}期没有已过账的凭证</p>
                </div>
            );
        }

        const isFiltered = abAccountFilter || abTypeFilter || abPartnerFilter || abSubledgerFilter;
        const data = filteredAccountBalance;
        const isSubledgerMode = !!abSubledgerFilter;

        // 在应收/应付模式下，按展开的行数分页（科目行 + 往来明细行）
        // 在普通模式下，按科目数量分页
        let totalRows, totalPages, safePage, startIdx, endIdx, pageData;

        if (isSubledgerMode) {
            // 展平为行级列表：每个科目 = 1行科目 + N行明细
            const flatRows = [];
            for (const acc of data) {
                let details = acc.partner_detail || [];
                if (abPartnerFilter) {
                    details = details.filter(p => p.partner_name === abPartnerFilter);
                }
                flatRows.push({ type: 'account', acc, details });
                for (const p of details) {
                    flatRows.push({ type: 'partner', acc, partner: p });
                }
            }
            totalRows = flatRows.length;
            totalPages = Math.max(1, Math.ceil(totalRows / abPageSize));
            safePage = Math.min(abPage, totalPages);
            startIdx = (safePage - 1) * abPageSize;
            endIdx = Math.min(startIdx + abPageSize, totalRows);
            // pageData 在 subledger 模式下存放展平的行
            pageData = flatRows.slice(startIdx, endIdx);
        } else {
            totalRows = data.length;
            totalPages = Math.max(1, Math.ceil(totalRows / abPageSize));
            safePage = Math.min(abPage, totalPages);
            startIdx = (safePage - 1) * abPageSize;
            endIdx = Math.min(startIdx + abPageSize, totalRows);
            pageData = data.slice(startIdx, endIdx);
        }

        // 页码按钮
        const renderPageButtons = () => {
            const pages = [];
            const maxVisible = 7;
            let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
            let end = Math.min(totalPages, start + maxVisible - 1);
            if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
            if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
            for (let i = start; i <= end; i++) pages.push(i);
            if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }
            return pages;
        };

        // 计算筛选后的汇总
        let filteredTotal = accountBalance.grand_total;
        if (isFiltered) {
            const t = { opening_dr: 0, opening_cr: 0, current_dr: 0, current_cr: 0, ytd_dr: 0, ytd_cr: 0 };
            for (const a of data) {
                if (a.opening_direction === '借') t.opening_dr += a.opening_balance;
                else t.opening_cr += a.opening_balance;
                t.current_dr += a.current_dr;
                t.current_cr += a.current_cr;
                t.ytd_dr += a.ytd_dr;
                t.ytd_cr += a.ytd_cr;
            }
            const gt_opening = t.opening_dr - t.opening_cr;
            const gt_closing = gt_opening + t.current_dr - t.current_cr;
            filteredTotal = {
                ...t,
                opening_balance: Math.round(Math.abs(gt_opening) * 100) / 100,
                opening_direction: gt_opening >= 0 ? '借' : '贷',
                closing_balance: Math.round(Math.abs(gt_closing) * 100) / 100,
                closing_direction: gt_closing >= 0 ? '借' : '贷',
                current_dr: Math.round(t.current_dr * 100) / 100,
                current_cr: Math.round(t.current_cr * 100) / 100,
                ytd_dr: Math.round(t.ytd_dr * 100) / 100,
                ytd_cr: Math.round(t.ytd_cr * 100) / 100,
            };
        }

        return (
            <div ref={reportRef} className="print:p-8">
                {/* 表头 */}
                <div className="text-center mb-4 print:mb-6">
                    <h2 className="text-lg font-bold text-gray-900">
                        {abSubledgerFilter === 'receivable' ? '应收科目余额表' : abSubledgerFilter === 'payable' ? '应付科目余额表' : '科目余额表'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        编制单位：梵贝琳&emsp;&emsp;{year}年{period}期&emsp;&emsp;单位：元
                    </p>
                </div>

                {/* 筛选栏 */}
                <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
                    {/* 应收/应付快捷切换 */}
                    <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
                        <button
                            onClick={() => { setAbSubledgerFilter(''); setAbTypeFilter(''); }}
                            className={`px-2.5 py-1 text-xs font-medium transition-colors ${!abSubledgerFilter ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                        >
                            全部科目
                        </button>
                        <button
                            onClick={() => { setAbSubledgerFilter(abSubledgerFilter === 'receivable' ? '' : 'receivable'); setAbTypeFilter(''); }}
                            className={`px-2.5 py-1 text-xs font-medium border-l border-gray-200 transition-colors ${abSubledgerFilter === 'receivable' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                        >
                            应收
                        </button>
                        <button
                            onClick={() => { setAbSubledgerFilter(abSubledgerFilter === 'payable' ? '' : 'payable'); setAbTypeFilter(''); }}
                            className={`px-2.5 py-1 text-xs font-medium border-l border-gray-200 transition-colors ${abSubledgerFilter === 'payable' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                        >
                            应付
                        </button>
                    </div>
                    <SearchableSelect
                        options={abAccountOptions}
                        value={abAccountFilterId}
                        onChange={(id) => {
                            setAbAccountFilterId(id);
                            if (id) setAbAccountFilter(id);
                        }}
                        placeholder="搜索科目..."
                        className="flex-1 min-w-[200px] max-w-[280px]"
                    />
                    {/* 科目类型快速筛选（全部科目模式下显示） */}
                    {!abSubledgerFilter && (
                        <div className="flex items-center gap-1">
                            {ACCOUNT_TYPES.map(t => (
                                <button
                                    key={t}
                                    onClick={() => setAbTypeFilter(abTypeFilter === t ? '' : t)}
                                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${abTypeFilter === t
                                        ? 'bg-blue-500 text-white border-blue-500'
                                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}
                    <SearchableSelect
                        options={abPartnerOptions}
                        value={abPartnerFilterId}
                        onChange={(id) => {
                            setAbPartnerFilterId(id);
                            if (id) setAbPartnerFilter(id);
                        }}
                        placeholder="搜索往来单位..."
                        className="flex-1 min-w-[180px] max-w-[240px]"
                    />
                    {isFiltered && (
                        <button
                            onClick={() => { setAbAccountFilter(''); setAbAccountFilterId(''); setAbTypeFilter(''); setAbPartnerFilter(''); setAbPartnerFilterId(''); setAbSubledgerFilter(''); }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                        >
                            <X className="w-3 h-3" /> 清除
                        </button>
                    )}
                    <span className="text-[11px] text-gray-400 ml-auto">
                        {isFiltered ? `筛选 ${data.length} / ${accountBalance.accounts.length} 个科目` : `共 ${data.length} 个科目`}
                        {accountBalance.accounts_with_detail > 0 && ` · ${accountBalance.accounts_with_detail} 个有往来明细`}
                    </span>
                </div>

                {/* 概要统计 */}
                <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 print:hidden">
                    <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-[10px] text-blue-600 mb-0.5">期初余额</div>
                        <div className="text-sm font-bold text-blue-700 truncate">
                            {filteredTotal.opening_direction} {formatAmount(filteredTotal.opening_balance)}
                        </div>
                    </div>
                    <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="text-[10px] text-emerald-600 mb-0.5">本期借方</div>
                        <div className="text-sm font-bold text-emerald-700 truncate">{formatAmount(filteredTotal.current_dr)}</div>
                    </div>
                    <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="text-[10px] text-amber-600 mb-0.5">本期贷方</div>
                        <div className="text-sm font-bold text-amber-700 truncate">{formatAmount(filteredTotal.current_cr)}</div>
                    </div>
                    <div className="px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="text-[10px] text-purple-600 mb-0.5">期末余额</div>
                        <div className="text-sm font-bold text-purple-700 truncate">
                            {filteredTotal.closing_direction} {formatAmount(filteredTotal.closing_balance)}
                        </div>
                    </div>
                </div>

                {/* 表格 */}
                {data.length === 0 && isFiltered ? (
                    <div className="text-center py-12">
                        <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500 text-sm">没有匹配的科目</p>
                        <button
                            onClick={() => { setAbAccountFilter(''); setAbAccountFilterId(''); setAbTypeFilter(''); setAbPartnerFilter(''); setAbPartnerFilterId(''); setAbSubledgerFilter(''); }}
                            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
                        >
                            <X className="w-3 h-3" /> 清除筛选
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="border border-gray-200 rounded-lg overflow-x-auto print:border-black">
                            <table className="w-full text-sm min-w-[900px]">
                                <thead>
                                    <tr className="bg-gray-50 print:bg-white">
                                        <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[3%]"></th>
                                        <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[10%]">科目编码</th>
                                        <th className="px-2 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 w-[14%]">科目名称</th>
                                        <th className="px-2 py-2 text-center font-semibold text-gray-700 border-b border-r border-gray-200 w-[5%]">类型</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[12%]">期初余额</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[11%]">本期借方</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[11%]">本期贷方</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[11%]">累计借方</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-r border-gray-200 w-[11%]">累计贷方</th>
                                        <th className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 w-[12%]">期末余额</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isSubledgerMode ? (
                                        /* 应收/应付模式：按展平行渲染 */
                                        pageData.map((row, rowIdx) => {
                                            if (row.type === 'account') {
                                                const acc = row.acc;
                                                const hasDetail = acc.has_partner_detail && acc.partner_detail.length > 0;
                                                const typeColors = { '资产': 'text-blue-600 bg-blue-50', '负债': 'text-red-600 bg-red-50', '权益': 'text-purple-600 bg-purple-50', '损益': 'text-amber-600 bg-amber-50', '共同': 'text-gray-600 bg-gray-100' };
                                                const typeClass = typeColors[acc.account_type] || 'text-gray-500 bg-gray-50';
                                                return (
                                                    <tr key={`a-${acc.account_id}-${rowIdx}`} className="hover:bg-blue-50/30 transition-colors bg-white">
                                                        <td className="px-1 py-1.5 border-b border-r border-gray-100 text-center">
                                                            {hasDetail && <ChevronDown className="w-3.5 h-3.5 text-blue-500 inline" />}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-xs font-mono text-gray-600">
                                                            {acc.account_code}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-xs text-gray-800 font-medium">
                                                            {acc.account_name}
                                                            {hasDetail && (
                                                                <span className="ml-1.5 text-[10px] text-blue-400 font-normal">
                                                                    ({row.details.length}个往来)
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-1 py-1.5 border-b border-r border-gray-100 text-center">
                                                            <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${typeClass}`}>
                                                                {acc.account_type || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={acc.opening_direction} amount={acc.opening_balance} />
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                                            {formatAmount(acc.current_dr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                                            {formatAmount(acc.current_cr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(acc.ytd_dr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(acc.ytd_cr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={acc.closing_direction} amount={acc.closing_balance} />
                                                        </td>
                                                    </tr>
                                                );
                                            } else {
                                                const { acc, partner: p } = row;
                                                return (
                                                    <tr key={`p-${acc.account_id}-${p.partner_id}-${rowIdx}`} className="bg-blue-50/20 hover:bg-blue-50/40 transition-colors">
                                                        <td className="border-b border-r border-gray-100"></td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-xs text-gray-400 pl-5">└</td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-xs text-gray-600">
                                                            {p.partner_name}
                                                            {p.partner_code && <span className="ml-1 text-[10px] text-gray-400">{p.partner_code}</span>}
                                                        </td>
                                                        <td className="border-b border-r border-gray-100"></td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={p.opening_direction} amount={p.opening_balance} />
                                                        </td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                                                            {formatAmount(p.current_dr)}
                                                        </td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                                                            {formatAmount(p.current_cr)}
                                                        </td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(p.ytd_dr)}
                                                        </td>
                                                        <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(p.ytd_cr)}
                                                        </td>
                                                        <td className="px-2 py-1 border-b border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={p.closing_direction} amount={p.closing_balance} />
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                        })
                                    ) : (
                                        /* 普通模式：按科目渲染，可手动展开 */
                                        pageData.map((acc) => {
                                            const isExpanded = expandedAccounts.has(acc.account_id);
                                            const hasDetail = acc.has_partner_detail && acc.partner_detail.length > 0;
                                            const typeColors = { '资产': 'text-blue-600 bg-blue-50', '负债': 'text-red-600 bg-red-50', '权益': 'text-purple-600 bg-purple-50', '损益': 'text-amber-600 bg-amber-50', '共同': 'text-gray-600 bg-gray-100' };
                                            const typeClass = typeColors[acc.account_type] || 'text-gray-500 bg-gray-50';

                                            let details = acc.partner_detail || [];
                                            if (abPartnerFilter && isExpanded) {
                                                details = details.filter(p => p.partner_name === abPartnerFilter);
                                            }

                                            return (
                                                <React.Fragment key={acc.account_id}>
                                                    <tr className={`hover:bg-blue-50/30 transition-colors ${hasDetail ? 'cursor-pointer' : ''}`}
                                                        onClick={() => hasDetail && toggleAccountExpand(acc.account_id)}
                                                    >
                                                        <td className="px-1 py-1.5 border-b border-r border-gray-100 text-center">
                                                            {hasDetail ? (
                                                                isExpanded
                                                                    ? <ChevronDown className="w-3.5 h-3.5 text-blue-500 inline" />
                                                                    : <ChevronRight className="w-3.5 h-3.5 text-gray-400 inline" />
                                                            ) : null}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-xs font-mono text-gray-600">
                                                            {acc.account_code}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-xs text-gray-800 font-medium">
                                                            {acc.account_name}
                                                            {hasDetail && (
                                                                <span className="ml-1.5 text-[10px] text-blue-400 font-normal">
                                                                    ({acc.partner_detail.length}个往来)
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-1 py-1.5 border-b border-r border-gray-100 text-center">
                                                            <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${typeClass}`}>
                                                                {acc.account_type || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={acc.opening_direction} amount={acc.opening_balance} />
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                                            {formatAmount(acc.current_dr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-800 whitespace-nowrap">
                                                            {formatAmount(acc.current_cr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(acc.ytd_dr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                            {formatAmount(acc.ytd_cr)}
                                                        </td>
                                                        <td className="px-2 py-1.5 border-b border-gray-100 text-right text-xs whitespace-nowrap">
                                                            <DirectionBadge direction={acc.closing_direction} amount={acc.closing_balance} />
                                                        </td>
                                                    </tr>
                                                    {isExpanded && details.map((p, pIdx) => (
                                                        <tr key={`${acc.account_id}-p-${pIdx}`} className="bg-blue-50/20 hover:bg-blue-50/40 transition-colors">
                                                            <td className="border-b border-r border-gray-100"></td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-xs text-gray-400 pl-5">└</td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-xs text-gray-600">
                                                                {p.partner_name}
                                                                {p.partner_code && <span className="ml-1 text-[10px] text-gray-400">{p.partner_code}</span>}
                                                            </td>
                                                            <td className="border-b border-r border-gray-100"></td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-right text-xs whitespace-nowrap">
                                                                <DirectionBadge direction={p.opening_direction} amount={p.opening_balance} />
                                                            </td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                                                                {formatAmount(p.current_dr)}
                                                            </td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                                                                {formatAmount(p.current_cr)}
                                                            </td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                                {formatAmount(p.ytd_dr)}
                                                            </td>
                                                            <td className="px-2 py-1 border-b border-r border-gray-100 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
                                                                {formatAmount(p.ytd_cr)}
                                                            </td>
                                                            <td className="px-2 py-1 border-b border-gray-100 text-right text-xs whitespace-nowrap">
                                                                <DirectionBadge direction={p.closing_direction} amount={p.closing_balance} />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                    {/* 合计行 */}
                                    <tr className="bg-amber-50 font-bold">
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200"></td>
                                        <td colSpan={3} className="px-2 py-2.5 border-t border-r border-gray-200 text-xs text-gray-900">
                                            {isFiltered ? '筛选合计' : '合计'}
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200 text-right text-xs whitespace-nowrap">
                                            <DirectionBadge direction={filteredTotal.opening_direction} amount={filteredTotal.opening_balance} />
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                            {formatAmount(filteredTotal.current_dr)}
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                            {formatAmount(filteredTotal.current_cr)}
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                            {formatAmount(filteredTotal.ytd_dr)}
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-r border-gray-200 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                                            {formatAmount(filteredTotal.ytd_cr)}
                                        </td>
                                        <td className="px-2 py-2.5 border-t border-gray-200 text-right text-xs whitespace-nowrap">
                                            <DirectionBadge direction={filteredTotal.closing_direction} amount={filteredTotal.closing_balance} />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* 分页 */}
                        {totalPages > 1 && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span>共 {totalRows} {isSubledgerMode ? '行' : '个科目'}</span>
                                    <span className="text-gray-300">|</span>
                                    <span>每页</span>
                                    <select
                                        value={abPageSize}
                                        onChange={(e) => { setAbPageSize(Number(e.target.value)); setAbPage(1); }}
                                        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    >
                                        {[20, 50, 100, 200].map(n => (
                                            <option key={n} value={n}>{n}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setAbPage(p => Math.max(1, p - 1))}
                                        disabled={safePage <= 1}
                                        className="px-2 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </button>
                                    {renderPageButtons().map((p, i) =>
                                        p === '...' ? (
                                            <span key={`e-${i}`} className="px-1 text-xs text-gray-400">...</span>
                                        ) : (
                                            <button
                                                key={p}
                                                onClick={() => setAbPage(p)}
                                                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${p === safePage ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                {p}
                                            </button>
                                        )
                                    )}
                                    <button
                                        onClick={() => setAbPage(p => Math.min(totalPages, p + 1))}
                                        disabled={safePage >= totalPages}
                                        className="px-2 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="h-full bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50">
            <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6">
                {/* 页面头部 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl shadow-lg shadow-blue-200/50">
                            <BarChart3 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">财务报表</h1>
                            <p className="text-xs text-gray-500">Financial Statements</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 px-2.5 py-1.5 shadow-sm">
                            <span className="text-xs font-medium text-gray-500">期间</span>
                            <input
                                type="number"
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value))}
                                className="w-16 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                            />
                            <span className="text-xs text-gray-400">年</span>
                            <input
                                type="number"
                                value={period}
                                onChange={(e) => setPeriod(parseInt(e.target.value))}
                                min="1" max="12"
                                className="w-12 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                            />
                            <span className="text-xs text-gray-400">期</span>
                        </div>
                        <button
                            onClick={loadReport}
                            disabled={loading}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200 transition-colors"
                            title="刷新"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={handleExportCSV}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
                        >
                            <Download className="w-3 h-3" />
                            导出
                        </button>
                        <button
                            onClick={handlePrint}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
                        >
                            <Printer className="w-3 h-3" />
                            打印
                        </button>
                    </div>
                </div>

                {/* 报表选择 */}
                <div className="flex flex-wrap gap-2 mb-5">
                    <button
                        onClick={() => setActiveReport('account-balance')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${activeReport === 'account-balance'
                            ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                            }`}
                    >
                        <List className={`w-4 h-4 ${activeReport === 'account-balance' ? 'text-blue-500' : 'text-gray-400'}`} />
                        科目余额表
                    </button>
                    <button
                        onClick={() => setActiveReport('balance-sheet')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${activeReport === 'balance-sheet'
                            ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                            }`}
                    >
                        <FileSpreadsheet className={`w-4 h-4 ${activeReport === 'balance-sheet' ? 'text-blue-500' : 'text-gray-400'}`} />
                        资产负债表
                    </button>
                    <button
                        onClick={() => setActiveReport('income-statement')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${activeReport === 'income-statement'
                            ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                            }`}
                    >
                        <TrendingUp className={`w-4 h-4 ${activeReport === 'income-statement' ? 'text-blue-500' : 'text-gray-400'}`} />
                        利润表
                    </button>
                </div>

                {/* 期间选择器 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 p-3 mb-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-medium text-gray-700">选择会计期间</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setBrowseYear(y => y - 1)}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-semibold text-gray-700 w-16 text-center">{browseYear}年</span>
                            <button
                                onClick={() => setBrowseYear(y => y + 1)}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-1.5">
                        {getMonthStatuses().map(s => (
                            <button
                                key={s.month}
                                onClick={() => selectPeriod(browseYear, s.month)}
                                className={`relative flex flex-col items-center py-2 px-1 rounded-lg text-xs font-medium transition-all ${s.isSelected
                                    ? 'bg-blue-500 text-white shadow-sm'
                                    : s.isClosed
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                        : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100'
                                    }`}
                            >
                                <span className="text-[13px]">{s.month}月</span>
                                {s.isClosed && !s.isSelected && (
                                    <Lock className="w-2.5 h-2.5 mt-0.5 opacity-60" />
                                )}
                                {s.isSelected && (
                                    <div className="w-1 h-1 rounded-full bg-white mt-0.5" />
                                )}
                            </button>
                        ))}
                    </div>
                    {closedPeriods.length > 0 && (
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-200 inline-block" /> 已结账</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-gray-200 inline-block" /> 未结账</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-500 inline-block" /> 当前查看</span>
                        </div>
                    )}
                </div>

                {/* 报表内容 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 p-3 sm:p-5">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-6 h-6 border-2 border-blue-300 border-t-transparent rounded-full animate-spin mb-2" />
                            <span className="text-sm text-gray-400">正在生成报表...</span>
                        </div>
                    ) : (
                        <>
                            {activeReport === 'account-balance' && renderAccountBalance()}
                            {activeReport === 'balance-sheet' && renderBalanceSheet()}
                            {activeReport === 'income-statement' && renderIncomeStatement()}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FinanceReports;
