import React, { useMemo } from 'react';
import clsx from 'clsx';
import { generateTimeSlots } from '../utils/timeUtils';

const DepartureTimeDropdown = ({ 
  value, 
  onChange, 
  disabled = false, 
  className = '',
  compact = false 
}) => {
  const timeSlots = useMemo(() => generateTimeSlots(), []);
  
  const handleChange = (e) => {
    const selectedValue = e.target.value;
    if (selectedValue === '') {
      onChange(null);
    } else {
      const slot = timeSlots.find(s => s.value && s.value.toISOString() === selectedValue);
      onChange(slot ? slot.value : null);
    }
  };

  return (
    <div className={clsx('flex items-center', className)}>
      {(
        <span className={clsx(
          "text-ferry-aqua font-medium mr-2",
          compact ? "text-xs" : "text-sm"
        )}>Depart from:</span>
      )}
      <select
        value={value ? value.toISOString() : ''}
        onChange={handleChange}
        disabled={disabled}
        className={clsx(
          'form-select rounded-lg border-2 transition-all duration-200',
          'bg-white focus:ring-2 focus:ring-ferry-orange focus:border-ferry-orange',
          disabled 
            ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-60' 
            : 'border-ferry-orange/30 text-ferry-aqua hover:border-ferry-orange cursor-pointer',
          compact ? 'px-2 py-1 text-xs font-medium' : 'px-4 py-2 text-sm font-semibold',
          'appearance-none bg-no-repeat bg-right',
          'pr-10'
        )}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23FF6B35' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.5rem center',
          backgroundSize: '1.5em 1.5em'
        }}
      >
        <option value="">Now</option>
        {timeSlots.map((slot, index) => {
          if (slot.type === 'separator') {
            return (
              <option key={index} value="" disabled className="text-gray-500 font-normal italic">
                {slot.label}
              </option>
            );
          }
          return (
            <option key={index} value={slot.value.toISOString()}>
              {slot.label}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default DepartureTimeDropdown;
