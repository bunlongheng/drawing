"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NeonEngine, type Brush, type EngineState } from "@/lib/engine";
import { downloadBlob, shareBlob } from "@/lib/export";
import {
  DEFAULT_EFFECT_ID,
  type EffectId,
  findEffect,
} from "@/lib/effects";
import { DEFAULT_BRUSH, normaliseBrush } from "@/lib/neon";
import { REPLAY_SPEEDS, Toolbar } from "./Toolbar";

const STORAGE_KEY = "drawing.brush";
const EFFECT_KEY = "drawing.effect";
const SPEED_KEY = "drawing.speed";
const TOAST_MS = 2400;

/** Animation is motion; honour the system setting and stay still. */
function prefersStill(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function readStoredEffect(): EffectId {
  if (prefersStill()) return "off";
  try {
    return findEffect(window.localStorage.getItem(EFFECT_KEY) ?? DEFAULT_EFFECT_ID).id;
  } catch {
    return DEFAULT_EFFECT_ID;
  }
}

function readStoredSpeed(): number {
  try {
    const stored = Number(window.localStorage.getItem(SPEED_KEY));
    return REPLAY_SPEEDS.includes(stored as (typeof REPLAY_SPEEDS)[number]) ? stored : 1;
  } catch {
    return 1;
  }
}

function readStoredBrush(): Brush {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normaliseBrush(JSON.parse(raw)) : DEFAULT_BRUSH;
  } catch {
    return DEFAULT_BRUSH;
  }
}

export function NeonCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeonEngine | null>(null);
  const activePointer = useRef<number | null>(null);
  const penSeen = useRef(false);
  /** Cached at pointerdown: the canvas is fixed, so it cannot move mid-stroke. */
  const canvasRect = useRef<DOMRect | null>(null);

  // Rendered client-side only (see NeonCanvasClient), so stored preferences can
  // seed the very first render without a hydration mismatch.
  const [brush, setBrush] = useState<Brush>(readStoredBrush);
  const [effectId, setEffectId] = useState<EffectId>(readStoredEffect);
  const [replaySpeed, setReplaySpeed] = useState<number>(readStoredSpeed);
  const [state, setState] = useState<EngineState>({
    canUndo: false,
    canRedo: false,
    isEmpty: true,
    replaying: false,
  });
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone?: "error" } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(brush));
      window.localStorage.setItem(EFFECT_KEY, effectId);
      window.localStorage.setItem(SPEED_KEY, String(replaySpeed));
    } catch {
      // Private browsing or a full quota - preferences just do not persist.
    }
  }, [brush, effectId, replaySpeed]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Engine lifecycle + sizing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new NeonEngine(canvas, setState);
    engineRef.current = engine;

    // Resizing replays every stroke, so a burst of observer callbacks during a
    // rotation or a Split View drag is collapsed into one replay per frame.
    let pending = 0;
    const fit = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const rect = canvas.getBoundingClientRect();
        canvasRect.current = rect;
        engine.resize(rect.width, rect.height, window.devicePixelRatio);
      });
    };

    engine.setEffect(effectId);

    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    fit();

    return () => {
      if (pending) cancelAnimationFrame(pending);
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
    // The effect is pushed on mount and kept in step by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setEffect(effectId);
  }, [effectId]);

  const withEngine = useCallback(
    async (action: (engine: NeonEngine) => void | Promise<void>) => {
      const engine = engineRef.current;
      if (engine) await action(engine);
    },
    [],
  );

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.state.replaying) engine.stopReplay();
    else engine.startReplay(replaySpeed);
  }, [replaySpeed]);

  const exportCanvas = useCallback(
    async (mode: "download" | "share") => {
      const engine = engineRef.current;
      if (!engine || busy) return;
      setBusy(true);
      try {
        const blob = await engine.toBlob();
        if (mode === "download") {
          downloadBlob(blob);
          setToast({ text: "Saved as PNG" });
        } else {
          const result = await shareBlob(blob, "Neon drawing");
          // A dismissed share sheet needs no announcement.
          if (result === "shared") setToast({ text: "Shared" });
          else if (result === "downloaded") setToast({ text: "Saved as PNG" });
        }
      } catch {
        setToast({ text: "Export failed - please try again", tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // Keyboard shortcuts. Ignored while focus is in a form control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        void withEngine((engine) => (event.shiftKey ? engine.redo() : engine.undo()));
      } else if (key === "s") {
        event.preventDefault();
        void exportCanvas("download");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [withEngine, exportCanvas]);

  const shouldIgnore = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "pen") {
      penSeen.current = true;
      return false;
    }
    // Once a Pencil has been used, treat every touch as a resting palm.
    if (event.pointerType === "touch" && penSeen.current) return true;
    return event.pointerType === "mouse" && event.button !== 0;
  };

  const pointFrom = (event: { clientX: number; clientY: number }, rect: DOMRect) => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== null || shouldIgnore(event)) return;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    if (engine.state.replaying) engine.stopReplay();

    activePointer.current = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    setDrawing(true);

    const rect = canvas.getBoundingClientRect();
    canvasRect.current = rect;
    const { x, y } = pointFrom(event.nativeEvent, rect);
    engine.begin(brush, x, y, event.pressure, event.pointerType === "pen");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    // Reusing the pointerdown rect avoids a layout flush on every one of the
    // 120 move events a Pencil delivers each second.
    const rect = canvasRect.current ?? canvas.getBoundingClientRect();
    const isPen = event.pointerType === "pen";
    // Coalesced events carry the full 120Hz Pencil sample rate.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = events.length > 0 ? events : [event.nativeEvent];
    for (const sample of samples) {
      const { x, y } = pointFrom(sample, rect);
      engine.extend(x, y, sample.pressure, isPen);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    setDrawing(false);
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    engineRef.current?.end();
  };

  return (
    <main className="stage">
      <canvas
        ref={canvasRef}
        className="surface"
        aria-label={
          state.isEmpty
            ? "Neon drawing canvas, empty. Draw with a pencil, finger or mouse."
            : "Neon drawing canvas, drawn on. Draw with a pencil, finger or mouse."
        }
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(event) => event.preventDefault()}
      />

      {state.isEmpty && !drawing && (
        <p className="hint" aria-hidden>
          Draw
        </p>
      )}

      <Toolbar
        brush={brush}
        onBrushChange={(patch) => setBrush((current) => ({ ...current, ...patch }))}
        effectId={effectId}
        onEffectChange={setEffectId}
        replaySpeed={replaySpeed}
        onReplaySpeedChange={setReplaySpeed}
        onTogglePlay={togglePlay}
        state={state}
        busy={busy}
        dimmed={drawing}
        onUndo={() => void withEngine((engine) => engine.undo())}
        onRedo={() => void withEngine((engine) => engine.redo())}
        onClear={() => void withEngine((engine) => engine.clear())}
        onClearArmed={() => setToast({ text: "Tap clear again to erase" })}
        onDownload={() => void exportCanvas("download")}
        onShare={() => void exportCanvas("share")}
      />

      <p
        className="toast"
        role="status"
        aria-live="polite"
        data-show={toast ? "" : undefined}
        data-tone={toast?.tone}
      >
        {toast?.text ?? ""}
      </p>
    </main>
  );
}
