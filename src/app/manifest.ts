import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DukaanOS — Munshi",
    short_name: "DukaanOS",
    description: "Voice + parchi khata · SHA-256 hash-chained · Zero FBR linkage",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F2F2F7",
    theme_color: "#F2F2F7",
    lang: "ur-PK",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/?share=parchi",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: "parchi",
            accept: ["image/*"],
          },
        ],
      },
    },
  };
}
