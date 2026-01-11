import React, { useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { useForm, Controller } from 'react-hook-form';
import DatePicker from 'react-datepicker';
import { useDropzone } from 'react-dropzone';
import { toast } from 'react-hot-toast';
import { X, Banknote, Building2, Smartphone, CreditCard, Wallet, Upload, Trash2 } from 'lucide-react';
import { PaymentMethod, AccountReceivable } from '../../types/finance';
import { submitPayment, PaymentSubmitData } from '../../services/financeService';
import 'react-datepicker/dist/react-datepicker.css';

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: number;
  customerName: string;
  receivableId: number;
  receivable?: AccountReceivable;
  unpaidReceivables?: AccountReceivable[]; // 该客户所有未付清的应收账款
  onSuccess?: () => void;
}

interface PaymentFormData {
  salesOrderId: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  voucherImage?: File;
  remark?: string;
}

const paymentMethodOptions = [
  { value: PaymentMethod.CASH, label: '现金', icon: Banknote },
  { value: PaymentMethod.BANK_TRANSFER, label: '转账', icon: Building2 },
  { value: PaymentMethod.WECHAT, label: '微信', icon: Smartphone },
  { value: PaymentMethod.ALIPAY, label: '支付宝', icon: Smartphone },
  { value: PaymentMethod.CARD, label: '刷卡', icon: CreditCard },
];

export const PaymentDialog: React.FC<PaymentDialogProps> = ({
  isOpen,
  onClose,
  customerId,
  customerName,
  receivableId,
  receivable,
  unpaidReceivables = [],
  onSuccess,
}) => {
  const [selectedReceivable, setSelectedReceivable] = useState<AccountReceivable | null>(
    receivable || null
  );
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isValid },
  } = useForm<PaymentFormData>({
    mode: 'onChange',
    defaultValues: {
      salesOrderId: receivable?.salesOrderId || 0,
      amount: 0,
      paymentMethod: PaymentMethod.CASH,
      paymentDate: new Date(),
      remark: '',
    },
  });

  const watchedSalesOrderId = watch('salesOrderId');
  const watchedAmount = watch('amount');

  // 当选择销售单时，更新selectedReceivable和应收余额
  useEffect(() => {
    if (watchedSalesOrderId) {
      const receivable = unpaidReceivables.find((r) => r.salesOrderId === watchedSalesOrderId);
      setSelectedReceivable(receivable || null);
    } else if (receivable) {
      setSelectedReceivable(receivable);
      setValue('salesOrderId', receivable.salesOrderId);
    }
  }, [watchedSalesOrderId, unpaidReceivables, receivable, setValue]);

  // 图片上传处理
  const onDrop = React.useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      // 验证文件大小（2MB）
      if (file.size > 2 * 1024 * 1024) {
        toast.error('图片大小不能超过2MB');
        return;
      }

      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        toast.error('只能上传图片文件');
        return;
      }

      setValue('voucherImage', file);
      const reader = new FileReader();
      reader.onload = () => {
        setVoucherPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, [setValue]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png'],
    },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024, // 2MB
  });

  const removeVoucher = () => {
    setValue('voucherImage', undefined);
    setVoucherPreview(null);
  };

  // 格式化金额
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // 应收余额
  const unpaidAmount = selectedReceivable?.unpaidAmount || 0;

  // 表单提交
  const onSubmit = async (data: PaymentFormData) => {
    if (!selectedReceivable) {
      toast.error('请选择关联销售单');
      return;
    }

    setIsSubmitting(true);

    try {
      // 将图片转换为base64（实际应该上传到服务器）
      let voucherImageBase64: string | undefined;
      if (data.voucherImage) {
        const reader = new FileReader();
        voucherImageBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(data.voucherImage!);
        });
      }

      const submitData: PaymentSubmitData = {
        customerId,
        customerName,
        receivableId: selectedReceivable.id,
        salesOrderId: data.salesOrderId,
        salesOrderNo: selectedReceivable.salesOrder?.orderNo || '',
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        paymentDate: data.paymentDate,
        voucherImage: voucherImageBase64,
        remark: data.remark,
      };

      const result = await submitPayment(submitData);

      if (result.success) {
        toast.success(result.message || '收款记录已保存');
        reset({
          salesOrderId: receivable?.salesOrderId || 0,
          amount: 0,
          paymentMethod: PaymentMethod.CASH,
          paymentDate: new Date(),
          remark: '',
        });
        setVoucherPreview(null);
        setSelectedReceivable(receivable || null);
        onSuccess?.();
        onClose();
      } else {
        toast.error(result.error || '保存失败，请重试');
      }
    } catch (error) {
      console.error('提交收款记录失败:', error);
      toast.error('保存失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 关闭弹窗时重置表单
  const handleClose = () => {
    reset({
      salesOrderId: receivable?.salesOrderId || 0,
      amount: 0,
      paymentMethod: PaymentMethod.CASH,
      paymentDate: new Date(),
      remark: '',
    });
    setVoucherPreview(null);
    setSelectedReceivable(receivable || null);
    onClose();
  };

  // 弹窗打开时初始化表单
  useEffect(() => {
    if (isOpen && receivable) {
      setSelectedReceivable(receivable);
      setValue('salesOrderId', receivable.salesOrderId);
      setValue('paymentDate', new Date());
    }
  }, [isOpen, receivable, setValue]);

  // 验证金额
  const validateAmount = (value: number) => {
    if (!value || value <= 0) {
      return '收款金额必须大于0';
    }
    if (value > unpaidAmount) {
      return `收款金额不能超过应收余额 ${formatCurrency(unpaidAmount)}`;
    }
    // 检查小数位数
    const decimalPart = value.toString().split('.')[1];
    if (decimalPart && decimalPart.length > 2) {
      return '金额最多保留两位小数';
    }
    return true;
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleClose}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  {/* 头部 */}
                  <div className="flex items-center justify-between mb-6">
                    <Dialog.Title as="h3" className="text-2xl font-bold text-gray-900">
                      记录收款
                    </Dialog.Title>
                    <button
                      onClick={handleClose}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  {/* 表单 */}
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* 客户名称 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        客户名称
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        readOnly
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                      />
                    </div>

                    {/* 关联销售单 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        关联销售单 <span className="text-red-500">*</span>
                      </label>
                      <select
                        {...register('salesOrderId', {
                          required: '请选择关联销售单',
                          valueAsNumber: true,
                        })}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.salesOrderId ? 'border-red-500' : 'border-gray-300'
                        }`}
                      >
                        <option value={0}>请选择销售单</option>
                        {unpaidReceivables.map((ar) => (
                          <option key={ar.id} value={ar.salesOrderId}>
                            {ar.salesOrder?.orderNo || '未知单号'} (应收余额:{' '}
                            {formatCurrency(ar.unpaidAmount)})
                          </option>
                        ))}
                      </select>
                      {errors.salesOrderId && (
                        <p className="mt-1 text-sm text-red-600">{errors.salesOrderId.message}</p>
                      )}
                    </div>

                    {/* 应收余额 */}
                    {selectedReceivable && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          应收余额
                        </label>
                        <div className="text-2xl font-bold text-blue-600">
                          剩余应收: {formatCurrency(unpaidAmount)}
                        </div>
                      </div>
                    )}

                    {/* 本次收款金额 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        本次收款金额 <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500">
                          ¥
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="请输入收款金额"
                          {...register('amount', {
                            required: '请输入收款金额',
                            validate: validateAmount,
                            valueAsNumber: true,
                          })}
                          className={`w-full pl-8 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            errors.amount ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                      </div>
                      {errors.amount && (
                        <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
                      )}
                    </div>

                    {/* 收款方式 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        收款方式 <span className="text-red-500">*</span>
                      </label>
                      <Controller
                        name="paymentMethod"
                        control={control}
                        rules={{ required: '请选择收款方式' }}
                        render={({ field }) => (
                          <div className="grid grid-cols-5 gap-3">
                            {paymentMethodOptions.map((option) => {
                              const Icon = option.icon;
                              const isSelected = field.value === option.value;
                              return (
                                <label
                                  key={option.value}
                                  className={`
                                    flex flex-col items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all
                                    ${
                                      isSelected
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-300 hover:border-gray-400'
                                    }
                                  `}
                                >
                                  <input
                                    type="radio"
                                    value={option.value}
                                    checked={isSelected}
                                    onChange={() => field.onChange(option.value)}
                                    className="hidden"
                                  />
                                  <Icon className={`w-6 h-6 mb-1 ${isSelected ? 'text-blue-600' : 'text-gray-600'}`} />
                                  <span className={`text-xs ${isSelected ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                                    {option.label}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      />
                      {errors.paymentMethod && (
                        <p className="mt-1 text-sm text-red-600">{errors.paymentMethod.message}</p>
                      )}
                    </div>

                    {/* 收款日期 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        收款日期 <span className="text-red-500">*</span>
                      </label>
                      <Controller
                        name="paymentDate"
                        control={control}
                        rules={{ required: '请选择收款日期' }}
                        render={({ field }) => (
                          <DatePicker
                            selected={field.value}
                            onChange={(date) => field.onChange(date || new Date())}
                            maxDate={new Date()}
                            dateFormat="yyyy-MM-dd"
                            className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                              errors.paymentDate ? 'border-red-500' : 'border-gray-300'
                            }`}
                            placeholderText="请选择收款日期"
                            showPopperArrow={false}
                          />
                        )}
                      />
                      {errors.paymentDate && (
                        <p className="mt-1 text-sm text-red-600">{errors.paymentDate.message}</p>
                      )}
                    </div>

                    {/* 收款凭证 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        收款凭证 <span className="text-gray-500 text-xs">(可选)</span>
                      </label>
                      {voucherPreview ? (
                        <div className="relative inline-block">
                          <img
                            src={voucherPreview}
                            alt="凭证预览"
                            className="w-32 h-32 object-cover rounded-lg border border-gray-300"
                          />
                          <button
                            type="button"
                            onClick={removeVoucher}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          {...getRootProps()}
                          className={`
                            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
                            ${
                              isDragActive
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-300 hover:border-gray-400'
                            }
                          `}
                        >
                          <input {...getInputProps()} />
                          <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                          <p className="text-sm text-gray-600">
                            {isDragActive ? '松开以上传' : '点击或拖拽图片到此处上传'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">支持 JPG/PNG，最大 2MB</p>
                        </div>
                      )}
                    </div>

                    {/* 备注 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        备注 <span className="text-gray-500 text-xs">(可选)</span>
                      </label>
                      <textarea
                        {...register('remark', {
                          maxLength: {
                            value: 200,
                            message: '备注最多200字',
                          },
                        })}
                        rows={3}
                        placeholder="选填，如有特殊说明可在此备注"
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          errors.remark ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {errors.remark && (
                        <p className="mt-1 text-sm text-red-600">{errors.remark.message}</p>
                      )}
                    </div>

                    {/* 底部按钮 */}
                    <div className="flex justify-end space-x-3 pt-4 border-t">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                        disabled={isSubmitting}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting || !isValid}
                        className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? '提交中...' : '确认收款'}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
  );
};

