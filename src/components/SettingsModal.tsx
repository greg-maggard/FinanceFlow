import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../state/store";
import { GlassCard } from "./glass/GlassCard";
import { FieldLabel, GlassInput } from "./glass/GlassInput";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md"
            initial={{ scale: 0.94, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <GlassCard intensity="strong" className="p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-white/95">Settings</h2>
                <button
                  onClick={onClose}
                  className="text-white/40 hover:text-white/85"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <FieldLabel>Monthly expenses ($)</FieldLabel>
                  <GlassInput
                    type="number"
                    value={settings.monthlyExpenses ?? ""}
                    onChange={(e) =>
                      useStore.getState().setSettings({
                        monthlyExpenses: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                  <span className="text-[11px] text-white/45">
                    Drives emergency fund targets.
                  </span>
                </label>
                <label className="block space-y-1.5">
                  <FieldLabel>Pre-tax annual income ($)</FieldLabel>
                  <GlassInput
                    type="number"
                    value={settings.preTaxIncome ?? ""}
                    onChange={(e) =>
                      useStore.getState().setSettings({
                        preTaxIncome: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                  <span className="text-[11px] text-white/45">For the 15% retirement check.</span>
                </label>
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">
                    Annual contribution limits
                  </div>
                  <label className="block space-y-1.5">
                    <FieldLabel>IRA</FieldLabel>
                    <GlassInput
                      type="number"
                      value={settings.iraAnnualLimit}
                      onChange={(e) =>
                        useStore.getState().setSettings({ iraAnnualLimit: Number(e.target.value) })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <FieldLabel>HSA self</FieldLabel>
                      <GlassInput
                        type="number"
                        value={settings.hsaSelfLimit}
                        onChange={(e) =>
                          useStore.getState().setSettings({ hsaSelfLimit: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <FieldLabel>HSA family</FieldLabel>
                      <GlassInput
                        type="number"
                        value={settings.hsaFamilyLimit}
                        onChange={(e) =>
                          useStore.getState().setSettings({ hsaFamilyLimit: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
