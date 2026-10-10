import { TURNSTILE_ORIGIN, TURNSTILE_SRC } from "./turnstile-src";

/**
 * Server-rendered hints for pages with a Cloudflare Turnstile captcha: connect to Cloudflare and start downloading
 * the captcha script while the app's JavaScript loads, instead of after the page becomes interactive.
 * React hoists these into <head> and de-duplicates them.
 */
export function CaptchaPreload() {
  if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return null;
  return (
    <>
      <link rel="preconnect" href={TURNSTILE_ORIGIN} />
      <script src={TURNSTILE_SRC} async />
    </>
  );
}
