import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EASE_FLOW } from "../../theme/motion";

export function KebabMenu({
  children,
  ariaLabel = "Settings",
  drop = "down",
}: {
  children: ReactNode;
  ariaLabel?: string;
  /** Which way the panel unfolds — rows near a card's clipped bottom edge open "up". */
  drop?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <motion.button
        type="button"
        whileHover={{ scale: 1.08, opacity: 1 }}
        whileTap={{ scale: 0.92 }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/55 hover:text-white/95"
        style={{
          background: open ? "rgba(255,255,255,0.08)" : "transparent",
          border: open
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid transparent",
        }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: drop === "up" ? 6 : -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: drop === "up" ? 6 : -6, scale: 0.96 }}
            transition={{ duration: 0.22, ease: EASE_FLOW }}
            className={`absolute right-0 z-30 w-80 overflow-hidden rounded-2xl ${
              drop === "up"
                ? "bottom-full mb-2 origin-bottom-right"
                : "top-full mt-2 origin-top-right"
            }`}
            style={{
              background: "rgba(18, 22, 34, 0.85)",
              backdropFilter: "blur(36px) saturate(180%)",
              WebkitBackdropFilter: "blur(36px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.16), 0 18px 48px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-h-[60vh] overflow-y-auto p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
