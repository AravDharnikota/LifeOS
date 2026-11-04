import { describe, expect, it } from "vitest";
import { describeWork, formatElapsed, formatToolArgs, promptHistory, stepHistory } from "./terminal";

describe("formatToolArgs", () => {
  it("renders key=value pairs with quoted, clipped strings", () => {
    expect(formatToolArgs({ title: "Buy milk", ml: 250, done: false })).toBe('title="Buy milk" ml=250 done=false');
    expect(formatToolArgs({ text: "a".repeat(40) })).toBe(`text="${"a".repeat(27)}…"`);
  });
  it("summarises arrays and nested objects by shape", () => {
    expect(formatToolArgs({ ids: [1, 2, 3], widget: { type: "goal" } })).toBe("ids=[3] widget={…}");
  });
  it("collapses whitespace and skips undefined values", () => {
    expect(formatToolArgs({ note: "two\n lines", gone: undefined })).toBe('note="two lines"');
  });
  it("is empty for no input and clips the whole line", () => {
    expect(formatToolArgs(undefined)).toBe("");
    expect(formatToolArgs({})).toBe("");
    expect(formatToolArgs({ a: "x".repeat(20), b: "y".repeat(20), c: "z".repeat(20) }, 30)).toHaveLength(30);
  });
});

describe("stepHistory", () => {
  it("walks from the draft to the oldest entry and back", () => {
    expect(stepHistory(3, null, "older")).toBe(0);
    expect(stepHistory(3, 0, "older")).toBe(1);
    expect(stepHistory(3, 2, "older")).toBe(2);
    expect(stepHistory(3, 2, "newer")).toBe(1);
    expect(stepHistory(3, 0, "newer")).toBeNull();
    expect(stepHistory(3, null, "newer")).toBeNull();
  });
  it("does nothing with no history", () => {
    expect(stepHistory(0, null, "older")).toBeNull();
  });
});

describe("promptHistory", () => {
  it("lists user turns newest first without consecutive repeats", () => {
    const turns = [
      { role: "user", text: "plan my day" },
      { role: "assistant", text: "ok" },
      { role: "user", text: "add water" },
      { role: "assistant", text: "done" },
      { role: "user", text: "add water" },
      { role: "user", text: "  " },
    ];
    expect(promptHistory(turns)).toEqual(["add water", "plan my day"]);
  });
});

describe("formatElapsed", () => {
  it("prints tenths under a minute and m ss above", () => {
    expect(formatElapsed(420)).toBe("0.4s");
    expect(formatElapsed(59_940)).toBe("59.9s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
  });
});

describe("describeWork", () => {
  it("names the work of a turn", () => {
    expect(describeWork(0, true)).toBe("thinking");
    expect(describeWork(0, false)).toBe("");
    expect(describeWork(1, false)).toBe("1 tool call");
    expect(describeWork(4, true)).toBe("4 tool calls");
  });
});
