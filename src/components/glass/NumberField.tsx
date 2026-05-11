import { useEffect, useState, type InputHTMLAttributes } from "react";
import { GlassInput } from "./GlassInput";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (v: number) => void;
};

export function NumberField({ value, onChange, placeholder, ...rest }: Props) {
  const [local, setLocal] = useState<string>(value === 0 ? "" : String(value));

  useEffect(() => {
    if (Number(local || "0") !== value) {
      setLocal(value === 0 ? "" : String(value));
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
          onChange(0);
        } else {
          const n = Number(v);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
    />
  );
}
