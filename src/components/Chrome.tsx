import { useEffect, useState } from "react";

type ThemeChoice = "auto" | "light" | "dark";
const THEME_STORAGE_KEY = "blm_theme";

function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

/** Cycles auto → light → dark; "auto" follows the OS setting. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
  }, [theme]);

  const next: Record<ThemeChoice, ThemeChoice> = { auto: "light", light: "dark", dark: "auto" };
  const label = { auto: "Theme: auto", light: "Theme: day", dark: "Theme: night" }[theme];

  return (
    <button type="button" className="icon-button" onClick={() => setTheme(next[theme])} title={label} aria-label={label}>
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      ) : theme === "light" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" className="fill" />
        </svg>
      )}
    </button>
  );
}

/** Mountain-and-boulder mark. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" className="brand-mark-bg" />
      <path d="M6 36 L18 18 L24 26 L30 16 L42 36 Z" className="brand-mark-ridge" />
      <path d="M30 16 L34 22.5 L31 21 L28.5 23 L27 19.5 Z" className="brand-mark-snow" />
      <ellipse cx="17" cy="35" rx="7" ry="4.2" className="brand-mark-boulder" />
    </svg>
  );
}

const TAB_ICONS: Record<string, React.ReactNode> = {
  session: <path d="M8 3a5 5 0 0 0-5 5v8a5 5 0 0 0 10 0V8a5 5 0 0 0-5-5Zm0 0v6M16 9h5M18.5 6.5v5M15 17h6" />,
  dashboard: <path d="M3 20h18M5 20l5-9 3 4 3-6 4 11" />,
  strength: <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />,
  history: <path d="M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};

export function TabIcon({ name }: { name: string }) {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      {TAB_ICONS[name]}
    </svg>
  );
}

/** Segmented pill control used for date ranges. */
export function RangePills<T extends string | number | null>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="range-pills" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
