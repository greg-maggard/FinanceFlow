import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { useStore } from "../state/store";

// w3-backup-key: Settings gains a "Last backup" line next to "Last saved".
describe("SettingsModal Last backup line", () => {
  beforeEach(() => {
    useStore.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("reads 'none yet' when no rolling backup has ever been promoted", () => {
    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.getByText("Last backup")).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
  });

  it("shows a relative time once a backup key exists", () => {
    localStorage.setItem(
      "financeflow:backup:v3",
      JSON.stringify({ at: Date.now() - 5000, raw: '{"version":3}' }),
    );
    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.getByText("Last backup")).toBeInTheDocument();
    expect(screen.queryByText("none yet")).not.toBeInTheDocument();
  });
});

// w3-plaid-ui: the file importer lives next to Export/Import.
describe("SettingsModal bank import entry", () => {
  beforeEach(() => {
    useStore.getState().reset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("opens the Plaid import sheet on the file picker stage", () => {
    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Import bank snapshot" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Import bank snapshot" }));
    expect(screen.getByRole("heading", { name: "Import bank snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
  });
});
