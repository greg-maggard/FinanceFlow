import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Props = HTMLMotionProps<"div"> & {
  children: ReactNode;
  tint?: string;
  intensity?: "subtle" | "normal" | "strong";
  className?: string;
};

const INTENSITY = {
  subtle: { blur: 24, sat: 140, alpha: 0.04, ring: 0.07 },
  normal: { blur: 40, sat: 180, alpha: 0.08, ring: 0.12 },
  strong: { blur: 56, sat: 200, alpha: 0.14, ring: 0.18 },
};

export function GlassCard({
  children,
  tint,
  intensity = "normal",
  className = "",
  style,
  ...rest
}: Props) {
  const cfg = INTENSITY[intensity];
  return (
    <motion.div
      {...rest}
      className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{
        background: tint
          ? `linear-gradient(135deg, ${tint}, rgba(255,255,255,${cfg.alpha}))`
          : `rgba(255, 255, 255, ${cfg.alpha})`,
        backdropFilter: `blur(${cfg.blur}px) saturate(${cfg.sat}%)`,
        WebkitBackdropFilter: `blur(${cfg.blur}px) saturate(${cfg.sat}%)`,
        border: `1px solid rgba(255, 255, 255, ${cfg.ring})`,
        boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(0, 0, 0, 0.25), 0 18px 48px rgba(0, 0, 0, 0.45)`,
        ...style,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 22%, transparent 60%)",
        }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
