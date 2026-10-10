import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#059669", color: "white", fontSize: 110, fontWeight: 800, fontFamily: "sans-serif" }}>F</div>
    ),
    size,
  );
}
