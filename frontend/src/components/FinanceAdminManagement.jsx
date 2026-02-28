
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmationDialog from './ui/ConfirmationDialog';

const API_BASE_URL = window.REACT_APP_API_BASE_URL || '';

const FinanceAdminManagement = ({ onBack }) => {
    const [admins, setAdmins] = useState([]);
    const [newAdminName, setNewAdminName] = useState('');
    const [loading, setLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState({isOpen: false, title: '', message: '', onConfirm: () => {}, isDestructive: false});

    const fetchAdmins = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/admins`);
            const data = await response.json();
            if (data.success) {
                setAdmins(data.data);
            }
        } catch (error) {
            console.error('Fetch admins failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddAdmin = async () => {
        if (!newAdminName.trim()) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/fbl-finance/admins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newAdminName.trim() })
            });
            const data = await response.json();
            if (data.success) {
                setNewAdminName('');
                fetchAdmins();
            } else {
                alert(data.message);
            }
        } catch (error) {
            console.error('Add admin failed:', error);
            alert('添加失败');
        }
    };

    const handleDeleteAdmin = (name) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除管理员',
            message: `确认删除管理员 "${name}" 吗？`,
            isDestructive: true,
            onConfirm: async () => {
                setConfirmDialog(prev => ({...prev, isOpen: false}));
                try {
                    const response = await fetch(`${API_BASE_URL}/api/fbl-finance/admins/${encodeURIComponent(name)}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();
                    if (data.success) {
                        fetchAdmins();
                    } else {
                        alert(data.message);
                    }
                } catch (error) {
                    console.error('Delete admin failed:', error);
                    alert('删除失败');
                }
            }
        });
    };

    useEffect(() => {
        fetchAdmins();
    }, []);

    return (
        <div className="p-6 bg-gray-50 flex flex-col h-full">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-800">梵贝琳财务人员管理</h1>
            </div>

            <div className="bg-white p-6 rounded-lg shadow max-w-2xl mx-auto w-full">
                <div className="flex space-x-4 mb-8">
                    <input
                        type="text"
                        value={newAdminName}
                        onChange={(e) => setNewAdminName(e.target.value)}
                        placeholder="输入管理员姓名"
                        className="flex-1 px-4 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddAdmin()}
                    />
                    <button
                        onClick={handleAddAdmin}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                    >
                        添加管理员
                    </button>
                </div>

                <div className="border rounded-md divide-y">
                    {loading ? (
                        <div className="p-4 text-center text-gray-500">加载中...</div>
                    ) : admins.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">暂无管理员，请添加</div>
                    ) : (
                        admins.map((admin) => (
                            <div key={admin.id} className="flex justify-between items-center p-4 hover:bg-gray-50">
                                <div className="flex items-center space-x-4">
                                    <span className="font-mono text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{admin.id}</span>
                                    <span className="font-medium text-gray-800 text-lg">{admin.name}</span>
                                </div>
                                <button
                                    onClick={() => handleDeleteAdmin(admin.name)}
                                    className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1 rounded-md text-sm transition-colors"
                                >
                                    删除
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
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

export default FinanceAdminManagement;
