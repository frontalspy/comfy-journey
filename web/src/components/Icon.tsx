const PATHS = {
  create:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  library: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  workflows:
    "M6 4a2 2 0 100 4 2 2 0 000-4zM18 16a2 2 0 100 4 2 2 0 000-4zM8 6h4a4 4 0 014 4v6M6 8v8a2 2 0 002 2h8",
  settings: "M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M8 16v4",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6",
  heart: "M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  refresh: "M4 12a8 8 0 0113.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.6L4 16M4 20v-4h4",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  close: "M6 6l12 12M18 6L6 18",
  prev: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  copy: "M9 9h10v11H9zM5 15V4h10",
  text: "M5 6h14M5 12h14M5 18h9",
  check: "M5 12.5l4.5 4.5L19 7",
  play: "M8 5v14l11-7z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  upload: "M12 16V5M7 10l5-5 5 5M5 19h14",
  dice: "M5 5h14v14H5zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01",
  stop: "M7 7h10v10H7z",
  upscale: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  filled?: boolean;
}

/** Decorative by default: the button or link around it carries the accessible name. */
export function Icon({ name, size = 22, filled = false }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
