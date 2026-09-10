import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import bookFixture from "../../../fixtures/plaid/book.json";
import nightly from "../../../fixtures/plaid/nightly-snapshot.json";
import { useStore } from "../../state/store";
import { makeInitialState } from "../../state/schema";
import type { BudgetBook } from "../../state/schema";
import { accountBalance, bookIntegrity } from "../../budget/ledger";
import { PlaidImportSheet } from "./PlaidImportSheet";

// Synthetic, committed fixtures only (see w3-plaid-planner / commit 8207a11)
// — the same nightly-shaped snapshot and starting book the planner's own
// tests pin. Nothing here reads real Plaid data.
const MONTH = "2026-08";

function seedFixtureBook() {
  const budget = JSON.parse(JSON.stringify(bookFixture)) as BudgetBook;
  useStore.getState().replaceAll({ ...makeInitialState(), budget });
}

function snapshotFile(): File {
  return new File([JSON.stringify(nightly)], "nightly-snapshot.json", {
    type: "application/json",
  });
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("PlaidImportSheet", () => {
  beforeEach(() => {
    useStore.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("starts on the file picker and writes nothing until a file is read", () => {
    seedFixtureBook();
    render(<PlaidImportSheet open onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Import bank snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
  });

  it("prompts to map the Plaid accounts book.json doesn't already cover", async () => {
    seedFixtureBook();
    render(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });

    expect(await screen.findByRole("heading", { name: "Match accounts" })).toBeInTheDocument();
    // acct-chk/acct-visa are already linked in book.json; brokerage and the
    // new savings account are not.
    expect(screen.getByText("Individual Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Online Savings")).toBeInTheDocument();
  });

  it("previews the exact counts the planner computes, and writes nothing until confirmed", async () => {
    seedFixtureBook();
    render(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });
    await screen.findByRole("heading", { name: "Match accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Review import" })).toBeInTheDocument();
    expect(
      screen.getByText("Import 5 transactions, skip 1 already imported, skip 2 pending."),
    ).toBeInTheDocument();
    expect(screen.getByText("Individual Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Online Savings")).toBeInTheDocument();

    // Preview only — the book is untouched.
    expect(useStore.getState().budget.transactions).toHaveLength(bookFixture.transactions.length);
  });

  it("confirms into Uncategorized and leaves every mapped account's balance equal to Plaid's", async () => {
    seedFixtureBook();
    render(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });
    await screen.findByRole("heading", { name: "Match accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review import" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByText("Imported 5 transactions into Uncategorized.")).toBeInTheDocument();

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(bookFixture.transactions.length + 5);
    // The fixture book already carries one Plaid row (categorized cat:bills);
    // only the freshly imported ones land in Uncategorized.
    const imported = budget.transactions.filter((t) => t.categoryId === "cat:uncategorized");
    expect(imported).toHaveLength(5);
    expect(imported.every((t) => t.source === "plaid" && t.plaidTxnId !== undefined)).toBe(true);

    expect(bookIntegrity(budget, MONTH).drift).toBe(0);
    // Chase's checking current_balance is 2841.19; the credit card's 412.66
    // owed becomes a negative local balance.
    expect(accountBalance(budget, "acct-chk")).toBe(284_119);
    expect(accountBalance(budget, "acct-visa")).toBe(-41_266);
  });

  it("maps an unmapped Plaid account to a chosen local account, imports its rows, and remembers the link", async () => {
    seedFixtureBook();
    useStore.getState().addAccount({
      id: "acct-brokerage",
      name: "Brokerage",
      kind: "checking",
      source: "manual",
    });
    render(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });
    await screen.findByRole("heading", { name: "Match accounts" });

    fireEvent.change(screen.getByLabelText("Map Individual Brokerage to"), {
      target: { value: "acct-brokerage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Brokerage's two rows (dividend + fee) now import; only Online Savings
    // is still unmapped.
    expect(
      await screen.findByText("Import 7 transactions, skip 1 already imported, skip 2 pending."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Individual Brokerage")).not.toBeInTheDocument();
    expect(screen.getByText("Online Savings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText("Imported 7 transactions into Uncategorized.");

    const budget = useStore.getState().budget;
    const brokerage = budget.accounts.find((a) => a.id === "acct-brokerage")!;
    expect(brokerage.plaidAccountId).toBe("plaid-acct-brokerage");
    expect(
      budget.transactions.some((t) => t.accountId === "acct-brokerage" && t.plaidTxnId),
    ).toBe(true);
    expect(bookIntegrity(budget, MONTH).drift).toBe(0);
  });

  it("importing the same snapshot twice adds zero duplicate rows, and the preview says so", async () => {
    seedFixtureBook();
    const { rerender } = render(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });
    await screen.findByRole("heading", { name: "Match accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review import" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText("Imported 5 transactions into Uncategorized.");

    // Close and reopen — a fresh session against the now-updated book.
    rerender(<PlaidImportSheet open={false} onClose={() => {}} />);
    rerender(<PlaidImportSheet open onClose={() => {}} />);

    fireEvent.change(fileInput(), { target: { files: [snapshotFile()] } });
    await screen.findByRole("heading", { name: "Match accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Import 0 transactions, skip 6 already imported, skip 2 pending."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByText("Imported 0 transactions into Uncategorized.");

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(bookFixture.transactions.length + 5);
    expect(bookIntegrity(budget, MONTH).drift).toBe(0);
  });

  it("shows a parse error and stays on the picker for a file that isn't JSON", async () => {
    seedFixtureBook();
    render(<PlaidImportSheet open onClose={() => {}} />);

    const badFile = new File(["not json"], "oops.json", { type: "application/json" });
    fireEvent.change(fileInput(), { target: { files: [badFile] } });

    expect(await screen.findByText("Could not parse that file as JSON.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Import bank snapshot" })).toBeInTheDocument();
    expect(useStore.getState().budget.transactions).toHaveLength(bookFixture.transactions.length);
  });
});
