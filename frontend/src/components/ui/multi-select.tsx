import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
  variant?: 'popover' | 'inline';
  label?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

const MAX_BADGE_LABELS = 2;

function buildDisplayLabel(
  options: MultiSelectOption[],
  selected: string[],
  placeholder?: string,
  allLabel?: string
) {
  if (selected.length === 0) {
    return placeholder || allLabel || 'All';
  }
  const selectedLabels = selected.map((value) => {
    const match = options.find((opt) => opt.value === value);
    return match ? match.label : value;
  });
  if (selectedLabels.length <= MAX_BADGE_LABELS) {
    return selectedLabels.join(', ');
  }
  return `${selectedLabels.slice(0, MAX_BADGE_LABELS).join(', ')} +${selectedLabels.length - MAX_BADGE_LABELS}`;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel = 'All',
  disabled,
  variant = 'popover',
  label,
  className,
  triggerClassName,
  contentClassName,
}: MultiSelectProps) {
  const normalizedOptions = options.filter((opt) => opt.value);
  const selected = Array.from(new Set(value));
  const displayLabel = buildDisplayLabel(normalizedOptions, selected, placeholder, allLabel);

  const toggleValue = (optionValue: string) => {
    if (disabled) return;
    if (selected.includes(optionValue)) {
      onChange(selected.filter((item) => item !== optionValue));
      return;
    }
    const next = [...selected, optionValue];
    const allSelected =
      normalizedOptions.length > 0 &&
      normalizedOptions.every((opt) => next.includes(opt.value));
    onChange(allSelected ? [] : next);
  };

  const clearSelection = () => {
    if (!disabled) onChange([]);
  };

  const listContent = (
    <div className="space-y-1">
      <button
        type="button"
        onClick={clearSelection}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary/60"
        disabled={disabled}
      >
        <Checkbox
          checked={
            selected.length === 0 ||
            (normalizedOptions.length > 0 &&
              normalizedOptions.every((opt) => selected.includes(opt.value)))
          }
        />
        <span className="truncate">{allLabel}</span>
      </button>
      <Separator />
      {normalizedOptions.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground">No options available</div>
      ) : (
        <div className="max-h-52 overflow-y-auto pr-2">
          <div className="space-y-1 pb-2">
            {normalizedOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleValue(opt.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary/60"
                disabled={disabled}
              >
                <Checkbox checked={selected.includes(opt.value)} />
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={cn('space-y-2', className)}>
        {label && (
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        )}
        {listContent}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('justify-between gap-2', triggerClassName)}
          disabled={disabled}
        >
          <span className="truncate text-left">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-56 p-2', contentClassName)} align="start">
        {listContent}
      </PopoverContent>
    </Popover>
  );
}
