import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // App pages stay crawlable so search engines can read their noindex tag; the API is never crawled.
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }], sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL };
}
