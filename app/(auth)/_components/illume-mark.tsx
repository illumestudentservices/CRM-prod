/**
 * The Illume mark — a wireframe globe seated on a lightbulb base.
 *
 * Rebuilt as SVG rather than using /logo.png: the raster asset is dark navy on
 * transparent and effectively disappears on a dark field, and this way the
 * filament can actually glow.
 */
export function IllumeMark({
  size = 44,
  glow = true,
  className,
}: {
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="illume-wire" x1="14" y1="6" x2="50" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7DD3FC" />
          <stop offset="0.55" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#0EA5E9" />
        </linearGradient>
        <linearGradient id="illume-base" x1="24" y1="46" x2="40" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BAE6FD" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
        <radialGradient id="illume-core" cx="0.5" cy="0.45" r="0.5">
          <stop stopColor="#F5A524" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#F5A524" stopOpacity="0.12" />
          <stop offset="1" stopColor="#F5A524" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Filament warmth inside the globe */}
      <circle cx="32" cy="27" r="17" fill="url(#illume-core)">
        {glow && (
          <animate
            attributeName="opacity"
            values="0.75;1;0.75"
            dur="4.5s"
            repeatCount="indefinite"
          />
        )}
      </circle>

      {/* Globe outline */}
      <circle cx="32" cy="27" r="17" stroke="url(#illume-wire)" strokeWidth="2.4" />
      {/* Meridians */}
      <ellipse cx="32" cy="27" rx="7.2" ry="17" stroke="url(#illume-wire)" strokeWidth="1.9" />
      {/* Equator + tropics */}
      <path d="M15 27h34" stroke="url(#illume-wire)" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M18.4 18.2h27.2M18.4 35.8h27.2" stroke="url(#illume-wire)" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />

      {/* Bulb base — stacked contacts, tapering */}
      <path d="M24.5 47.5h15" stroke="url(#illume-base)" strokeWidth="3.1" strokeLinecap="round" />
      <path d="M26 53h12" stroke="url(#illume-base)" strokeWidth="3.1" strokeLinecap="round" />
      <path d="M28.5 58.5h7" stroke="url(#illume-base)" strokeWidth="3.1" strokeLinecap="round" />
    </svg>
  );
}
