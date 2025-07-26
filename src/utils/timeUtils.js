import { format, addHours, startOfHour, isSameDay, setHours } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Australia/Brisbane';

export const generateTimeSlots = () => {
  const now = toZonedTime(new Date(), TIMEZONE);
  
  // Start from current time + 2 hours, rounded down to nearest hour
  const startTime = startOfHour(addHours(now, 2));
  const startHour = startTime.getHours();
  
  const slots = [];
  let currentTime = startTime;
  
  // Determine end hour for today based on odd/even start hour
  const todayEndHour = startHour % 2 === 0 ? 22 : 23; // 10PM for even, 11PM for odd
  
  // Generate today's slots (2-hour intervals)
  while (currentTime.getHours() <= todayEndHour && isSameDay(currentTime, now)) {
    slots.push({
      type: 'slot',
      value: currentTime,
      label: format(currentTime, 'ha'),
      isToday: true
    });
    currentTime = addHours(currentTime, 2);
  }
  
  // Add separator if we have today's slots and will have tomorrow's slots
  if (slots.length > 0 && slots.length < 16) {
    slots.push({
      type: 'separator',
      value: null,
      label: 'Tmw...',
      isToday: false
    });
  }
  
  // Generate tomorrow's slots starting at 5AM
  const tomorrow = addHours(startOfHour(now), 24);
  currentTime = setHours(tomorrow, 5);
  
  // Continue until we have max 16 slots (including the separator)
  while (slots.length < 16) {
    slots.push({
      type: 'slot',
      value: currentTime,
      label: format(currentTime, 'ha'),
      isToday: false
    });
    currentTime = addHours(currentTime, 2);
  }
  
  return slots.slice(0, 16); // Ensure max 16 slots
};

export const formatTimeSlot = (date) => {
  if (!date) return 'Now';
  
  const zonedDate = toZonedTime(date, TIMEZONE);
  const now = toZonedTime(new Date(), TIMEZONE);
  
  if (isSameDay(zonedDate, now)) {
    return format(zonedDate, 'ha');
  } else {
    return `${format(zonedDate, 'ha')} (${format(zonedDate, 'dd/MM')})`;
  }
};