import type { Metadata } from "next";
import Landing from "@/components/landing/landing";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

// Structured data for search engines (describes only what the product actually does).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, inLanguage: ["en", "ur"],
    },
    {
      "@type": "SoftwareApplication", "@id": `${SITE_URL}/#app`, name: SITE_NAME, url: SITE_URL,
      applicationCategory: "FinanceApplication", operatingSystem: "Web browser",
      description: SITE_DESCRIPTION, inLanguage: ["en", "ur"],
      offers: { "@type": "Offer", price: "0", priceCurrency: "PKR" },
      featureList: [
        "Digital khata with customer credit (udhaar) and supplier bills",
        "30-day cash-flow forecast with back-tested model selection",
        "Early warnings with the records behind each alert",
        "Shock simulator: sales drop, late payments, price and rent increases",
        "Recovery options priced by re-running the forecast",
        "CSV import and printable reports",
        "Budget vs actual, savings goals and data checks",
        "Proposed actions with owner approval and team roles (enterprise)",
        "Copilot answers in English and Urdu; Roman Urdu wording when AI assistance is switched on",
      ],
    },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing />
    </>
  );
}
