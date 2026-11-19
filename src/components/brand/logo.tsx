import { BRAND_NAME, THEME } from "@/lib/theme";

/** The brand mark with the wordmark: Swell's wave mark, or Always Green's pine tile. */
export function Logo({ wordmark = true, className }: { wordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      {THEME === "swell" ? <SwellMark /> : <PineMark />}
      {wordmark && <span className="text-[17px] font-semibold tracking-[-0.01em]">{BRAND_NAME}</span>}
    </span>
  );
}

function PineMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M16 6l4.5 6.2h-2.4l4 5.4h-2.6l4.5 6H17.5V27h-3v-3.4H8l4.5-6H9.9l4-5.4h-2.4z" fill="#fff" />
    </svg>
  );
}

/** The mark from swell_logo.svg (wordmark set in type beside it). */
function SwellMark() {
  return (
    <svg viewBox="0 0 131.5 191.45" className="h-8 w-auto shrink-0" aria-hidden>
      <defs>
        <linearGradient id="swell-top" x1=".02" y1="49.11" x2="131.46" y2="49.11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#30aee3" />
          <stop offset="1" stopColor="#57c2bb" />
        </linearGradient>
        <linearGradient id="swell-mid" x1="8.1" y1="95.72" x2="123.36" y2="95.72" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#30aee3" />
          <stop offset="1" stopColor="#272361" />
        </linearGradient>
      </defs>
      <path fill="#272361" d="M19.61,113.05q-.3-.3-.6-.59t-.6-.61c-4.18-4.22-7.59-8.8-10.31-13.62-1.39,3.21-2.58,6.59-3.47,10.16-6.38,25.53-6.17,52.36.63,77.8,25.44,6.79,52.27,7,77.8.63,42.13-10.52,60.19-58.35,40.3-93.6C106.01,133.15,52.08,145.17,19.61,113.05Z" />
      <path fill="url(#swell-top)" d="M111.85,78.4q.31.29.61.59t.59.61c4.18,4.22,7.59,8.8,10.31,13.62,1.39-3.22,2.58-6.59,3.47-10.16,6.38-25.53,6.17-52.36-.63-77.8-25.44-6.8-52.27-7.01-77.8-.63C6.27,15.14-11.79,62.98,8.1,98.23,25.45,58.3,79.38,46.28,111.85,78.4Z" />
      <path fill="url(#swell-mid)" d="M19.01,112.46q.3.3.6.59c32.47,32.12,86.4,20.1,103.75-19.83-2.72-4.82-6.13-9.4-10.31-13.62q-.3-.31-.59-.61t-.61-.59C79.38,46.28,25.45,58.3,8.1,98.23c2.72,4.82,6.13,9.4,10.31,13.62Q18.71,112.16,19.01,112.46Z" />
    </svg>
  );
}
