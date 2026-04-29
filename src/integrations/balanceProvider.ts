export type BalanceQuery =
  | { kind: "emergencyFund" }
  | { kind: "debt"; debtId: string }
  | { kind: "iraYtd" }
  | { kind: "hsaYtd" }
  | { kind: "529Balance" }
  | { kind: "purchaseSaved"; goalId: string };

export interface BalanceProvider {
  id: "manual" | "plaid" | "ynab";
  read(q: BalanceQuery): Promise<number | null>;
}

export const ManualProvider: BalanceProvider = {
  id: "manual",
  async read() {
    return null;
  },
};

let active: BalanceProvider = ManualProvider;
export function getProvider(): BalanceProvider {
  return active;
}
export function setProvider(p: BalanceProvider): void {
  active = p;
}
