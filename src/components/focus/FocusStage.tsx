import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo } from "react";
import { FocusCard } from "./FocusCard";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { neighbors } from "../../graph/path";
import type { NodeId } from "../../state/schema";
import { M, SWIPE_THRESHOLD } from "../../theme/motion";

function Chevron({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      initial={{ opacity: 0, x: dir === "prev" ? -8 : 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: dir === "prev" ? -8 : 8 }}
      transition={M.flow}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      aria-label={dir === "prev" ? "Previous step" : "Next step"}
      className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full text-white/85 sm:flex"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 22px rgba(0,0,0,0.30)",
      }}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path
          d={dir === "prev" ? "M14 18 L8 12 L14 6" : "M10 6 L16 12 L10 18"}
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}

export function FocusStage({ activeId }: { activeId: NodeId }) {
  const setFocus = useUI((s) => s.setFocus);
  const setView = useUI((s) => s.setView);
  const view = useUI((s) => s.view);
  const state = useStore();

  const { prev, next } = useMemo(() => neighbors(state, activeId), [state, activeId]);

  const goPrev = useCallback(() => {
    if (prev) setFocus(prev);
  }, [prev, setFocus]);

  const goNext = useCallback(() => {
    if (next) setFocus(next);
  }, [next, setFocus]);

  useEffect(() => {
    if (view !== "focus") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") setView("overview");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, goPrev, goNext, setView]);

  return (
    <div
      className="flex w-full flex-1 items-center justify-center px-3 sm:gap-4 sm:px-5"
    >
      <AnimatePresence>
        {prev ? <Chevron key="prev" dir="prev" onClick={goPrev} /> : null}
      </AnimatePresence>

      <motion.div
        className="w-full max-w-xl"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragMomentum={false}
        onClick={(e) => e.stopPropagation()}
        onDragEnd={(_, info) => {
          if (info.offset.x < -SWIPE_THRESHOLD && next) goNext();
          else if (info.offset.x > SWIPE_THRESHOLD && prev) goPrev();
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <FocusCard key={activeId} nodeId={activeId} />
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {next ? <Chevron key="next" dir="next" onClick={goNext} /> : null}
      </AnimatePresence>
    </div>
  );
}
