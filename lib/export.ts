/** Saving and sharing the finished canvas. */

import { exportFilename } from "./neon";

export type ExportResult = "shared" | "downloaded" | "cancelled";

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

export function downloadBlob(blob: Blob, extension = "png"): string {
  const filename = exportFilename(new Date(), extension);
  download(blob, filename);
  return filename;
}

/** The file extension for a recorded clip, from its MIME type. */
export function clipExtension(type: string): string {
  return type.includes("mp4") ? "mp4" : "webm";
}

/**
 * Share via the native sheet when the platform supports sharing files
 * (iPadOS, iOS, Android). Falls back to a download everywhere else. A
 * dismissed sheet reports "cancelled" - nothing left the device, so telling
 * the user it was shared would be a lie.
 */
export async function shareBlob(blob: Blob, title: string): Promise<ExportResult> {
  const filename = exportFilename();
  const file = new File([blob], filename, { type: "image/png" });

  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Any other failure (permission, unsupported payload) falls through.
    }
  }

  download(blob, filename);
  return "downloaded";
}
