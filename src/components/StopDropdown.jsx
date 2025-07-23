import React from 'react';

const StopDropdown = ({ 
  value, 
  onChange, 
  options, 
  disabled = false, 
  placeholder = "Select stop",
  className = "" 
}) => {
  // Helper function to remove 'ferry terminal' from stop names
  const cleanStopName = (name) => name ? name.replace(' ferry terminal', '') : '';

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`px-3 py-2 bg-white border border-gray-300 rounded-lg text-ferry-aqua font-semibold
                  hover:border-ferry-orange focus:border-ferry-orange focus:ring-2 focus:ring-ferry-orange focus:ring-opacity-20
                  transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {options.length === 0 ? (
        <option value="">{placeholder}</option>
      ) : (
        options
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(stop => (
            <option key={stop.id} value={stop.id}>
              {cleanStopName(stop.name)}
            </option>
          ))
      )}
    </select>
  );
};

export default StopDropdown;