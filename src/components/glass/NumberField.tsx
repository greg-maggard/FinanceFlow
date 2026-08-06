import { useEffect, useState, type InputHTMLAttributes } from "react";
import type { Cents } from "../../state/schema";
import { cents, centsFromDollars } from "../../state/schema";
import { GlassInput } from "./GlassInput";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: Cents;
  onChange: (v: Cents) => void;
};

/**
 * The money input boundary. The user types DOLLARS; the store holds `Cents`.
 *
 * This is one of the two places the v4 rounding rule is applied (the other is
 * the v3->v4 migration) — typing "33.333" commits 3333 cents, not 33.333
 * dollars, so a sub-cent amount can never reach the document and can never
 * make the two platforms disagree about a `>=` comparison. See
 * money-migration-v4.md §4.
 */
const toField = (c: Cents): string => (c === 0 ? "" : String(c / 100));

export function NumberField({ value, onChange, placeholder, ...rest }: Props) {
  const [local, setLocal] = useState<string>(() => toField(value));

  useEffect(() => {
    // Re-sync only when the committed value genuinely differs from what the
    // field is showing. Comparing in cents (not raw text) keeps a half-typed
    // "12." or a trailing "12.30" from being yanked out from under the user.
    if (centsFromDollars(Number(local || "0")) !== value) {
      setLocal(toField(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <GlassInput
      {...rest}
      type="number"
      inputMode="decimal"
      placeholder={placeholder ?? "0"}
      value={local}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (v === "") {
          onChange(cents(0));
        } else {
          const n = Number(v);
          if (!Number.isNaN(n)) onChange(centsFromDollars(n));
        }
      }}
    />
  );
}
