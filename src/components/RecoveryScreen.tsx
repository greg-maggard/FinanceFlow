import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { importJson } from "../state/io";
import { adapter } from "../state/store";

interface RecoveryScreenProps {
  message: string;
  raw: string;
}

const STORAGE_KEY = "financeflow:state:v1";

/** Same download-a-Blob pattern as `downloadJson` in src/state/io.ts. */
function downloadRecovery(raw: string): void {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `financeflow-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Full-screen blocking view shown instead of the app when the stored
 * document exists but couldn't be loaded (unparseable JSON, or a
 * future/corrupt version `migrate()` refused to guess at). The original
 * bytes are left untouched in localStorage — persistence is suspended for
 * the session — so the only way out is an explicit, confirmed choice here.
 */
export function RecoveryScreen({ message, raw }: RecoveryScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // F11: without this, recovering meant download-then-erase-then-reload-
  // then-import-from-Settings — a scary multi-step flow at the worst
  // possible moment. This runs the file through the exact same
  // parse+migrate path as a normal import (io.ts's importJson, which throws
  // on anything it can't trust) and, on success, writes straight through
  // the storage adapter. The store's persistence subscription is suspended
  // for the whole recovery session, so setting in-memory state via
  // replaceAll alone would never actually reach localStorage — the write
  // has to go through adapter.save() directly, before the reload.
  async function handleImportFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      const text = await file.text();
      const state = importJson(text);
      await adapter.save(state);
      window.location.reload();
    } catch (err) {
      setImportError((err as Error).message);
      setImporting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        background: "#111318",
        color: "rgba(255,255,255,0.92)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "34rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          FinanceFlow couldn&apos;t open your data
        </h1>
        <p style={{ opacity: 0.85, marginBottom: "0.5rem" }}>{message}</p>
        <p style={{ opacity: 0.7, fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          Nothing has been changed or deleted. Download a backup of the stored data before doing
          anything else.
        </p>

        <button
          type="button"
          onClick={() => downloadRecovery(raw)}
          style={{
            padding: "0.6rem 1.2rem",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: "1.5rem",
          }}
        >
          Download my data
        </button>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingBottom: "1.5rem" }}>
          <p style={{ opacity: 0.7, fontSize: "0.9rem", margin: "1.25rem 0 0.75rem" }}>
            Have a backup file (from Download my data or Settings → Export)? Import it directly —
            this replaces the stored data with the file's contents.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={(e) => void handleImportFile(e)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "0.6rem 1.2rem",
              background: "transparent",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "0.375rem",
              fontWeight: 600,
              cursor: importing ? "default" : "pointer",
              opacity: importing ? 0.6 : 1,
            }}
          >
            {importing ? "Importing…" : "Import a backup file"}
          </button>
          {importError && (
            <p style={{ color: "rgba(255,140,140,0.9)", fontSize: "0.85rem", marginTop: "0.6rem" }}>
              {importError}
            </p>
          )}
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "1.25rem" }}>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "rgba(255,140,140,0.9)",
                border: "1px solid rgba(255,140,140,0.4)",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              Start fresh (erases stored data)
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <p style={{ fontSize: "0.9rem", opacity: 0.85 }}>
                This permanently erases the stored document on this device. Make sure you&apos;ve
                downloaded a backup first.
              </p>
              <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "transparent",
                    color: "rgba(255,255,255,0.8)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(STORAGE_KEY);
                    window.location.reload();
                  }}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: "0.375rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Yes, erase and start fresh
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
