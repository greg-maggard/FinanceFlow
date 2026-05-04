import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type YnabState = {
  pat: string | null;
  budgetId: string | null;
  budgetName: string | null;
  setCredentials: (pat: string) => void;
  setBudget: (id: string, name: string) => void;
  disconnect: () => void;
};

export const useYnab = create<YnabState>()(
  persist(
    (set) => ({
      pat: null,
      budgetId: null,
      budgetName: null,
      setCredentials: (pat) => set({ pat }),
      setBudget: (id, name) => set({ budgetId: id, budgetName: name }),
      disconnect: () => set({ pat: null, budgetId: null, budgetName: null }),
    }),
    {
      name: "financeflow:ynab:v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function isConnected(): boolean {
  const s = useYnab.getState();
  return Boolean(s.pat && s.budgetId);
}
