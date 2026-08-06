import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo } from "react";
import { FocusCard } from "./FocusCard";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { neighbors } from "../../graph/path";
import type { NodeId } from "../../state/schema";
import { M, SWIPE_THRESHOLD, type Direction } from "../../theme/motion";

const variants = {
  enter: (dir: Direction) => ({
    x: dir === "forward" ? "60%" : dir === "backward" ? "-60%" : 0,
    opacity: 0,
    scale: dir === "none" ? 0.94 : 1,
    filter: dir === "none" ? "blur(6px)" : "blur(0px)",
  }),
  center: { x: "0%", opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: (dir: Direction) => ({
    x: dir === "forward" ? "-60%" : dir === "backward" ? "60%" : 0,
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
    <div className="relative flex w-full flex-1 flex-col">
      <div className="relative flex w-full items-center justify-center">
        <div className="relative z-10 w-full max-w-xl px-3 sm:px-5">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={activeId}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={M.cardSlide}
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
              <FocusCard nodeId={activeId} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
