import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';

const SearchableSelect = ({ options, value, onChange, placeholder, inputClassName, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef(null);
    const dropdownRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0, width: 200 });

    useEffect(() => {
        if (!isOpen) {
            const selected = options.find(o => o.id === value);
            setSearchTerm(selected ? (selected.code ? `${selected.code} ${selected.name}` : selected.name) : '');
        }
    }, [value, options, isOpen]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (wrapperRef.current?.contains(event.target)) return;
            if (dropdownRef.current?.contains(event.target)) return;
            setIsOpen(false);
            const selected = options.find(o => o.id === value);
            setSearchTerm(selected ? (selected.code ? `${selected.code} ${selected.name}` : selected.name) : '');
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value, options]);

    useEffect(() => {
        if (isOpen && wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220) });
        }
    }, [isOpen]);

    const filteredOptions = useMemo(() => {
        const searchLower = (searchTerm || '').toLowerCase().trim();
        if (!searchLower) return options;
        return options.filter(option => {
            const codeStr = (option.code || '').toString().toLowerCase();
            const nameStr = (option.name || '').toString().toLowerCase();
            return codeStr.includes(searchLower) || nameStr.includes(searchLower) || `${codeStr} ${nameStr}`.includes(searchLower);
        });
    }, [options, searchTerm]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen && filteredOptions.length > 0) {
                onChange(filteredOptions[0].id);
                setIsOpen(false);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <input
                type="text"
                className={inputClassName || "w-full px-2 py-1 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm"}
                placeholder={placeholder}
                value={searchTerm || ''}
                onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsOpen(true);
                    if (value !== '') {
                        onChange('');
                    }
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
            />
            {isOpen && ReactDOM.createPortal(
                <ul
                    ref={dropdownRef}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
                    className="bg-white border border-gray-200 rounded-lg mt-0 max-h-60 overflow-y-auto shadow-lg text-left"
                >
                    {filteredOptions.length > 0 ? (
                        <>
                            {filteredOptions.slice(0, 100).map(option => (
                                <li
                                    key={option.id}
                                    className="px-3 py-2 text-sm hover:bg-amber-50 cursor-pointer text-gray-700"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        onChange(option.id);
                                        setIsOpen(false);
                                    }}
                                >
                                    {option.code && <span className="font-mono text-xs text-gray-400 mr-1.5">{option.code}</span>}
                                    {option.name}
                                </li>
                            ))}
                            {filteredOptions.length > 100 && (
                                <li className="px-3 py-2 text-xs text-gray-400 text-center">
                                    还有 {filteredOptions.length - 100} 项，请输入关键词筛选...
                                </li>
                            )}
                        </>
                    ) : (
                        <li className="px-3 py-4 text-sm text-gray-400 text-center">无匹配项</li>
                    )}
                </ul>,
                document.body
            )}
        </div>
    );
};

export default SearchableSelect;
