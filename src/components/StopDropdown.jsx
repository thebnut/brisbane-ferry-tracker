import React from 'react';

const StopDropdown = ({ 
  value, 
  onChange, 
  options, 
  disabled = false, 
  placeholder = "Select stop",
  className = "",
  compact = false
}) => {
  const cleanStopName = (name = '') => name
    .replace(/\s+ferry\s+terminal$/i, '')
    .replace(/\s+train\s+station$/i, '')
    .replace(/\s+station$/i, '')
    .replace(/\s+platform\s+\d+$/i, '')
    .trim();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`${compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2'} bg-white border border-gray-300 rounded-lg text-ferry-aqua font-semibold
                  hover:border-ferry-orange focus:border-ferry-orange focus:ring-2 focus:ring-ferry-orange focus:ring-opacity-20
                  transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {options.length === 0 ? (
        <option value="">{placeholder}</option>
      ) : (
        options
          .sort((a, b) => {
            const nameA = (a.displayName || a.name || '').toLowerCase();
            const nameB = (b.displayName || b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
          })
          .map(stop => (
            <option key={stop.id} value={stop.id}>
              {cleanStopName(stop.displayName || stop.name)}
            </option>
          ))
      )}
    </select>
  );
};

export default StopDropdown;
