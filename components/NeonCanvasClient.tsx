"use client";

import dynamic from "next/dynamic";

/**
 * The whole app is a canvas, so server rendering it buys nothing and would
 * force the stored brush preferences to be applied in a second render pass.
 */
export const NeonCanvasClient = dynamic(
  () => import("./NeonCanvas").then((mod) => mod.NeonCanvas),
  { ssr: false, loading: () => <main className="stage" /> },
);
