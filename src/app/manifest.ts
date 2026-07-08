import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alliance HQ",
    short_name: "Alliance HQ",
    description: "Alliance tools for Last War — built on ashed.online.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/brand/hq-icon-app.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
