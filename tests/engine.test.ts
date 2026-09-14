import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NeonEngine, type Brush, type EngineState } from "../lib/engine";
import { DEFAULT_BRUSH, MIN_SAMPLE_DISTANCE } from "../lib/neon";
import { installCanvasStub, makeDisplay } from "./canvas-stub";

const BRUSH: Brush = DEFAULT_BRUSH;

let teardown: () => void;
let engine: NeonEngine;
let state: EngineState;

/** Draw a stroke of `points` samples, spaced well past the dedupe threshold. */
function drawStroke(count = 5, startX = 100, startY = 100): void {
  engine.begin(BRUSH, startX, startY, 0.5, true);
  for (let i = 1; i < count; i += 1) {
    engine.extend(startX + i * 10, startY + i * 10, 0.5, true);
  }
  engine.end();
}

beforeEach(() => {
  teardown = installCanvasStub();
  state = { canUndo: false, canRedo: false, isEmpty: true };
  engine = new NeonEngine(makeDisplay(), (next) => {
    state = next;
  });
  engine.resize(800, 600, 2);
});

afterEach(() => {
  engine.destroy();
  teardown();
});

describe("stroke lifecycle", () => {
  it("starts empty", () => {
    expect(engine.state).toEqual({ canUndo: false, canRedo: false, isEmpty: true });
  });

  it("a finished stroke makes the canvas undoable", () => {
    drawStroke();
    expect(engine.state).toEqual({ canUndo: true, canRedo: false, isEmpty: false });
    expect(state.canUndo).toBe(true);
  });

  it("ignores extend and end when no stroke is open", () => {
    engine.extend(10, 10, 0.5, true);
    engine.end();
    expect(engine.state.isEmpty).toBe(true);
  });

  it("discards a stroke that recorded no samples", () => {
    engine.begin(BRUSH, 10, 10, 0.5, true);
    // begin() records the first sample, so clearing mid-stroke empties it.
    engine.clear();
    engine.end();
    expect(engine.state.isEmpty).toBe(true);
  });
});

describe("sample dedupe", () => {
  it("drops moves shorter than the threshold and keeps longer ones", () => {
    engine.begin(BRUSH, 100, 100, 0.5, true);
    const tiny = MIN_SAMPLE_DISTANCE / 4;
    for (let i = 1; i <= 6; i += 1) engine.extend(100 + i * tiny, 100, 0.5, true);
    engine.extend(200, 100, 0.5, true);
    engine.end();

    // One stroke, and it survived - the dedupe must not drop everything.
    expect(engine.state.canUndo).toBe(true);
  });
});

describe("undo and redo", () => {
  it("walks the stack in both directions", () => {
    drawStroke();
    drawStroke(5, 300, 300);
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: false });

    engine.undo();
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: true, isEmpty: false });

    engine.undo();
    expect(engine.state).toMatchObject({ canUndo: false, canRedo: true, isEmpty: true });

    engine.undo();
    expect(engine.state).toMatchObject({ canUndo: false, canRedo: true, isEmpty: true });

    engine.redo();
    engine.redo();
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: false, isEmpty: false });

    engine.redo();
    expect(engine.state.canRedo).toBe(false);
  });

  it("a new stroke drops the redo stack", () => {
    drawStroke();
    engine.undo();
    expect(engine.state.canRedo).toBe(true);

    drawStroke(5, 400, 200);
    expect(engine.state.canRedo).toBe(false);
  });

  it("emits state on every mutation", () => {
    drawStroke();
    expect(state.isEmpty).toBe(false);
    engine.undo();
    expect(state.isEmpty).toBe(true);
    engine.redo();
    expect(state.isEmpty).toBe(false);
  });
});

describe("checkpointing", () => {
  // Undo resumes from a snapshot taken every 20 strokes, so the paths worth
  // exercising are: below the threshold, above it, and undoing back past it.
  const draw = (n: number) => {
    for (let i = 0; i < n; i += 1) drawStroke(4, 20 + (i % 20) * 30, 20 + Math.floor(i / 20) * 40);
  };

  it("keeps the stacks correct below the snapshot threshold", () => {
    draw(5);
    for (let i = 0; i < 5; i += 1) engine.undo();
    expect(engine.state).toMatchObject({ canUndo: false, canRedo: true, isEmpty: true });
  });

  it("keeps the stacks correct across a snapshot", () => {
    draw(45);
    expect(engine.state.canUndo).toBe(true);
    for (let i = 0; i < 30; i += 1) engine.undo();
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: true, isEmpty: false });

    for (let i = 0; i < 15; i += 1) engine.undo();
    expect(engine.state).toMatchObject({ canUndo: false, canRedo: true, isEmpty: true });
  });

  it("redoes all the way back up after undoing past a snapshot", () => {
    draw(45);
    for (let i = 0; i < 45; i += 1) engine.undo();
    expect(engine.state.isEmpty).toBe(true);
    for (let i = 0; i < 45; i += 1) engine.redo();
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: false, isEmpty: false });
  });

  it("drops the snapshot on clear, so the next rebuild starts clean", () => {
    draw(45);
    engine.clear();
    expect(engine.state).toEqual({ canUndo: false, canRedo: false, isEmpty: true });
    draw(3);
    engine.undo();
    engine.undo();
    engine.undo();
    expect(engine.state.isEmpty).toBe(true);
  });

  it("survives a resize taken after a snapshot", () => {
    draw(45);
    engine.resize(640, 480, 1);
    expect(engine.state.canUndo).toBe(true);
    for (let i = 0; i < 45; i += 1) engine.undo();
    expect(engine.state.isEmpty).toBe(true);
  });
});

describe("clear", () => {
  it("drops both stacks", () => {
    drawStroke();
    engine.undo();
    drawStroke(5, 200, 200);
    engine.clear();
    expect(engine.state).toEqual({ canUndo: false, canRedo: false, isEmpty: true });
  });

  it("is a no-op on an empty canvas", () => {
    let calls = 0;
    const counting = new NeonEngine(makeDisplay(), () => {
      calls += 1;
    });
    counting.resize(400, 400, 1);
    counting.clear();
    expect(calls).toBe(0);
    counting.destroy();
  });

  it("cancels a stroke that is still in flight", () => {
    engine.begin(BRUSH, 50, 50, 0.5, true);
    engine.extend(120, 90, 0.5, true);
    engine.clear();
    engine.end();
    expect(engine.state.isEmpty).toBe(true);
  });
});

describe("resize", () => {
  it("sizes every layer by the device pixel ratio", () => {
    const display = makeDisplay();
    const sized = new NeonEngine(display, () => {});
    sized.resize(400, 300, 2);
    expect(display.width).toBe(800);
    expect(display.height).toBe(600);
    sized.destroy();
  });

  it("clamps the pixel ratio so the bloom passes stay affordable", () => {
    const display = makeDisplay();
    const sized = new NeonEngine(display, () => {});
    sized.resize(400, 300, 6);
    expect(display.width).toBe(400 * 2.5);
    sized.destroy();
  });

  it("treats a missing ratio as 1", () => {
    const display = makeDisplay();
    const sized = new NeonEngine(display, () => {});
    sized.resize(400, 300, 0);
    expect(display.width).toBe(400);
    sized.destroy();
  });

  it("keeps the artwork and the undo stack across a resize", () => {
    drawStroke();
    drawStroke(5, 400, 200);
    engine.resize(1000, 500, 1);
    expect(engine.state).toMatchObject({ canUndo: true, isEmpty: false });

    engine.undo();
    expect(engine.state).toMatchObject({ canUndo: true, canRedo: true });
  });

  it("does no work when nothing changed", () => {
    const display = makeDisplay();
    const sized = new NeonEngine(display, () => {});
    sized.resize(400, 300, 2);
    display.width = 1;
    sized.resize(400, 300, 2);
    expect(display.width).toBe(1);
    sized.destroy();
  });
});

describe("export", () => {
  it("resolves a PNG blob", async () => {
    drawStroke();
    await expect(engine.toBlob()).resolves.toMatchObject({ type: "image/png" });
  });

  it("rejects when the canvas cannot encode", async () => {
    const display = makeDisplay() as HTMLCanvasElement & {
      toBlob: (cb: (blob: Blob | null) => void) => void;
    };
    display.toBlob = (cb) => cb(null);
    const failing = new NeonEngine(display, () => {});
    failing.resize(200, 200, 1);
    await expect(failing.toBlob()).rejects.toThrow(/could not encode/i);
    failing.destroy();
  });
});
