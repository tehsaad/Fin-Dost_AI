import { ImageResponse } from "next/og";

export const alt = "FinDost AI — see cash trouble before it happens";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card (WhatsApp, Facebook, X, LinkedIn). Text only states what the product does. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: 72, background: "linear-gradient(135deg, #020617 0%, #052e2b 60%, #064e3b 100%)", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800 }}>F</div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>FinDost AI</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05 }}>See cash trouble before it happens.</div>
          <div style={{ fontSize: 30, color: "#a7f3d0" }}>Digital khata · 30-day forecast · early warnings · shock tests · recovery options</div>
        </div>
        <div style={{ fontSize: 26, color: "#94a3b8" }}>For Pakistani shops, households and students · English & Urdu · findostai.vercel.app</div>
      </div>
    ),
    size,
  );
}
