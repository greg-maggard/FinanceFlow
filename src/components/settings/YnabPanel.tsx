import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useYnab } from "../../state/ynabStore";
import { YnabClient, type YnabBudget } from "../../integrations/ynab";
import { GlassInput, FieldLabel } from "../glass/GlassInput";
import { GlassButton } from "../glass/GlassButton";
import { M } from "../../theme/motion";

export function YnabPanel() {
  const { pat, budgetId, budgetName, setCredentials, setBudget, disconnect } = useYnab();
  const [patInput, setPatInput] = useState("");
  const [budgets, setBudgets] = useState<YnabBudget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tryConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await new YnabClient(patInput.trim()).getBudgets();
      setCredentials(patInput.trim());
      setBudgets(list);
      if (list.length === 1) {
        setBudget(list[0].id, list[0].name);
      }
      setPatInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const reload = async () => {
    if (!pat) return;
    setLoading(true);
    setError(null);
    try {
      setBudgets(await new YnabClient(pat).getBudgets());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">YNAB</div>
        {pat && (
          <button
            type="button"
            onClick={() => {
              disconnect();
              setBudgets([]);
            }}
            className="text-[11px] text-red-300/85 hover:text-red-200"
          >
            Disconnect
          </button>
        )}
      </div>

      {!pat ? (
        <div className="space-y-2">
          <p className="text-[11px] text-white/55">
            Generate a Personal Access Token at{" "}
            <a
              className="underline"
              href="https://app.ynab.com/settings/developer"
              target="_blank"
              rel="noreferrer"
            >
              app.ynab.com/settings/developer
            </a>{" "}
            and paste it here.
          </p>
          <label className="block space-y-1.5">
            <FieldLabel>Personal Access Token</FieldLabel>
            <GlassInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={patInput}
              placeholder="•••••••••••••••"
              onChange={(e) => setPatInput(e.target.value)}
            />
          </label>
          <GlassButton
            variant="primary"
            size="sm"
            onClick={tryConnect}
            disabled={!patInput.trim() || loading}
          >
            {loading ? "Connecting…" : "Connect"}
          </GlassButton>
        </div>
      ) : (
        <div className="space-y-2">
          {budgetId && budgetName ? (
            <div className="text-xs text-white/75">
              Connected to <span className="font-semibold">{budgetName}</span>
            </div>
          ) : (
            <div className="text-xs text-white/55">Connected. Choose a budget below.</div>
          )}

          {budgets.length === 0 && (
            <GlassButton variant="secondary" size="sm" onClick={reload} disabled={loading}>
              {loading ? "Loading…" : "Load budgets"}
            </GlassButton>
          )}

          {budgets.length > 0 && (
            <div className="grid gap-1.5">
              {budgets.map((b) => {
                const active = b.id === budgetId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBudget(b.id, b.name)}
                    className="rounded-xl px-3 py-2 text-left text-sm"
                    style={{
                      background: active ? "rgba(96, 165, 250, 0.16)" : "rgba(255,255,255,0.04)",
                      border: active
                        ? "1px solid rgba(96, 165, 250, 0.45)"
                        : "1px solid rgba(255,255,255,0.10)",
                      color: active ? "#dbeafe" : "rgba(255,255,255,0.85)",
                    }}
                  >
                    {b.name}
                    {active && <span className="ml-2 text-xs text-blue-200">— selected</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-white/35">
        Stored locally on this device. Never sent anywhere except to YNAB's API.
      </p>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={M.fadeQuick}
            className="rounded-lg px-3 py-2 text-[11px]"
            style={{
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.30)",
              color: "#fecaca",
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
