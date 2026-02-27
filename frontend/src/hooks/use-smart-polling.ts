import { useEffect, useMemo, useRef, useState } from 'react';

type PollingInterval = number | false;

interface SmartPollingOptions {
  activeInterval?: number;
  idleInterval?: PollingInterval;
  inactiveInterval?: PollingInterval;
  idleTimeout?: number;
}

export function useSmartPolling(options: SmartPollingOptions = {}): PollingInterval {
  const {
    activeInterval = 15000,
    idleInterval = 60000,
    inactiveInterval = false,
    idleTimeout = 60000,
  } = options;

  const [isVisible, setIsVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );
  const [isIdle, setIsIdle] = useState(false);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      setIsIdle((prev) => (prev ? false : prev));
    };

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];

    events.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true })
    );

    const interval = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor >= idleTimeout) {
        setIsIdle((prev) => (prev ? prev : true));
      }
    }, 10000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      window.clearInterval(interval);
    };
  }, [idleTimeout]);

  return useMemo(() => {
    if (!isVisible) return inactiveInterval;
    if (isIdle) return idleInterval;
    return activeInterval;
  }, [activeInterval, idleInterval, inactiveInterval, isIdle, isVisible]);
}
