/** Saving and sharing the finished canvas. */

import { exportFilename } from "./neon";

export type ExportResult = "shared" | "downloaded";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so Safari has the object URL when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlob(blob: Blob): string {
  const filename = exportFilename();
  download(blob, filename);
  return filename;
}

/**
 * Share via the native sheet when the platform supports sharing files
 * (iPadOS, iOS, Android). Falls back to a download everywhere else, and when
 * the user dismisses the sheet we simply do nothing.
 */
export async function shareBlob(blob: Blob, title: string): Promise<ExportResult> {
  const filename = exportFilename();
  const file = new File([blob], filename, { type: "image/png" });

  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
      // Any other failure (permission, unsupported payload) falls through.
    }
  }

  download(blob, filename);
  return "downloaded";
}
