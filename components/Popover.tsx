"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type PopoverProps = {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  /** Accent colour for the panel hairline, matching the active ink. */
  accent: string;
};

/**
 * Small anchored panel used by the style, colour and size controls. Closes on
 * outside pointer down and on Escape, and returns focus to its trigger.
 */
export function Popover({ label, trigger, children, accent }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    // Move focus into the panel: the trigger says aria-haspopup, so assistive
    // tech expects to land inside rather than having to tab forward.
    panelRef.current
      ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"], input, button')
      ?.focus();

    const close = (restoreFocus: boolean) => {
      const hadFocus = rootRef.current?.contains(document.activeElement);
      setOpen(false);
      if (restoreFocus || hadFocus) triggerRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="tool-btn"
        data-active={open || undefined}
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className="panel"
          style={{ boxShadow: `0 0 34px -12px ${accent}` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
