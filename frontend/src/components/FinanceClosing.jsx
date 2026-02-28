import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import {
    CheckCircle, AlertTriangle, ArrowRight, ArrowLeft, RefreshCw,
    FileText, TrendingUp, Repeat, PenTool, Lock, ChevronRight, Info,
    Unlock, Calendar, ClipboardList
} from 'lucide-react';
import ConfirmationDialog from './ui/ConfirmationDialog';

const FinanceClosing = ({ onNavigate }) => {
    // State
    const [currentStep, setCurrentStep] = useState(1);
    const [year, setYear] = useState(new Date().getFullYear());
    const [period, setPeriod] = useState(new Date().getMonth() + 1);
    const [loading, setLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState({isOpen: false, title: '', message: '', onConfirm: () => {}, isDestructive: false});

    // Step 1: Check
    const [checkResult, setCheckResult] = useState(null);

    // Step 2: Transfer
    const [transferResult, setTransferResult] = useState(null);
    const [profitLossVoucherId, setProfitLossVoucherId] = useState(null);
    // 各结转操作的独立状态
    const [salesCostResult, setSalesCostResult] = useState(null);
    const [exchangeResult, setExchangeResult] = useState(null);

    // 外币汇率相关
    const [currencies, setCurrencies] = useState([]);
    const [periodEndRates, setPeriodEndRates] = useState({});  // { currencyId: rate }
    const [showRateEditor, setShowRateEditor] = useState(false);

    // Step 3: Close
    const [closeResult, setCloseResult] = useState(null);

    // 结账管理
    const [showClosingMgmt, setShowClosingMgmt] = useState(false);
    const [closingStatuses, setClosingStatuses] = useState([]);
    const [closingStatusLoading, setClosingStatusLoading] = useState(false);
    const [reopenLoading, setReopenLoading] = useState(null); // 正在反结账的 "year-period"

    useEffect(() => {
        console.log('FinanceClosing Mounted');
        // 加载币种列表
        loadCurrencies();
    }, []);

    const loadCurrencies = async () => {
        try {
            const res = await axios.get(`${API_BASE_URL}/api/fbl-finance/currencies`);
            if (res.data.success && Array.isArray(res.data.data)) {
                const foreignCurrencies = res.data.data.filter(c => !c.is_native);
                setCurrencies(foreignCurrencies);
                // 用最近的汇率作为默认值
                const defaultRates = {};
                foreignCurrencies.forEach(c => {
                    if (c.latest_rate) {
                        defaultRates[c.id] = c.latest_rate;
                    }
                });
                setPeriodEndRates(defaultRates);
            }
        } catch (e) {
            console.error('加载币种失败:', e);
        }
    };

    // 结账管理方法
    const loadClosingStatuses = async () => {
        setClosingStatusLoading(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/fbl-finance/closing/status`);
            if (res.data.success) {
                setClosingStatuses(res.data.data);
            }
        } catch (e) {
            console.error('加载结账状态失败:', e);
        } finally {
            setClosingStatusLoading(false);
        }
    };

    const handleReopenPeriod = (y, p) => {
        setConfirmDialog({
            isOpen: true,
            title: '反结账',
            message: `确认要对 ${y}年${p}期 进行反结账吗？反结账后可以继续修改该期间凭证。`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                const key = `${y}-${p}`;
                setReopenLoading(key);
                try {
                    const res = await axios.post(`${API_BASE_URL}/api/fbl-finance/closing/reopen-period`, null, {
                        params: { year: y, period: p }
                    });
                    if (res.data.success) {
                        await loadClosingStatuses();
                        alert(res.data.message);
                    } else {
                        alert(res.data.message || '反结账失败');
                    }
                } catch (e) {
                    alert('反结账失败: ' + (e.response?.data?.message || e.message));
                } finally {
                    setReopenLoading(null);
                }
            }
        });
    };

    const toggleClosingMgmt = () => {
        const next = !showClosingMgmt;
        setShowClosingMgmt(next);
        if (next) loadClosingStatuses();
    };

    // Methods
    const handleCheck = async () => {
        setLoading(true);
        setCheckResult(null);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/fbl-finance/closing/check`, {
                params: { year, period }
            });
            setCheckResult(res.data);
        } catch (error) {
            setCheckResult({ success: false, message: "检查失败: " + (error.response?.data?.message || error.message) });
        } finally {
            setLoading(false);
        }
    };

    const handleTransfer = async () => {
        setLoading(true);
        setTransferResult(null);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/fbl-finance/closing/transfer-pl`, {
                year, period
            });
            setTransferResult(res.data);
            if (res.data.success && res.data.voucher_id) {
                setProfitLossVoucherId(res.data.voucher_id);
            }
        } catch (error) {
            setTransferResult({ success: false, message: "结转失败: " + (error.response?.data?.message || error.message) });
        } finally {
            setLoading(false);
        }
    };

    const handleSalesCostTransfer = async () => {
        setLoading(true);
        setSalesCostResult(null);
        try {
            const res = await axios.post(`${API_BASE_URL}/api/fbl-finance/closing/transfer-sales-cost`, { year, period });
            setSalesCostResult(res.data);
        } catch (e) {
            setSalesCostResult({ success: false, message: "操作失败: " + (e.response?.data?.message || e.message) });
        } finally {
            setLoading(false);
        }
    };

    const handleExchangeTransfer = async () => {
        setLoading(true);
        setExchangeResult(null);
        try {
            // 将期末汇率传给后端（key 为字符串类型的 currency id）
            const ratesPayload = {};
            Object.entries(periodEndRates).forEach(([k, v]) => {
                if (v && v > 0) ratesPayload[String(k)] = Number(v);
            });
            const res = await axios.post(`${API_BASE_URL}/api/fbl-finance/closing/transfer-exchange`, {
                year,
                period,
                period_end_rates: Object.keys(ratesPayload).length > 0 ? ratesPayload : null
            });
            setExchangeResult(res.data);
        } catch (e) {
            setExchangeResult({ success: false, message: "操作失败: " + (e.response?.data?.message || e.message) });
        } finally {
            setLoading(false);
        }
    };

    const handleClosePeriod = () => {
        setConfirmDialog({
            isOpen: true,
            title: '结账',
            message: `确认要对 ${year}年${period}期 进行结账操作吗？`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                setLoading(true);
                setCloseResult(null);
                try {
                    const res = await axios.post(`${API_BASE_URL}/api/fbl-finance/closing/close-period`, null, {
                        params: { year, period }
                    });
                    setCloseResult(res.data);
                } catch (error) {
                    setCloseResult({ success: false, message: "结账失败: " + (error.response?.data?.message || error.message) });
                } finally {
                    setLoading(false);
                }
            }
        });
    };

    const steps = [
        { id: 1, label: '结账检查', icon: CheckCircle },
        { id: 2, label: '期末结转', icon: Repeat },
        { id: 3, label: '期末结账', icon: Lock },
    ];

    const transferItems = [
        {
            key: 'pl',
            title: '期间损益结转',
            desc: '将本期损益类科目余额结转至本年利润',
            icon: TrendingUp,
            color: 'blue',
            onExecute: handleTransfer,
            result: transferResult,
        },
        {
            key: 'sales',
            title: '销售成本结转',
            desc: '根据销售收入自动计算并结转销售成本',
            icon: FileText,
            color: 'indigo',
            onExecute: handleSalesCostTransfer,
            result: salesCostResult,
        },
        {
            key: 'exchange',
            title: '汇兑损益结转',
            desc: '计算并结转外币账户的汇兑损益',
            icon: Repeat,
            color: 'purple',
            onExecute: handleExchangeTransfer,
            result: exchangeResult,
        },
        {
            key: 'custom',
            title: '自定义结转',
            desc: '手动创建自定义的转账凭证',
            icon: PenTool,
            color: 'gray',
            isLink: true,
        },
    ];

    const colorMap = {
        blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', icon: 'text-blue-500', btn: 'bg-blue-600 hover:bg-blue-700', btnRing: 'focus:ring-blue-300' },
        indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-600', icon: 'text-indigo-500', btn: 'bg-indigo-600 hover:bg-indigo-700', btnRing: 'focus:ring-indigo-300' },
        purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600', icon: 'text-purple-500', btn: 'bg-purple-600 hover:bg-purple-700', btnRing: 'focus:ring-purple-300' },
        gray: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', icon: 'text-gray-500', btn: 'bg-gray-600 hover:bg-gray-700', btnRing: 'focus:ring-gray-300' },
    };

    // UI
    return (
        <div className="h-full bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50">
            <div className="max-w-5xl mx-auto px-4 py-5 sm:px-6">
                {/* 页面标题 + 会计期间选择 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-red-400 to-rose-500 rounded-xl shadow-lg shadow-red-200/50">
                            <Lock className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">期末结转</h1>
                            <p className="text-xs text-gray-500">Period End Closing</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 px-2.5 py-1.5 shadow-sm">
                            <span className="text-xs font-medium text-gray-500">期间</span>
                            <input
                                type="number"
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value))}
                                className="w-16 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                            />
                            <span className="text-xs text-gray-400">年</span>
                            <input
                                type="number"
                                value={period}
                                onChange={(e) => setPeriod(parseInt(e.target.value))}
                                min="1" max="12"
                                className="w-12 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                            />
                            <span className="text-xs text-gray-400">期</span>
                        </div>
                        <button
                            onClick={toggleClosingMgmt}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-xl border transition-all shadow-sm ${
                                showClosingMgmt
                                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            <ClipboardList className="w-3.5 h-3.5" />
                            结账管理
                        </button>
                    </div>
                </div>

                {/* 结账管理面板 */}
                {showClosingMgmt && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 p-4 mb-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                                <ClipboardList className="w-4 h-4 text-amber-500" />
                                <h2 className="text-sm font-semibold text-gray-800">结账管理</h2>
                                <span className="text-[11px] text-gray-400 hidden sm:inline">查看已结账期间，支持反结账操作</span>
                            </div>
                            <button
                                onClick={loadClosingStatuses}
                                disabled={closingStatusLoading}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                <RefreshCw className={`w-3 h-3 ${closingStatusLoading ? 'animate-spin' : ''}`} />
                                刷新
                            </button>
                        </div>

                        {closingStatusLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="w-5 h-5 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
                                <span className="ml-2 text-sm text-gray-400">加载中...</span>
                            </div>
                        ) : closingStatuses.filter(s => s.is_closed).length === 0 ? (
                            <div className="flex flex-col items-center py-8 text-gray-400">
                                <Calendar className="w-8 h-8 text-gray-300 mb-2" />
                                <span className="text-sm">暂无已结账期间</span>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                {closingStatuses.filter(s => s.is_closed).map(s => {
                                    const key = `${s.year}-${s.period}`;
                                    const isReopening = reopenLoading === key;
                                    return (
                                        <div
                                            key={key}
                                            className="group relative flex flex-col items-center p-3 bg-emerald-50 border border-emerald-200 rounded-xl transition-all hover:shadow-sm"
                                        >
                                            <div className="flex items-center gap-1 mb-1">
                                                <Lock className="w-3 h-3 text-emerald-500" />
                                                <span className="text-sm font-semibold text-gray-800">{s.year}年{s.period}期</span>
                                            </div>
                                            <span className="text-[10px] text-gray-400">
                                                {s.closed_at ? new Date(s.closed_at).toLocaleDateString('zh-CN') : ''}
                                            </span>
                                            <button
                                                onClick={() => handleReopenPeriod(s.year, s.period)}
                                                disabled={isReopening}
                                                className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium 
                                                           text-orange-600 bg-orange-50 border border-orange-200 rounded-lg 
                                                           hover:bg-orange-100 transition-colors disabled:opacity-50
                                                           opacity-0 group-hover:opacity-100"
                                                title="反结账"
                                            >
                                                {isReopening ? (
                                                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                                ) : (
                                                    <Unlock className="w-2.5 h-2.5" />
                                                )}
                                                反结账
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* 步骤条 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 px-3 py-3 mb-4">
                    <div className="flex items-center justify-between">
                        {steps.map((step, idx) => {
                            const Icon = step.icon;
                            const isActive = currentStep === step.id;
                            const isDone = currentStep > step.id;
                            return (
                                <React.Fragment key={step.id}>
                                    <button
                                        onClick={() => {
                                            if (step.id <= currentStep) setCurrentStep(step.id);
                                        }}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-200 ${
                                            isActive
                                                ? 'bg-amber-50 border border-amber-200 shadow-sm'
                                                : isDone
                                                    ? 'text-emerald-600 hover:bg-emerald-50 cursor-pointer'
                                                    : 'text-gray-400 cursor-default'
                                        }`}
                                    >
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                            isActive
                                                ? 'bg-amber-500 text-white'
                                                : isDone
                                                    ? 'bg-emerald-500 text-white'
                                                    : 'bg-gray-200 text-gray-500'
                                        }`}>
                                            {isDone ? <CheckCircle className="w-3.5 h-3.5" /> : step.id}
                                        </div>
                                        <span className={`text-xs font-medium hidden sm:inline ${
                                            isActive ? 'text-amber-700' : isDone ? 'text-emerald-600' : 'text-gray-400'
                                        }`}>
                                            {step.label}
                                        </span>
                                    </button>
                                    {idx < steps.length - 1 && (
                                        <div className={`flex-1 h-0.5 mx-1.5 rounded-full transition-colors ${
                                            currentStep > step.id ? 'bg-emerald-400' : 'bg-gray-200'
                                        }`} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* 步骤内容 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100/80 overflow-hidden">
                    {/* ===== 步骤 1: 结账检查 ===== */}
                    {currentStep === 1 && (
                        <div className="p-4 sm:p-5">
                            <div className="flex items-center gap-3 mb-4">
                                <CheckCircle className="w-5 h-5 text-blue-500" />
                                <h2 className="text-lg font-semibold text-gray-800">检查未记账凭证</h2>
                            </div>
                            <p className="text-sm text-gray-500 mb-5">
                                系统将检查当前期间是否存在未记账凭证。只有所有凭证都已记账，才能进行下一步。
                            </p>

                            <button
                                onClick={handleCheck}
                                disabled={loading}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl 
                                           hover:bg-blue-700 disabled:opacity-50 transition-all text-sm font-medium
                                           shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300"
                            >
                                {loading ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" />检查中...</>
                                ) : (
                                    <><CheckCircle className="w-4 h-4" />开始检查</>
                                )}
                            </button>

                            {checkResult && (
                                <div className={`mt-5 p-4 rounded-xl border ${
                                    checkResult.success && checkResult.can_close
                                        ? 'bg-emerald-50 border-emerald-200'
                                        : checkResult.is_already_closed
                                            ? 'bg-amber-50 border-amber-200'
                                            : 'bg-red-50 border-red-200'
                                }`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {checkResult.can_close
                                            ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                                            : checkResult.is_already_closed
                                                ? <Lock className="w-4 h-4 text-amber-600" />
                                                : <AlertTriangle className="w-4 h-4 text-red-600" />
                                        }
                                        <h3 className={`font-semibold text-sm ${
                                            checkResult.can_close ? 'text-emerald-700' : checkResult.is_already_closed ? 'text-amber-700' : 'text-red-700'
                                        }`}>
                                            {checkResult.can_close ? '检查通过，可以继续' : checkResult.is_already_closed ? '该期间已结账' : '检查未通过'}
                                        </h3>
                                    </div>
                                    {checkResult.is_already_closed && (
                                        <div className="ml-6 mt-1">
                                            <p className="text-sm text-amber-700 mb-2">
                                                {year}年{period}期 已完成结账，不能重复结账。如需修改凭证，请先反结账。
                                            </p>
                                            <button
                                                onClick={() => { setShowClosingMgmt(true); loadClosingStatuses(); }}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-orange-600 
                                                           bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                                            >
                                                <Unlock className="w-3 h-3" />
                                                前往结账管理
                                            </button>
                                        </div>
                                    )}
                                    {checkResult.unposted_count > 0 && (
                                        <p className="text-sm text-red-600 ml-6">
                                            发现 {checkResult.unposted_count} 张未记账凭证，请先审核并记账。
                                        </p>
                                    )}
                                    {!checkResult.is_already_closed && checkResult.errors && checkResult.errors.map((err, idx) => (
                                        <p key={idx} className="text-sm text-red-600 ml-6 mt-0.5">• {err}</p>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={() => setCurrentStep(2)}
                                    disabled={!checkResult?.can_close}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 
                                               text-white rounded-xl hover:from-amber-600 hover:to-yellow-600 
                                               disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm font-medium
                                               shadow-sm hover:shadow-md"
                                >
                                    下一步：损益结转
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ===== 步骤 2: 期末结转 ===== */}
                    {currentStep === 2 && (
                        <div className="p-4 sm:p-5">
                            <div className="flex items-center gap-3 mb-1">
                                <Repeat className="w-5 h-5 text-amber-500" />
                                <h2 className="text-lg font-semibold text-gray-800">期末结转</h2>
                            </div>
                            <p className="text-sm text-gray-500 mb-4">请按顺序执行需要的结转操作。</p>

                            {/* 结转操作列表 - 紧凑的横向卡片 */}
                            <div className="space-y-3">
                                {transferItems.map((item, idx) => {
                                    const Icon = item.icon;
                                    const colors = colorMap[item.color];
                                    return (
                                        <div key={item.key}>
                                            <div className={`flex flex-wrap items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm ${colors.border} ${colors.bg}`}>
                                                <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg}`}>
                                                    <Icon className={`w-4 h-4 ${colors.icon}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold text-gray-400">{idx + 1}.</span>
                                                        <h3 className="text-xs font-semibold text-gray-800">{item.title}</h3>
                                                    </div>
                                                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">{item.desc}</p>
                                                    {item.result && (
                                                        <p className={`text-xs mt-1 flex items-center gap-1 ${
                                                            item.result.success ? 'text-emerald-600' : 'text-red-600'
                                                        }`}>
                                                            {item.result.success
                                                                ? <CheckCircle className="w-3 h-3" />
                                                                : <AlertTriangle className="w-3 h-3" />
                                                            }
                                                            {item.result.message}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="shrink-0 flex items-center gap-2">
                                                    {/* 汇兑损益结转 - 设置汇率按钮 */}
                                                    {item.key === 'exchange' && currencies.length > 0 && (
                                                        <button
                                                            onClick={() => setShowRateEditor(!showRateEditor)}
                                                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium 
                                                                       rounded-lg border transition-colors ${
                                                                showRateEditor 
                                                                    ? 'bg-purple-100 border-purple-300 text-purple-700' 
                                                                    : 'bg-white border-purple-200 text-purple-600 hover:bg-purple-50'
                                                            }`}
                                                        >
                                                            设置汇率
                                                        </button>
                                                    )}
                                                    {item.isLink ? (
                                                        <button
                                                            onClick={() => {
                                                                if (onNavigate) onNavigate('voucher');
                                                            }}
                                                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-gray-600 
                                                                       bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                                        >
                                                            去凭证管理
                                                            <ChevronRight className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={item.onExecute}
                                                            disabled={loading}
                                                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white 
                                                                       rounded-lg transition-all disabled:opacity-50 shadow-sm ${colors.btn}`}
                                                        >
                                                            {loading ? (
                                                                <><RefreshCw className="w-3.5 h-3.5 animate-spin" />处理中</>
                                                            ) : (
                                                                '执行结转'
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 汇兑损益 - 期末汇率编辑面板 */}
                                            {item.key === 'exchange' && showRateEditor && currencies.length > 0 && (
                                                <div className="mt-2 ml-13 p-4 bg-white border border-purple-200 rounded-xl shadow-sm">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h4 className="text-sm font-semibold text-gray-700">期末汇率设置</h4>
                                                        <span className="text-xs text-gray-400">请输入各外币对人民币的期末汇率</span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {currencies.map(c => (
                                                            <div key={c.id} className="flex items-center gap-3">
                                                                <div className="w-20 shrink-0">
                                                                    <span className="text-sm font-medium text-gray-700">
                                                                        {c.code}
                                                                    </span>
                                                                    <span className="text-xs text-gray-400 ml-1">{c.name}</span>
                                                                </div>
                                                                <div className="flex-1 relative">
                                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">1 {c.code} =</span>
                                                                    <input
                                                                        type="number"
                                                                        step="0.0001"
                                                                        value={periodEndRates[c.id] || ''}
                                                                        onChange={(e) => {
                                                                            setPeriodEndRates(prev => ({
                                                                                ...prev,
                                                                                [c.id]: e.target.value ? parseFloat(e.target.value) : ''
                                                                            }));
                                                                        }}
                                                                        placeholder={c.latest_rate ? `最近: ${c.latest_rate}` : '请输入汇率'}
                                                                        className="w-full pl-20 pr-12 py-2 text-sm border border-gray-200 rounded-lg 
                                                                                   focus:ring-2 focus:ring-purple-200 focus:border-purple-400 
                                                                                   outline-none transition-all"
                                                                    />
                                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">CNY</span>
                                                                </div>
                                                                {c.latest_rate && (
                                                                    <button
                                                                        onClick={() => setPeriodEndRates(prev => ({ ...prev, [c.id]: c.latest_rate }))}
                                                                        className="shrink-0 text-xs text-purple-500 hover:text-purple-700 underline"
                                                                        title="使用最近一笔凭证的汇率"
                                                                    >
                                                                        用最近
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <p className="mt-3 text-xs text-gray-400">
                                                        提示：如不填写，系统将自动使用本期最后一笔外币凭证的汇率作为期末汇率。
                                                        建议使用中国人民银行公布的期末中间价。
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 提示 */}
                            <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700">
                                    生成结转凭证后，请务必到凭证管理页面进行审核并记账。
                                </p>
                            </div>

                            {/* 导航按钮 */}
                            <div className="mt-5 pt-4 border-t border-gray-100 flex justify-between">
                                <button
                                    onClick={() => setCurrentStep(1)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 border border-gray-200 
                                               rounded-xl hover:bg-gray-50 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    上一步
                                </button>
                                <button
                                    onClick={() => setCurrentStep(3)}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 
                                               text-white rounded-xl hover:from-amber-600 hover:to-yellow-600 
                                               transition-all text-sm font-medium shadow-sm hover:shadow-md"
                                >
                                    下一步：期末结账
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ===== 步骤 3: 期末结账 ===== */}
                    {currentStep === 3 && (
                        <div className="p-4 sm:p-5">
                            <div className="flex items-center gap-3 mb-4">
                                <Lock className="w-5 h-5 text-red-500" />
                                <h2 className="text-lg font-semibold text-gray-800">期末结账</h2>
                            </div>
                            <p className="text-sm text-gray-500 mb-5">
                                系统将再次检查所有凭证是否已记账，并标记本期为"已结账"。结账后，本期将无法再录入或修改凭证。如需修改，可通过"结账管理"进行反结账。
                            </p>

                            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <AlertTriangle className="w-4 h-4 text-red-500" />
                                    <h3 className="font-semibold text-sm text-red-700">确认操作</h3>
                                </div>
                                <p className="text-xs text-red-600 mb-3 ml-6">
                                    您即将对 <span className="font-semibold">{year}年{period}期</span> 进行结账操作。结账后如需修改，可通过结账管理进行反结账。
                                </p>
                                <div className="ml-6">
                                    <button
                                        onClick={handleClosePeriod}
                                        disabled={loading}
                                        className="inline-flex items-center gap-2 px-5 py-2 bg-red-600 text-white rounded-xl 
                                                   hover:bg-red-700 disabled:opacity-50 transition-all text-sm font-medium
                                                   shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-300"
                                    >
                                        {loading ? (
                                            <><RefreshCw className="w-4 h-4 animate-spin" />结账中...</>
                                        ) : (
                                            <><Lock className="w-4 h-4" />确认结账</>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {closeResult && (
                                <div className={`mt-4 p-4 rounded-xl border ${
                                    closeResult.success
                                        ? 'bg-emerald-50 border-emerald-200'
                                        : 'bg-red-50 border-red-200'
                                }`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {closeResult.success
                                            ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                                            : <AlertTriangle className="w-4 h-4 text-red-600" />
                                        }
                                        <h3 className={`font-semibold text-sm ${
                                            closeResult.success ? 'text-emerald-700' : 'text-red-700'
                                        }`}>
                                            {closeResult.success ? '结账成功' : '结账失败'}
                                        </h3>
                                    </div>
                                    <p className="text-sm text-gray-700 ml-6">{closeResult.message}</p>
                                    {closeResult.success && (
                                        <div className="mt-3 ml-6">
                                            <button
                                                onClick={() => onNavigate && onNavigate('finance-reports')}
                                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white 
                                                           bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl 
                                                           hover:from-blue-600 hover:to-indigo-600 shadow-sm transition-all"
                                            >
                                                <FileText className="w-4 h-4" />
                                                查看财务报表
                                                <ChevronRight className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between">
                                <button
                                    onClick={() => setCurrentStep(2)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 border border-gray-200 
                                               rounded-xl hover:bg-gray-50 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    上一步
                                </button>
                                <button
                                    onClick={() => {
                                        if (closeResult?.success) {
                                            if (period === 12) { setYear(y => y + 1); setPeriod(1); }
                                            else { setPeriod(p => p + 1); }
                                            setCurrentStep(1);
                                            setCheckResult(null);
                                            setTransferResult(null);
                                            setSalesCostResult(null);
                                            setExchangeResult(null);
                                            setCloseResult(null);
                                        }
                                    }}
                                    disabled={!closeResult?.success}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 
                                               text-white rounded-xl hover:from-emerald-600 hover:to-teal-600 
                                               disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm font-medium
                                               shadow-sm hover:shadow-md"
                                >
                                    完成 & 下一期
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FinanceClosing;
