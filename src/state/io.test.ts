import { describe, expect, it } from "vitest";
import { makeInitialState } from "./schema";
import { exportJson, importJson, migrate } from "./io";

describe("migrate", () => {
  it("passes a version-1 document through", () => {
    const s = makeInitialState();
    expect(migrate(s)).toEqual(s);
  });

  it("throws on a newer version instead of silently resetting", () => {
    const s = { ...makeInitialState(), version: 2 };
    expect(() => migrate(s)).toThrow(/version/i);
  });

  it("throws on non-object input", () => {
    expect(() => migrate("nope")).toThrow();
    expect(() => migrate(null)).toThrow();
  });
});

describe("export/import", () => {
  it("is identity for a version-1 state", () => {
    const s = makeInitialState();
    s.nodes.Start.completed = true;
    expect(importJson(exportJson(s))).toEqual(s);
  });
});
