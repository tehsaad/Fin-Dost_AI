import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME, short_name: "FinDost", description: SITE_DESCRIPTION, start_url: "/dashboard", display: "standalone",
    background_color: "#f8fafc", theme_color: "#059669", lang: "en",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  };
}
