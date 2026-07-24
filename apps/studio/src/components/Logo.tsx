/** OpenReel brand mark (shared with the main app). Uses currentColor so it
 *  tints to the surrounding text color — set the parent to the brand green. */
export function Logo({ className = "", size }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 490 490"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
    >
      <path
        d="M245 24.5C123.223 24.5 24.5 123.223 24.5 245s98.723 220.5 220.5 220.5 220.5-98.723 220.5-220.5S366.777 24.5 245 24.5Z"
        stroke="currentColor"
        strokeWidth="30.625"
      />
      <g stroke="currentColor" strokeWidth="24.5" strokeLinecap="round">
        <path d="M245 98v73.5" />
        <path d="M392 245h-73.5" />
        <path d="M245 392v-73.5" />
        <path d="M98 245h73.5" />
        <path d="m348.941 141.059-51.965 51.965" />
        <path d="m348.941 348.941-51.965-51.965" />
        <path d="m141.059 348.941 51.965-51.965" />
        <path d="m141.059 141.059 51.965 51.965" />
      </g>
      <circle cx="245" cy="245" r="49" fill="currentColor" />
    </svg>
  );
}
