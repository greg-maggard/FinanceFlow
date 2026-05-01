import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "yes" | "no";

type Props = Omit<HTMLMotionProps<"button">, "children"> & {
  children: ReactNode;
  variant?: Variant;
  tint?: string;
  glow?: boolean;
  size?: "sm" | "md" | "lg";
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs rounded-full",
  md: "px-4 py-2 text-sm rounded-full",
  lg: "px-6 py-3 text-base rounded-2xl",
};

export function GlassButton({
  children,
  variant = "primary",
  tint,
  glow = false,
  size = "md",
  className = "",
  style,
  ...rest
}: Props) {
  const palette =
    variant === "yes"
      ? { ring: "rgba(52, 211, 153, 0.45)", glow: "rgba(52, 211, 153, 0.45)", base: "rgba(52, 211, 153, 0.12)" }
      : variant === "no"
        ? { ring: "rgba(248, 113, 113, 0.45)", glow: "rgba(248, 113, 113, 0.45)", base: "rgba(248, 113, 113, 0.12)" }
        : variant === "primary"
          ? {
              ring: tint ? tint : "rgba(255,255,255,0.28)",
              glow: tint ? tint : "rgba(255,255,255,0.35)",
              base: tint ? tint : "rgba(255,255,255,0.10)",
            }
          : { ring: "rgba(255,255,255,0.18)", glow: "rgba(255,255,255,0.18)", base: "rgba(255,255,255,0.05)" };

  return (
    <motion.button
      whileHover={{ scale: 1.025, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      {...rest}
      className={`relative font-medium tracking-tight text-white/95 ${SIZES[size]} ${className}`}
      style={{
        background: `linear-gradient(135deg, ${palette.base}, rgba(255,255,255,0.04))`,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: `1px solid ${palette.ring}`,
        boxShadow: glow
          ? `inset 0 1px 0 rgba(255,255,255,0.25), 0 0 32px ${palette.glow}, 0 8px 24px rgba(0,0,0,0.35)`
          : `inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 18px rgba(0,0,0,0.30)`,
        ...style,
      }}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">{children}</span>
    </motion.button>
  );
}
