"use client";

import { useRef, type ReactNode } from "react";

export type RadioOption = { id: string; label: string };

type RadioGroupProps<T extends RadioOption> = {
  label: string;
  options: T[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  children: (option: T, checked: boolean) => ReactNode;
  /** Class applied to each option button. */
  optionClassName: string;
  /** Options get a visible label, so a title is only needed when they do not. */
  titleOnly?: boolean;
};

/**
 * ARIA radio group with roving tabindex and arrow-key selection.
 *
 * Announcing `role="radio"` without honouring the arrow keys is worse than not
 * using the role at all, and this pattern is needed by both the style and the
 * ink picker.
 */
export function RadioGroup<T extends RadioOption>({
  label,
  options,
  value,
  onChange,
  className,
  children,
  optionClassName,
  titleOnly,
}: RadioGroupProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.id);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [options.indexOf(next)]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    if (event.key in steps) {
      event.preventDefault();
      move(steps[event.key]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? options[0] : options[options.length - 1];
      onChange(target.id);
      groupRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        [options.indexOf(target)]?.focus();
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={className}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={titleOnly ? option.label : undefined}
            title={titleOnly ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={optionClassName}
            data-active={checked || undefined}
          >
            {children(option, checked)}
          </button>
        );
      })}
    </div>
  );
}
