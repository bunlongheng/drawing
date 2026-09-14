"use client";

/**
 * The canvas engine throws if a 2D context cannot be created - a WebView with
 * canvas disabled, or Safari refusing another canvas once its memory budget is
 * spent. Without this the tree unmounts to a blank black page with no message.
 */
export default function Error({ reset }: { error: globalThis.Error; reset: () => void }) {
  return (
    <main className="stage fallback">
      <h1>Canvas unavailable</h1>
      <p>
        This browser would not give the app a drawing surface. Close some tabs and try
        again, or open it in Safari, Chrome or Firefox.
      </p>
      <button type="button" onClick={reset} className="tool-btn fallback-retry">
        Try again
      </button>
    </main>
  );
}
