/**
 * Just enough of the canvas API for NeonEngine to run under Vitest's node
 * environment. Stubbing it here keeps jsdom (and the native `canvas` package)
 * out of the dependency list - the engine only needs these calls to exist, and
 * the assertions are about its state machine, not its pixels.
 */

export type StubCanvas = { width: number; height: number };

const CONTEXT_METHODS = [
  "setTransform",
  "clearRect",
  "fillRect",
  "drawImage",
  "beginPath",
  "moveTo",
  "lineTo",
  "stroke",
  "save",
  "restore",
  "rect",
  "clip",
] as const;

function makeContext(canvas: StubCanvas) {
  const ctx: Record<string, unknown> = { canvas };
  for (const name of CONTEXT_METHODS) ctx[name] = () => {};
  return ctx;
}

/** Installs the globals the engine reads. Returns a teardown function. */
export function installCanvasStub(): () => void {
  const frames: Array<() => void> = [];

  const globals = {
    document: {
      createElement(tag: string) {
        if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
        const canvas: StubCanvas & { getContext: () => unknown; toBlob: unknown } = {
          width: 0,
          height: 0,
          getContext: () => makeContext(canvas),
          toBlob: (cb: (blob: unknown) => void) => cb({ size: 1, type: "image/png" }),
        };
        return canvas;
      },
    },
    // Frames are run manually so tests stay deterministic.
    requestAnimationFrame: (cb: () => void) => frames.push(cb),
    cancelAnimationFrame: () => {},
    CanvasRenderingContext2D: function () {} as unknown,
  };

  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, (globalThis as Record<string, unknown>)[key]);
    (globalThis as Record<string, unknown>)[key] = value;
  }
  // `filter` decides whether the blurred passes run at all.
  (globals.CanvasRenderingContext2D as { prototype: Record<string, unknown> }).prototype = {
    filter: "none",
  };

  return () => {
    for (const [key, value] of previous) (globalThis as Record<string, unknown>)[key] = value;
  };
}

/** A display canvas to hand the engine. */
export function makeDisplay(): HTMLCanvasElement {
  const doc = (globalThis as unknown as { document: { createElement: (t: string) => unknown } })
    .document;
  return doc.createElement("canvas") as HTMLCanvasElement;
}
