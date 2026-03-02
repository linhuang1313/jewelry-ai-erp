import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, ChevronDown, Loader2 } from 'lucide-react';

interface Option {
  value: number | string;
  label: string;
  sublabel?: string;
}

interface AsyncSearchSelectProps {
  value: number | string | null;
  onChange: (value: number | string | null, option?: Option | null) => void;
  fetchOptions: (search: string) => Promise<Option[]>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  initialOptions?: Option[];
}

const AsyncSearchSelect: React.FC<AsyncSearchSelectProps> = ({
  value,
  onChange,
  fetchOptions,
  placeholder = '搜索...',
  className = '',
  disabled = false,
  allowClear = true,
  initialOptions = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [loading, setLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (value !== null && value !== undefined) {
      const found = options.find(o => o.value === value) || initialOptions.find(o => o.value === value);
      if (found) setSelectedOption(found);
    } else {
      setSelectedOption(null);
    }
  }, [value, options, initialOptions]);

  useEffect(() => {
    if (initialOptions.length > 0) {
      setOptions(initialOptions);
    } else {
      fetchOptions('').then(setOptions).catch(() => {});
    }
  }, []);

  const handleSearch = useCallback((term: string) => {
    setSearch(term);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchOptions(term);
        setOptions(results);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [fetchOptions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option: Option) => {
    setSelectedOption(option);
    onChange(option.value, option);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedOption(null);
    onChange(null, null);
    setSearch('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`flex items-center w-full px-3 py-2 border border-gray-200 rounded-lg cursor-pointer transition-colors ${
          isOpen ? 'ring-2 ring-amber-500 border-amber-500' : 'hover:border-gray-300'
        } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
      >
        {isOpen ? (
          <div className="flex items-center w-full gap-2">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder={placeholder}
              onClick={(e) => e.stopPropagation()}
            />
            {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" />}
          </div>
        ) : (
          <div className="flex items-center w-full gap-2">
            <span className={`flex-1 text-sm truncate ${selectedOption ? 'text-gray-900' : 'text-gray-400'}`}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {allowClear && selectedOption && (
              <X className="w-4 h-4 text-gray-400 hover:text-gray-600 flex-shrink-0" onClick={handleClear} />
            )}
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading && options.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">
              <Loader2 className="w-5 h-5 mx-auto mb-1 animate-spin" />
              搜索中...
            </div>
          ) : options.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">
              无匹配结果
            </div>
          ) : (
            options.map((option) => (
              <div
                key={option.value}
                className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                  value === option.value
                    ? 'bg-amber-50 text-amber-900 font-medium'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
                onClick={() => handleSelect(option)}
              >
                <div>{option.label}</div>
                {option.sublabel && (
                  <div className="text-xs text-gray-400">{option.sublabel}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default AsyncSearchSelect;
