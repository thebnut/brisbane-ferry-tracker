import { useState, useEffect } from 'react';

// Re-renders the consumer at most once per wall-clock minute.
// Polls via rAF so there's no setInterval drift, but the functional
// setState short-circuits when the minute bucket hasn't changed, so
// React bails out of reconciliation on every frame except the rollover.
export default function useMinuteTick() {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));

  useEffect(() => {
    let rafId;
    const loop = () => {
      const next = Math.floor(Date.now() / 60000);
      setMinute(prev => (prev === next ? prev : next));
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return minute;
}
