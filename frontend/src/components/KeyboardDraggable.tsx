import { useState, useCallback } from 'react';
import { useAnnouncer } from '@/context/AnnouncerContext';

interface KeyboardDraggableProps {
  children: React.ReactNode;
  /** Label describing the draggable item for screen readers */
  ariaLabel: string;
  /** Available drop targets for keyboard navigation */
  dropTargets: { id: string; label: string }[];
  /** Called when the item is "dropped" on a target via keyboard */
  onKeyboardDrop: (targetId: string) => void;
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Wraps a draggable element to add keyboard navigation support.
 *
 * Controls:
 * - Enter/Space: Enter drag mode
 * - Arrow Left/Right: Navigate between drop targets
 * - Enter: Confirm drop on selected target
 * - Escape: Cancel drag mode
 */
export function KeyboardDraggable({
  children,
  ariaLabel,
  dropTargets,
  onKeyboardDrop,
  className = '',
}: KeyboardDraggableProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(0);
  const { announce } = useAnnouncer();

  const enterDragMode = useCallback(() => {
    if (dropTargets.length === 0) return;
    setIsDragging(true);
    setSelectedTargetIndex(0);
    announce(
      `Drag mode activated for ${ariaLabel}. Use left and right arrow keys to select a column, then press Enter to drop. Press Escape to cancel.`,
      'assertive'
    );
  }, [ariaLabel, dropTargets.length, announce]);

  const cancelDrag = useCallback(() => {
    setIsDragging(false);
    announce('Drag cancelled.', 'polite');
  }, [announce]);

  const confirmDrop = useCallback(() => {
    const target = dropTargets[selectedTargetIndex];
    if (!target) return;
    onKeyboardDrop(target.id);
    setIsDragging(false);
    announce(`Dropped ${ariaLabel} into ${target.label}.`, 'assertive');
  }, [dropTargets, selectedTargetIndex, onKeyboardDrop, ariaLabel, announce]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isDragging) {
        // Enter drag mode
        if (e.key === 'Enter' || e.key === ' ') {
          // Don't capture Enter/Space if it's on an interactive child (button, input, etc.)
          const tag = (e.target as HTMLElement).tagName?.toLowerCase();
          if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'a') {
            return;
          }
          e.preventDefault();
          enterDragMode();
        }
        return;
      }

      // In drag mode
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = Math.min(selectedTargetIndex + 1, dropTargets.length - 1);
          setSelectedTargetIndex(nextIndex);
          announce(`${dropTargets[nextIndex].label}`, 'polite');
          break;
        }
        case 'ArrowLeft':
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = Math.max(selectedTargetIndex - 1, 0);
          setSelectedTargetIndex(prevIndex);
          announce(`${dropTargets[prevIndex].label}`, 'polite');
          break;
        }
        case 'Enter': {
          e.preventDefault();
          confirmDrop();
          break;
        }
        case 'Escape': {
          e.preventDefault();
          cancelDrag();
          break;
        }
      }
    },
    [isDragging, enterDragMode, cancelDrag, confirmDrop, selectedTargetIndex, dropTargets, announce]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-roledescription="draggable item"
      aria-grabbed={isDragging}
      onKeyDown={handleKeyDown}
      className={`${className} ${isDragging ? 'ring-2 ring-primary ring-offset-2' : ''} outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`}
    >
      {children}
      {isDragging && (
        <div className="mt-1 flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs text-primary">
          <span className="font-medium">Drop target:</span>
          <span>{dropTargets[selectedTargetIndex]?.label}</span>
          <span className="ml-auto text-muted-foreground">← → to change, Enter to drop, Esc to cancel</span>
        </div>
      )}
    </div>
  );
}