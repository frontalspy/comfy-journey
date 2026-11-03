interface ProgressRingProps {
  /** 0..1, or null while the job is only waiting. Exactly 0 means running with no steps reported yet. */
  progress: number | null;
  size?: number;
}

export function ProgressRing({ progress, size = 56 }: ProgressRingProps) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const fraction = progress === null ? 0 : Math.min(1, Math.max(0, progress));
  const indeterminate = progress === 0;
  return (
    <svg
      className={indeterminate ? "ring ring-indeterminate" : "ring"}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (indeterminate ? 0.25 : fraction))}
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dashoffset 0.3s" }}
      />
      {progress !== null && !indeterminate ? (
        <text x="28" y="32" textAnchor="middle">
          {Math.round(fraction * 100)}%
        </text>
      ) : null}
    </svg>
  );
}
