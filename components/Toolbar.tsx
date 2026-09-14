"use client";

import { useEffect, useState } from "react";
import type { Brush, EngineState } from "@/lib/engine";
import {
  COLORS,
  type NeonColor,
  MAX_SIZE,
  MIN_SIZE,
  STYLES,
  clamp,
  findColor,
  findStyle,
  inkColor,
  isGradient,
} from "@/lib/neon";
import { Popover } from "./Popover";
import { RadioGroup } from "./RadioGroup";
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
  /** Called when the first tap arms the confirm, so it can be announced. */
  onClearArmed: () => void;
  onDownload: () => void;
  onShare: () => void;
};

const CLEAR_ARM_MS = 2600;

/** CSS fill for an ink swatch: flat for a solid, a sweep for a gradient. */
function swatchFill(option: NeonColor): string {
  const from = inkColor(option.hsl, 0);
  if (!option.hsl2) return from;
  return `linear-gradient(135deg, ${from}, ${inkColor(option.hsl2, 0)})`;
}

export function Toolbar({
  brush,
  onBrushChange,
  state,
  busy,
  dimmed,
  onUndo,
  onRedo,
  onClear,
  onClearArmed,
  onDownload,
  onShare,
}: ToolbarProps) {
  const [clearArmed, setClearArmed] = useState(false);
  // Arming is only meaningful while there is something to clear.
  const armed = clearArmed && !state.isEmpty;
  const style = findStyle(brush.styleId);
  const color = findColor(brush.colorId);
  // Gradients light the chrome with their first stop.
  const accent = inkColor(color.hsl, 0);

  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), CLEAR_ARM_MS);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const handleClear = () => {
    if (!armed) {
      setClearArmed(true);
      onClearArmed();
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
        trigger={<StrokePreview style={style} colorId={color.id} width={36} height={26} />}
      >
        <RadioGroup
          label="Neon style"
          options={STYLES.map((option) => ({ id: option.id, label: option.name }))}
          value={style.id}
          onChange={(styleId) => onBrushChange({ styleId })}
          className="styles"
          optionClassName="swatch"
        >
          {(option) => {
            const preset = findStyle(option.id);
            return (
              <>
                <StrokePreview style={preset} colorId={color.id} />
                <span className="micro">{preset.name}</span>
              </>
            );
          }}
        </RadioGroup>
      </Popover>

      <Popover
        label={`Ink colour: ${color.name}`}
        accent={accent}
        trigger={
          <span
            className="block h-4 w-4 rounded-full"
            style={{ background: swatchFill(color), boxShadow: `0 0 12px 1px ${accent}` }}
          />
        }
      >
        <RadioGroup
          label="Ink colour"
          options={COLORS.map((option) => ({ id: option.id, label: option.name }))}
          value={color.id}
          onChange={(colorId) => onBrushChange({ colorId })}
          className="inks"
          optionClassName="dot"
          titleOnly
        >
          {(option) => {
            const ink = findColor(option.id);
            const glow = inkColor(ink.hsl, 0);
            return (
              <span
                className="block h-5 w-5 rounded-full"
                style={{
                  background: swatchFill(ink),
                  boxShadow: `0 0 14px 1px ${glow}`,
                  // A gradient ink gets a ring so it reads as two stops, not a blur.
                  outline: isGradient(ink) ? "1px solid rgba(255,255,255,0.28)" : undefined,
                  outlineOffset: "-1px",
                }}
              />
            );
          }}
        </RadioGroup>
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
