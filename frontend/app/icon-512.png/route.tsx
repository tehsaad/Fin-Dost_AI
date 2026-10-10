import { ImageResponse } from "next/og";

export const dynamic = "force-static";

/** 512px PNG app icon for the web manifest (install to home screen). */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#059669", color: "white", fontSize: 300, fontWeight: 800, fontFamily: "sans-serif", borderRadius: 96 }}>F</div>
    ),
    { width: 512, height: 512 },
  );
}
