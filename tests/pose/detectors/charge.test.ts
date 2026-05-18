import { describe, it, expect } from "vitest";
import { createChargeDetector } from "../../../src/pose/detectors/charge";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, chargePose } from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.charge;

describe("createChargeDetector", () => {
  it("idle 姿勢では score が低く active=false", () => {
    const d = createChargeDetector(P);
    const r = d.update(idlePose(), 0);
    expect(r.active).toBe(false);
    expect(r.score).toBeLessThan(P.enterScore);
  });

  it("charge 姿勢を minHoldMs 継続すると active=true", () => {
    const d = createChargeDetector(P);
    const r0 = d.update(chargePose(), 0);
    expect(r0.score).toBeGreaterThanOrEqual(P.enterScore);
    expect(r0.active).toBe(false);
    const r1 = d.update(chargePose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true);
  });

  it("active 後に idle に戻すと exitScore を下回って active=false", () => {
    const d = createChargeDetector(P);
    d.update(chargePose(), 0);
    d.update(chargePose(), P.minHoldMs + 1);
    const r = d.update(idlePose(), P.minHoldMs + 200);
    expect(r.active).toBe(false);
  });

  it("worldLandmarks が null なら score 0 / active=false", () => {
    const d = createChargeDetector(P);
    const r = d.update(null, 0);
    expect(r.score).toBe(0);
    expect(r.active).toBe(false);
  });

  it("インスタンスごとに状態が独立 (2人化前提)", () => {
    const a = createChargeDetector(P);
    const b = createChargeDetector(P);
    a.update(chargePose(), 0);
    a.update(chargePose(), P.minHoldMs + 1);
    const rb = b.update(idlePose(), P.minHoldMs + 1);
    expect(rb.active).toBe(false);
  });
});
