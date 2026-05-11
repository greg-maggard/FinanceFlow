import type { NodeState } from "./schema";

export function ymKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function priorYm(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return ymKey(d);
}

export function streakLength(node: NodeState): number {
  const checks = node.monthlyChecks ?? {};
  let cur = ymKey();
  if (!checks[cur]) cur = priorYm(cur);
  let n = 0;
  while (checks[cur]) {
    n += 1;
    cur = priorYm(cur);
  }
  return n;
}

export function isCheckedThisMonth(node: NodeState): boolean {
  return Boolean(node.monthlyChecks?.[ymKey()]);
}
