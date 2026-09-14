"use client";

import { useEffect, useState } from "react";
import type { Brush, EngineState } from "@/lib/engine";
import {
  COLORS,
  MAX_SIZE,
  MIN_SIZE,
  STYLES,
  clamp,
  findColor,
  findStyle,
  inkColor,
} from "@/lib/neon";
import { Popover } from "./Popover";
import { StrokePreview } from "./StrokePreview";
import {
  ClearIcon,
  DownloadIcon,
  RedoIcon,
  ShareIcon,
  SizeIcon,
  UndoIcon,
} from "./icons";

type ToolbarProps = {
  brush: Brush;
  onBrushChange: (patch: Partial<Brush>) => void;
  state: EngineState;
  busy: boolean;
  dimmed: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onDownload: () => void;
  onShare: () => void;
};

const CLEAR_ARM_MS = 2600;

export function Toolbar({
  brush,
  onBrushChange,
  state,
  busy,
  dimmed,
  onUndo,
  onRedo,
  onClear,
  onDownload,
  onShare,
}: ToolbarProps) {
  const [clearArmed, setClearArmed] = useState(false);
  // Arming is only meaningful while there is something to clear.
  const armed = clearArmed && !state.isEmpty;
  const style = findStyle(brush.styleId);
  const color = findColor(brush.colorId);
  const accent = inkColor(color.hsl, 0);

  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), CLEAR_ARM_MS);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const handleClear = () => {
    if (!armed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    onClear();
  };

  return (
    <div
      className="toolbar"
      data-dimmed={dimmed || undefined}
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <Popover
        label={`Neon style: ${style.name}`}
        accent={accent}
        trigger={<StrokePreview style={style} hsl={color.hsl} className="h-6 w-8" />}
      >
        <div role="radiogroup" aria-label="Neon style" className="grid grid-cols-3 gap-1">
          {STYLES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === style.id}
              onClick={() => onBrushChange({ styleId: option.id })}
              className="swatch"
              data-active={option.id === style.id || undefined}
            >
              <StrokePreview style={option} hsl={color.hsl} className="h-7 w-11" />
              <span className="micro">{option.name}</span>
            </button>
          ))}
        </div>
      </Popover>

      <Popover
        label={`Ink colour: ${color.name}`}
        accent={accent}
        trigger={
          <span
            className="block h-4 w-4 rounded-full"
            style={{ background: accent, boxShadow: `0 0 12px 1px ${accent}` }}
          />
        }
      >
        <div role="radiogroup" aria-label="Ink colour" className="flex gap-1.5">
          {COLORS.map((option) => {
            const css = inkColor(option.hsl, 0);
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === color.id}
                aria-label={option.name}
                title={option.name}
                onClick={() => onBrushChange({ colorId: option.id })}
                className="dot"
                data-active={option.id === color.id || undefined}
              >
                <span
                  className="block h-5 w-5 rounded-full"
                  style={{ background: css, boxShadow: `0 0 14px 1px ${css}` }}
                />
              </button>
            );
          })}
        </div>
      </Popover>

      <Popover
        label={`Brush size: ${brush.size}`}
        accent={accent}
        trigger={<SizeIcon className="h-5 w-5" />}
      >
        <div className="flex w-56 items-center gap-3">
          <input
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            value={brush.size}
            aria-label="Brush size"
            onChange={(event) =>
              onBrushChange({
                size: clamp(Number(event.target.value), MIN_SIZE, MAX_SIZE),
              })
            }
            className="range"
            style={{ accentColor: accent }}
          />
          <span className="micro tabular-nums w-6 text-right">{brush.size}</span>
        </div>
      </Popover>

      <span className="divider" aria-hidden />

      <button
        type="button"
        className="tool-btn"
        onClick={onUndo}
        disabled={!state.canUndo}
        aria-label="Undo"
        title="Undo"
      >
        <UndoIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={onRedo}
        disabled={!state.canRedo}
        aria-label="Redo"
        title="Redo"
      >
        <RedoIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={handleClear}
        disabled={state.isEmpty}
        aria-label={armed ? "Confirm clear canvas" : "Clear canvas"}
        title="Clear"
        data-armed={armed || undefined}
      >
        <ClearIcon className="h-5 w-5" />
      </button>

      <span className="divider" aria-hidden />

      <button
        type="button"
        className="tool-btn"
        onClick={onDownload}
        disabled={state.isEmpty || busy}
        aria-label="Download PNG"
        title="Download"
      >
        <DownloadIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={onShare}
        disabled={state.isEmpty || busy}
        aria-label="Share"
        title="Share"
      >
        <ShareIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
