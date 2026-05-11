const API_BASE = "https://api.ynab.com/v1";

export type YnabBudget = {
  id: string;
  name: string;
};

export type YnabGoalType = "TB" | "TBD" | "MF" | "NEED" | "DEBT" | null;

export type YnabCategory = {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type: YnabGoalType;
  goal_target: number | null;
  goal_overall_funded: number | null;
  goal_percentage_complete: number | null;
};

export type YnabCategoryGroup = {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: YnabCategory[];
};

export class YnabClient {
  constructor(private pat: string) {}

  private async fetchData<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.pat}` },
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          "Invalid token. Generate a new Personal Access Token at app.ynab.com/settings/developer.",
        );
      }
      throw new Error(`YNAB API error: ${res.status}`);
    }
    const json = await res.json();
    return json.data as T;
  }

  async getBudgets(): Promise<YnabBudget[]> {
    const data = await this.fetchData<{ budgets: YnabBudget[] }>("/budgets");
    return data.budgets;
  }

  async getCategoryGroups(budgetId: string): Promise<YnabCategoryGroup[]> {
    const data = await this.fetchData<{ category_groups: YnabCategoryGroup[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/categories`,
    );
    return data.category_groups.filter((g) => !g.hidden && !g.deleted);
  }

  async getCategoryCurrent(budgetId: string, categoryId: string): Promise<YnabCategory> {
    const data = await this.fetchData<{ category: YnabCategory }>(
      `/budgets/${encodeURIComponent(budgetId)}/months/current/categories/${encodeURIComponent(categoryId)}`,
    );
    return data.category;
  }
}

export function milliToDollar(milli: number): number {
  return Math.round(milli / 10) / 100;
}

export function flattenCategories(groups: YnabCategoryGroup[]): YnabCategory[] {
  return groups.flatMap((g) => g.categories.filter((c) => !c.hidden && !c.deleted));
}
