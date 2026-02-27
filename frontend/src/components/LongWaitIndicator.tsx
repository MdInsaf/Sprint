import { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import './long-wait-indicator.css';

const LONG_WAIT_MS = 2000;
const LIGHT_WAIT_MS = 0;
const MIN_VISIBLE_MS = 900;
const ACTIVE_GAP_MS = 900;

interface LongWaitIndicatorProps {
  resetKey?: string;
  statusLabel?: string;
}

export function LongWaitIndicator({ resetKey, statusLabel }: LongWaitIndicatorProps) {
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });
  const fetchingCount = useIsFetching({
    predicate: (query) => {
      const isObserved = query.getObserversCount() > 0;
      if (!isObserved) return false;
      if (query.state.fetchStatus !== 'fetching') return false;
      const hasNoData = query.state.data === undefined;
      const isPending = query.state.status === 'pending';
      return hasNoData || isPending;
    },
  });
  const rawActive = fetchingCount > 0;
  const [isActive, setIsActive] = useState(rawActive);
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);
  const isActiveRef = useRef(isActive);
  const resetCycleRef = useRef(0);
  const deactivationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDarkTheme(root.classList.contains('dark'));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (rawActive) {
      if (deactivationTimerRef.current !== null) {
        window.clearTimeout(deactivationTimerRef.current);
        deactivationTimerRef.current = null;
      }
      setIsActive(true);
      return;
    }

    if (deactivationTimerRef.current !== null) {
      window.clearTimeout(deactivationTimerRef.current);
    }
    deactivationTimerRef.current = window.setTimeout(() => {
      deactivationTimerRef.current = null;
      setIsActive(false);
    }, ACTIVE_GAP_MS);
  }, [rawActive]);

  useEffect(() => {
    return () => {
      if (deactivationTimerRef.current !== null) {
        window.clearTimeout(deactivationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    resetCycleRef.current += 1;
    if (!isActiveRef.current) {
      shownAtRef.current = 0;
      setVisible(false);
    }
  }, [resetKey]);

  useEffect(() => {
    if (!isActive || visible) {
      return;
    }

    const cycleAtSchedule = resetCycleRef.current;
    const waitMs = isDarkTheme ? LONG_WAIT_MS : LIGHT_WAIT_MS;
    const timer = window.setTimeout(() => {
      if (!isActiveRef.current) return;
      if (resetCycleRef.current !== cycleAtSchedule) return;
      shownAtRef.current = Date.now();
      setVisible(true);
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [isActive, visible, isDarkTheme]);

  useEffect(() => {
    if (isActive || !visible) {
      return;
    }

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const hide = () => {
      setVisible(false);
    };

    if (remaining === 0) {
      hide();
      return;
    }

    const timer = window.setTimeout(hide, remaining);
    return () => window.clearTimeout(timer);
  }, [isActive, visible]);

  if (!visible || !isActive) {
    return null;
  }

  const label = statusLabel || 'Loading data...';

  if (!isDarkTheme) {
    const heights = [1, 2, 3];
    const widths = [1, 2, 3];
    const lengths = [1, 2, 3];
    return (
      <div className="cube-loading" aria-live="polite" aria-label={label}>
        <div className="cube-loader" aria-hidden="true">
          {heights.map((h) => (
            <div key={`h-${h}`} className={`h${h}Container`}>
              {widths.map((w) =>
                lengths.map((l) => (
                  <div key={`cube-${h}-${w}-${l}`} className={`cube h${h} w${w} l${l}`}>
                    <div className="face top" />
                    <div className="face left" />
                    <div className="face right" />
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="long-wait-indicator" aria-live="polite" aria-label={label}>
      <div className="lwi-overlay">
        <div className="lwi-scene-wrap">
          <div className="lwi-scene">
            <div className="lwi-objects" aria-hidden="true">
              <div className="lwi-square" />
              <div className="lwi-circle" />
              <div className="lwi-triangle" />
            </div>

            <div className="lwi-wizard" aria-hidden="true">
              <div className="lwi-body" />
              <div className="lwi-right-arm">
                <div className="lwi-right-hand" />
              </div>
              <div className="lwi-left-arm">
                <div className="lwi-left-hand" />
              </div>
              <div className="lwi-head">
                <div className="lwi-beard" />
                <div className="lwi-face">
                  <div className="lwi-adds" />
                </div>
                <div className="lwi-hat">
                  <div className="lwi-hat-of-the-hat" />
                  <div className="lwi-four-point-star lwi-star-first" />
                  <div className="lwi-four-point-star lwi-star-second" />
                  <div className="lwi-four-point-star lwi-star-third" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lwi-progress" aria-hidden="true" />
        <div className="sr-only">{label}</div>
        <div className="lwi-noise" aria-hidden="true" />
      </div>
    </div>
  );
}
