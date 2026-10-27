import React, { useState, useRef, useEffect } from 'react';
import '@/renderer/styles/songlist.css';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomDropdownProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const CustomDropdown: React.FC<CustomDropdownProps> = ({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      switch (event.key) {
        case 'Escape':
          setIsOpen(false);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          event.preventDefault();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className={className ? 'dd ' + className : 'dd'}>
      <div
        onClick={handleToggle}
        className="dd__trigger"
        data-disabled={disabled || undefined}
        data-open={isOpen || undefined}
      >
        {selectedOption?.icon && (
          <span className="dd__icon">{selectedOption.icon}</span>
        )}
        <span className="dd__label">{selectedOption?.label || placeholder}</span>
        {isOpen ? <ChevronUp size={14} className="dd__chevron" /> : <ChevronDown size={14} className="dd__chevron" />}
      </div>

      {isOpen && (
        <div className="dd__menu">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                onClick={() => handleOptionClick(option.value)}
                className="dd__option"
                data-selected={isSelected || undefined}
              >
                {isSelected && <div className="dd__option-bar" />}
                {option.icon && <span className="dd__icon">{option.icon}</span>}
                <span className="dd__option-label">{option.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomDropdown;
