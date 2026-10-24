import { getAcwrZoneKey, type AcwrZoneKey } from "../domain/loadCalculator";

const ZONE_META: Record<AcwrZoneKey, { icon: string; label: string }> = {
  detraining: { icon: "▾", label: "Detraining" },
  goldilocks: { icon: "●", label: "Sweet spot" },
  "high-risk": { icon: "▴", label: "High risk" },
};

/** ACWR status shown as icon + label, never colour alone. */
export function ZoneBadge({ acwr, low, high }: { acwr: number; low: number; high: number }) {
  const key = getAcwrZoneKey(acwr, low, high);
  const meta = ZONE_META[key];
  return (
    <span className={`zone-badge ${key}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}
