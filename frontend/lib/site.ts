/** Public site identity used for SEO metadata, sitemap, robots and structured data. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://findostai.vercel.app").replace(/\/+$/, "");
export const SITE_NAME = "FinDost AI";
export const SITE_TITLE = "FinDost AI — Cash-flow early warning for Pakistani shops & households";
export const SITE_DESCRIPTION =
  "Free digital khata and 30-day cash-flow forecasting for Pakistani shops, enterprises, households and students. FinDost AI " +
  "flags projected cash shortages, tests shocks like late payments or price rises, and compares recovery options — in English and Urdu.";
export const SITE_KEYWORDS = [
  "digital khata", "udhaar app", "cash flow forecast", "SME Pakistan", "kiryana store app", "small business finance Pakistan",
  "cash shortage warning", "household budget Pakistan", "student budget", "Urdu finance app", "FinDost",
];
