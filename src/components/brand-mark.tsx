export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <path d="M12 7H6v18h6M20 7h6v18h-6" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="2" />
      <path d="M11 16h10" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect fill="currentColor" height="5" width="5" x="13.5" y="13.5" />
    </svg>
  );
}
