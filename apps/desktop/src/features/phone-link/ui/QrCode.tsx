/**
 * A QR code, drawn from path data the Rust side encoded.
 *
 * Deliberately **not** theme-aware. Scanners are trained on dark modules over a
 * light quiet zone, and an inverted code — light modules on the dark panel — is
 * read unreliably or refused outright by many camera apps. A QR that looks
 * wrong in dark mode still works; one that matches the theme might not. So the
 * white card is the feature, not an oversight.
 */

import type { QrImage } from "../model/phoneLink";

export function QrCode({ image, label }: { image: QrImage; label: string }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <svg
        aria-label={label}
        className="block h-[168px] w-[168px]"
        role="img"
        viewBox={`0 0 ${image.size} ${image.size}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* crispEdges keeps module boundaries hard at any scale; anti-aliased
            edges blur the small modules and cost scans in poor light. */}
        <path d={image.path} fill="#09090b" shapeRendering="crispEdges" />
      </svg>
    </div>
  );
}
