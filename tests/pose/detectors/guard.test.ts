import { describe, it, expect } from "vitest";
import { createGuardDetector } from "../../../src/pose/detectors/guard";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, guardPose } from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.guard;

describe("createGuardDetector", () => {
  it("idle 姿勢では active=false", () => {
    const d = createGuardDetector(P);
    const r = d.update(idlePose(), 0);
    expect(r.active).toBe(false);
  });

  it("guard 姿勢を minHoldMs 継続すると active=true", () => {
    const d = createGuardDetector(P);
    const r0 = d.update(guardPose(), 0);
    expect(r0.score).toBeGreaterThanOrEqual(P.enterScore);
    expect(r0.active).toBe(false);
    const r1 = d.update(guardPose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true);
  });

  it("active 中は持続時間が detail に出る", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);
    d.update(guardPose(), P.minHoldMs + 1);
    const r = d.update(guardPose(), P.minHoldMs + 500);
    expect(r.active).toBe(true);
    expect(r.detail).toMatch(/held/);
  });

  it("交差していない (手首が肩と同じ側) と active=false", () => {
    const d = createGuardDetector(P);
    const r = d.update(idlePose(), 0);
    expect(r.score).toBeLessThan(P.enterScore);
  });

  it("null 入力で active=false / score 0", () => {
    const d = createGuardDetector(P);
    expect(d.update(null, 0)).toEqual({ active: false, score: 0 });
  });
});
