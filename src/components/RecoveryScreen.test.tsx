import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecoveryScreen } from "./RecoveryScreen";
import { adapter } from "../state/store";
import { makeInitialState } from "../state/schema";

// F11: RecoveryScreen's only way out used to be download-then-erase. This
// covers the added import path — a file input that runs the chosen file
// through io.ts's real parse+migrate (importJson), and on success writes
// straight through the storage adapter (not replaceAll, which the store's
// suspended persistence subscription would silently drop) before reloading.
describe("RecoveryScreen import path", () => {
  beforeEach(() => {
    // jsdom doesn't implement navigation; stub it so the reload call the
    // success path makes doesn't blow up the test.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports a valid backup file straight through adapter.save() and reloads", async () => {
    const saveSpy = vi.spyOn(adapter, "save").mockResolvedValue(undefined);
    const state = makeInitialState();
    state.nodes.Start.notes = "restored from backup";
    const file = new File([JSON.stringify(state)], "backup.json", { type: "application/json" });

    render(<RecoveryScreen message="Stored data isn't valid JSON: bad" raw="{bad" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy.mock.calls[0][0].nodes.Start.notes).toBe("restored from backup");
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
  });

  it("shows an error and does not save or reload when the file isn't a valid document", async () => {
    const saveSpy = vi.spyOn(adapter, "save").mockResolvedValue(undefined);
    const file = new File(["not json"], "backup.json", { type: "application/json" });

    render(<RecoveryScreen message="Stored data isn't valid JSON: bad" raw="{bad" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/unexpected token|not valid json|json/i)).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

// w3-backup-key: the recovery screen's third option, offered whenever a
// rolling backup key (see storage.ts) exists on this device.
describe("RecoveryScreen restore-from-backup path", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("offers no restore option when no backup key exists", () => {
    render(<RecoveryScreen message="Stored data isn't valid JSON: bad" raw="{bad" />);
    expect(
      screen.queryByRole("button", { name: /restore yesterday's backup/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the backup's timestamp and restores it through adapter.save() + reload", async () => {
    const saveSpy = vi.spyOn(adapter, "save").mockResolvedValue(undefined);
    const state = makeInitialState();
    state.nodes.Start.notes = "restored from rolling backup";
    const at = new Date("2026-08-01T12:00:00.000Z").getTime();
    localStorage.setItem(
      "financeflow:backup:v3",
      JSON.stringify({ at, raw: JSON.stringify(state) }),
    );

    render(<RecoveryScreen message="Stored data isn't valid JSON: bad" raw="{bad" />);

    expect(screen.getByText(/2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /restore yesterday's backup/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy.mock.calls[0][0].nodes.Start.notes).toBe("restored from rolling backup");
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
  });

  it("shows an error and does not reload when the stored backup bytes fail to migrate", async () => {
    const saveSpy = vi.spyOn(adapter, "save").mockResolvedValue(undefined);
    localStorage.setItem(
      "financeflow:backup:v3",
      JSON.stringify({ at: Date.now(), raw: JSON.stringify({ version: 99 }) }),
    );

    render(<RecoveryScreen message="Stored data isn't valid JSON: bad" raw="{bad" />);
    fireEvent.click(screen.getByRole("button", { name: /restore yesterday's backup/i }));

    expect(await screen.findByText(/unsupported financeflow version/i)).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
