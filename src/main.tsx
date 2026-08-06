import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { setPwaUpdateHandler, useUI } from "./state/uiStore";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// registerType: "prompt" (never "autoUpdate") — see vite.config.ts. A new
// service worker only takes over once the user confirms via the TopBar
// banner, which is what makes it safe to swap the cached bundle under a
// live session: flushSave() is already wired to visibilitychange/pagehide
// (src/state/store.ts), so the reload this triggers flushes any pending
// debounced write before the new document loads.
if ("serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh() {
        useUI.getState().setNeedRefresh(true);
      },
    });
    setPwaUpdateHandler(updateSW);
  });
}
