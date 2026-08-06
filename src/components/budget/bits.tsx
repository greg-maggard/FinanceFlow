import { useState } from "react";
import { FieldLabel, GlassInput } from "../glass/GlassInput";

/**
 * Shared scraps for the budget screen: money text and small form chrome.
 * Anything used by more than one section lives here.
 */

/** "$1,234.56" — whole dollars stay clean ("$1,234"), cents show when real. */
export function dollars(n: number): string {
  const cents = Math.round(n * 100);
  const abs = Math.abs(cents) / 100;
  const text = abs.toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "−" : ""}$${text}`;
}

/** Labelled field, matching the node forms. */
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <FieldLabel>{label}</FieldLabel>
    {children}
  </label>
);

/**
 * One tap that fills this month's monthly targets from Ready to Assign. Wears
 * the funding green because it is money landing in envelopes; lives both on
 * the month header and inside the untouched-month prompt.
 */
export function FundMonthButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium hover:brightness-110"
      style={{
        background: "rgba(52, 211, 153, 0.14)",
        border: "1px solid rgba(52, 211, 153, 0.38)",
        color: "#a7f3d0",
      }}
    >
      Fund this month
    </button>
  );
}

/** Section heading, matching the Overview sheet's phase captions. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.22em] text-white/55">{children}</div>
  );
}

/**
 * "+ Add thing" that unfolds into a single name input. Enter or Add commits,
 * Escape folds it back up.
 */
export function InlineAdd({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const name = (draft ?? "").trim();
    if (name) onAdd(name);
    setDraft(null);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft("")}
        className="w-full rounded-xl border border-dashed border-white/15 py-2 text-xs text-white/65 hover:bg-white/5"
      >
        + {label}
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <GlassInput
        autoFocus
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(null);
        }}
      />
      <button
        type="button"
        onClick={commit}
        className="shrink-0 rounded-xl px-3 text-xs font-medium text-white/80 hover:text-white/95"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        Add
      </button>
    </div>
  );
}
