import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo } from "react";
import { FocusCard } from "./FocusCard";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { neighbors } from "../../graph/path";
import type { NodeId } from "../../state/schema";
import { M, SWIPE_THRESHOLD, type Direction } from "../../theme/motion";

function Arrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.32 }}
      whileHover={{ opacity: 0.95, scale: 1.12 }}
      whileTap={{ scale: 0.92 }}
      exit={{ opacity: 0 }}
      transition={M.fadeQuick}
      aria-label={dir === "prev" ? "Previous step" : "Next step"}
      className="hidden h-11 w-11 shrink-0 items-center justify-center text-white sm:flex"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d={dir === "prev" ? "M15 18 L9 12 L15 6" : "M9 6 L15 12 L9 18"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}

const variants = {
  enter: (dir: Direction) => ({
    x: dir === "forward" ? 70 : dir === "backward" ? -70 : 0,
    opacity: 0,
    scale: dir === "none" ? 0.94 : 1,
    filter: dir === "none" ? "blur(6px)" : "blur(0px)",
  }),
  center: { x: 0, opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: (dir: Direction) => ({
    x: dir === "forward" ? -70 : dir === "backward" ? 70 : 0,
    opacity: 0,
    scale: dir === "none" ? 0.94 : 1,
    filter: dir === "none" ? "blur(10px)" : "blur(0px)",
  }),
};

export function FocusStage({ activeId }: { activeId: NodeId }) {
  const setFocus = useUI((s) => s.setFocus);
  const setView = useUI((s) => s.setView);
  const view = useUI((s) => s.view);
  const direction = useUI((s) => s.direction);
  const state = useStore();

  const { prev, next } = useMemo(() => neighbors(state, activeId), [state, activeId]);

  const goPrev = useCallback(() => {
    if (prev) setFocus(prev, "backward");
  }, [prev, setFocus]);

  const goNext = useCallback(() => {
    if (next) setFocus(next, "forward");
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
    <div className="relative flex w-full flex-1 items-center justify-center px-2 sm:gap-2 sm:px-4">
      <AnimatePresence>
        {prev ? <Arrow key="prev" dir="prev" onClick={goPrev} /> : null}
      </AnimatePresence>

      <motion.div
        className="relative w-full max-w-xl"
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
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={activeId}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={M.cardSlide}
          >
            <FocusCard nodeId={activeId} />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {next ? <Arrow key="next" dir="next" onClick={goNext} /> : null}
      </AnimatePresence>
    </div>
  );
}
