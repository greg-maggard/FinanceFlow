import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./App";
import * as storeModule from "./state/store";

const KEY = "financeflow:state:v1";

function Boom(): never {
  throw new Error("kaboom");
}

// F10 belt-and-braces: a claimed-v3 document can pass migrate()'s structural
// validation and still crash somewhere deeper in render. AppErrorBoundary is
// the last line of defense — it must show the same recovery UI the boot-time
// guard uses, and it must stop persistence so the crash can never get
// written back over the original stored bytes.
describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("falls back to RecoveryScreen instead of a bare white screen when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByText(/FinanceFlow hit an error/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download my data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import a backup file/i })).toBeInTheDocument();
  });

  it("suspends persistence so the crash can't be written back over the stored bytes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const suspendSpy = vi.spyOn(storeModule, "suspendPersistence");
    localStorage.setItem(KEY, '{"stored":"bytes"}');

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(suspendSpy).toHaveBeenCalledTimes(1);
    // getStoredRaw() is read fresh at render time, so the fallback screen
    // hands the user the real stored bytes to download — and nothing wrote
    // over them in the process.
    expect(localStorage.getItem(KEY)).toBe('{"stored":"bytes"}');
  });

  it("renders children normally when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <div>all good</div>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
