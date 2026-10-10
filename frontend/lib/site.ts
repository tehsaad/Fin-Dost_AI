/** Public site identity used for SEO metadata, sitemap, robots and structured data. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://findostai.vercel.app").replace(/\/+$/, "");
export const SITE_NAME = "FinDost AI";
export const SITE_TITLE = "FinDost AI — Cash-flow early warning for Pakistani shops & households";
export const SITE_DESCRIPTION =
  "Free digital khata and cash-flow forecasting for Pakistani shops, SMEs, households and students. FinDost AI warns you " +
  "before cash runs short, stress-tests shocks like late payments or price rises, and ranks recovery actions — in English and Urdu.";
export const SITE_KEYWORDS = [
  "digital khata", "udhaar app", "cash flow forecast", "SME Pakistan", "kiryana store app", "small business finance Pakistan",
  "cash shortage warning", "household budget Pakistan", "student budget", "Urdu finance app", "FinDost",
];
