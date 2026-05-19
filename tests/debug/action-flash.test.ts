import { describe, it, expect } from "vitest";
import { flashRemainingMs } from "../../src/debug/action-flash";

describe("flashRemainingMs", () => {
  it("一度も発火していなければ 0", () => {
    expect(flashRemainingMs(null, 1000, 1000)).toBe(0);
  });

  it("発火直後は duration いっぱい残る", () => {
    expect(flashRemainingMs(1000, 1000, 1000)).toBe(1000);
  });

  it("経過に応じて残り時間が減る", () => {
    expect(flashRemainingMs(1000, 1300, 1000)).toBe(700);
  });

  it("duration を過ぎたら 0 (負にならない)", () => {
    expect(flashRemainingMs(1000, 2500, 1000)).toBe(0);
  });

  it("境界 (ちょうど duration) は 0", () => {
    expect(flashRemainingMs(1000, 2000, 1000)).toBe(0);
  });
});
