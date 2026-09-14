"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NeonEngine, type Brush, type EngineState } from "@/lib/engine";
import { downloadBlob, shareBlob } from "@/lib/export";
import { DEFAULT_BRUSH, normaliseBrush } from "@/lib/neon";
import { Toolbar } from "./Toolbar";

const STORAGE_KEY = "drawing.brush";
const TOAST_MS = 2400;

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

  // Rendered client-side only (see NeonCanvasClient), so stored preferences can
  // seed the very first render without a hydration mismatch.
  const [brush, setBrush] = useState<Brush>(readStoredBrush);
  const [state, setState] = useState<EngineState>({
    canUndo: false,
    canRedo: false,
    isEmpty: true,
  });
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(brush));
    } catch {
      // Private browsing or a full quota - preferences just do not persist.
    }
  }, [brush]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Engine lifecycle + sizing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new NeonEngine(canvas, setState);
    engineRef.current = engine;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      engine.resize(rect.width, rect.height, window.devicePixelRatio);
    };
    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    window.addEventListener("resize", fit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const withEngine = useCallback(
    async (action: (engine: NeonEngine) => void | Promise<void>) => {
      const engine = engineRef.current;
      if (engine) await action(engine);
    },
    [],
  );

  const exportCanvas = useCallback(
    async (mode: "download" | "share") => {
      const engine = engineRef.current;
      if (!engine || busy) return;
      setBusy(true);
      try {
        const blob = await engine.toBlob();
        if (mode === "download") {
          downloadBlob(blob);
          setToast("Saved as PNG");
        } else {
          const result = await shareBlob(blob, "Neon drawing");
          setToast(result === "shared" ? "Shared" : "Saved as PNG");
        }
      } catch {
        setToast("Export failed - please try again");
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

    activePointer.current = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    setDrawing(true);

    const rect = canvas.getBoundingClientRect();
    const { x, y } = pointFrom(event.nativeEvent, rect);
    engine.begin(brush, x, y, event.pressure, event.pointerType === "pen");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const rect = canvas.getBoundingClientRect();
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
        aria-label="Neon drawing canvas"
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
        state={state}
        busy={busy}
        dimmed={drawing}
        onUndo={() => void withEngine((engine) => engine.undo())}
        onRedo={() => void withEngine((engine) => engine.redo())}
        onClear={() => void withEngine((engine) => engine.clear())}
        onDownload={() => void exportCanvas("download")}
        onShare={() => void exportCanvas("share")}
      />

      <p className="toast" role="status" aria-live="polite" data-show={toast ? "" : undefined}>
        {toast}
      </p>
    </main>
  );
}
