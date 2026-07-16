import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — BJ&C
// Baeztechno Solution red rounded square + white chat-square glyph —
// matching the sidebar logo in `src/components/layout/sidebar.tsx` and
// the --primary token of the "bjc" theme in globals.css (see the
// `brand-mmd` skill for the source palette). Next.js renders this at
// build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#C8102E", // BJ&C brand primary — rojo tecnológico
          borderRadius: 6,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
