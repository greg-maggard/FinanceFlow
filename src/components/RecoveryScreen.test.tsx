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
