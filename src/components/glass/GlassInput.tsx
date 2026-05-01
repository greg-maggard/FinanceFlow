import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const FIELD_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(16px) saturate(180%)",
  WebkitBackdropFilter: "blur(16px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  color: "white",
};

export function GlassInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 ${props.className ?? ""}`}
      style={{ ...FIELD_STYLE, ...props.style }}
    />
  );
}

export function GlassSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/30 ${props.className ?? ""}`}
      style={{ ...FIELD_STYLE, ...props.style }}
    />
  );
}

export function GlassTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30 ${props.className ?? ""}`}
      style={{ ...FIELD_STYLE, ...props.style }}
    />
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
      {children}
    </span>
  );
}
