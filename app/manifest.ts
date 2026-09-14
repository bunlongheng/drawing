import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Drawing - neon sketchpad",
    short_name: "Drawing",
    description: "A minimal neon sketchpad for Apple Pencil.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    // app/icon.png is served at /icon.png and is the single app identity,
    // shared with the local-apps dashboard and Stickies.
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
