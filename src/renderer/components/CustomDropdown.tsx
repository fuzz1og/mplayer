import React, { useState, useRef, useEffect } from 'react';
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
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...(className ? {} : undefined),
      }}
      className={className}
    >
      <div
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px 4px 0',
          borderRadius: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.2s ease',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!disabled && !isOpen) {
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
      >
        {selectedOption?.icon && (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {selectedOption.icon}
          </span>
        )}
        <span
          style={{
            fontSize: '14px',
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {selectedOption?.label || placeholder}
        </span>
        {isOpen ? (
          <ChevronUp
            size={14}
            style={{
              color: 'var(--text-tertiary)',
              transition: 'transform 0.2s ease',
            }}
          />
        ) : (
          <ChevronDown
            size={14}
            style={{
              color: 'var(--text-tertiary)',
              transition: 'transform 0.2s ease',
            }}
          />
        )}
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '6px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
            border: '1px solid var(--border-color)',
            minWidth: '110px',
            zIndex: 1000,
            overflow: 'hidden',
            animation: 'fadeIn 0.18s ease, slideIn 0.18s ease',
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                onClick={() => handleOptionClick(option.value)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  backgroundColor: isSelected ? 'var(--active-bg)' : 'transparent',
                  color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '3px',
                      height: '20px',
                      backgroundColor: 'var(--accent-color)',
                      borderRadius: '0 2px 2px 0',
                    }}
                  />
                )}
                {option.icon && (
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {option.icon}
                  </span>
                )}
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {option.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomDropdown;
