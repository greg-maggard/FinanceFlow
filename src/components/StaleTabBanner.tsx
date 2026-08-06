import { useUI } from "../state/uiStore";

/**
 * F12: full-screen blocking overlay shown once this tab's `storage`
 * listener (see store.ts) detects another window/tab has persisted a newer
 * document. Unlike the saveError banner in TopBar, this has no dismiss
 * button — store.ts has already suspended this tab's persistence
 * subscription for the rest of the session, so the only safe way out is the
 * reload this offers, which loads the newer document fresh.
 */
export function StaleTabBanner() {
  const staleTab = useUI((s) => s.staleTab);
  if (!staleTab) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "rgba(7,8,15,0.85)",
      }}
    >
      <div
        style={{
          maxWidth: "26rem",
          padding: "1.5rem",
          borderRadius: "0.75rem",
          background: "rgba(17,19,24,0.98)",
          border: "1px solid rgba(255,255,255,0.14)",
          textAlign: "center",
          color: "rgba(255,255,255,0.92)",
        }}
      >
        <p style={{ marginBottom: "1.25rem" }}>{staleTab}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "0.6rem 1.2rem",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
