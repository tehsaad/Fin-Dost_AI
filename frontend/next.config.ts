import type { NextConfig } from "next";

// The browser always calls /api/v1/* on this origin; Next.js proxies it to the
// FastAPI backend, so there is no CORS and the backend URL stays configurable.
const configuredApiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
// A Vercel build without API_URL would silently proxy every API call to localhost; fail the build instead.
if (process.env.VERCEL && !configuredApiUrl) {
  throw new Error("API_URL must be set for Vercel builds (the FastAPI backend base URL).");
}
const API_URL = (configuredApiUrl || "http://localhost:8000").replace(/\/+$/, "");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Local dev against a distant database can exceed the default 30s proxy timeout.
  experimental: { proxyTimeout: Number(process.env.PROXY_TIMEOUT_MS) || 30_000 },
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
