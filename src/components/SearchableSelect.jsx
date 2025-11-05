import React, { useState, useRef, useEffect, useCallback } from 'react';

const SearchableSelect = ({
  value,
  options = [],
  onChange,
  getOptionLabel = (option) => option.name,
  getOptionValue = (option) => option.id,
  placeholder = 'Search or select...',
  className = '',
  maxVisibleItems = 8,
  disabled = false,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Get the display text for the selected value
  const selectedOption = options.find(opt => getOptionValue(opt) === value);
  const displayText = selectedOption ? getOptionLabel(selectedOption) : '';

  // Filter options based on search text
  const filteredOptions = searchText
    ? options.filter(option =>
        getOptionLabel(option).toLowerCase().includes(searchText.toLowerCase())
      )
    : options;

  // Calculate dropdown position based on input position
  const updateDropdownPosition = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, []);

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchText]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && dropdownRef.current && highlightedIndex >= 0) {
      const highlightedElement = dropdownRef.current.children[highlightedIndex];
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchText('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Update dropdown position on scroll/resize when open
  useEffect(() => {
    if (!isOpen) return;

    const handlePositionUpdate = () => {
      updateDropdownPosition();
    };

    window.addEventListener('scroll', handlePositionUpdate, true);
    window.addEventListener('resize', handlePositionUpdate);

    return () => {
      window.removeEventListener('scroll', handlePositionUpdate, true);
      window.removeEventListener('resize', handlePositionUpdate);
    };
  }, [isOpen, updateDropdownPosition]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(prev =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredOptions[highlightedIndex]) {
            handleSelectOption(filteredOptions[highlightedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSearchText('');
          inputRef.current?.blur();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, filteredOptions]);

  // Handle option selection
  const handleSelectOption = (option) => {
    onChange(getOptionValue(option));
    setIsOpen(false);
    setSearchText('');
    inputRef.current?.blur();
  };

  // Handle input focus
  const handleInputFocus = () => {
    if (!disabled) {
      updateDropdownPosition();
      setIsOpen(true);
    }
  };

  // Handle input change
  const handleInputChange = (e) => {
    setSearchText(e.target.value);
    setIsOpen(true);
  };

  // Highlight matching text in option label
  const highlightText = (text, query) => {
    if (!query) return text;

    const parts = [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;

    let index = lowerText.indexOf(lowerQuery);
    while (index !== -1) {
      // Add text before match
      if (index > lastIndex) {
        parts.push({
          text: text.substring(lastIndex, index),
          highlight: false
        });
      }
      // Add matched text
      parts.push({
        text: text.substring(index, index + query.length),
        highlight: true
      });
      lastIndex = index + query.length;
      index = lowerText.indexOf(lowerQuery, lastIndex);
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({
        text: text.substring(lastIndex),
        highlight: false
      });
    }

    return (
      <>
        {parts.map((part, i) => (
          part.highlight ? (
            <mark key={i} className="bg-ferry-orange-light font-medium">
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          )
        ))}
      </>
    );
  };

  // Calculate dropdown max height (each item ~40px)
  const maxHeight = maxVisibleItems * 40;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input Field */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchText : displayText}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full border border-gray-300 rounded-lg focus:ring-ferry-orange focus:border-ferry-orange transition-colors disabled:opacity-50 disabled:cursor-not-allowed pr-8 ${
            compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2'
          }`}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls="searchable-select-listbox"
        />
        {/* Dropdown arrow icon */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Dropdown List */}
      {isOpen && (
        <div
          ref={dropdownRef}
          id="searchable-select-listbox"
          role="listbox"
          className="fixed z-[9999] bg-white border border-gray-300 rounded-lg shadow-lg overflow-auto"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            maxHeight: `${maxHeight}px`
          }}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const optionValue = getOptionValue(option);
              const optionLabel = getOptionLabel(option);
              const isSelected = optionValue === value;
              const isHighlighted = index === highlightedIndex;

              return (
                <div
                  key={optionValue}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectOption(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`cursor-pointer transition-colors ${
                    compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2'
                  } ${
                    isSelected
                      ? 'bg-ferry-orange text-white font-medium'
                      : isHighlighted
                      ? 'bg-ferry-orange-light'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {highlightText(optionLabel, searchText)}
                </div>
              );
            })
          ) : (
            <div className={`text-gray-500 text-sm ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
              No stations found matching "{searchText}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
