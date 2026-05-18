import { describe, it, expect } from "vitest";
import { createActionDetector } from "../../../src/pose/detectors/action-detector";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import {
  idlePose,
  chargePose,
  guardPose,
  attackSequence,
} from "./fixtures";

const MS = DEFAULT_DETECTOR_PARAMS;

describe("createActionDetector", () => {
  it("入力なし/idle では action=idle", () => {
    const d = createActionDetector();
    expect(d.update(idlePose(), 0).action).toBe("idle");
    expect(d.update(null, 16).action).toBe("idle");
  });

  it("charge 姿勢を保持すると action=charging に遷移", () => {
    const d = createActionDetector();
    d.update(chargePose(), 0);
    const r = d.update(chargePose(), MS.charge.minHoldMs + 1);
    expect(r.action).toBe("charging");
    expect(r.charge.active).toBe(true);
  });

  it("guard 姿勢を保持すると action=guarding。guard は charge より優先", () => {
    const d = createActionDetector();
    d.update(guardPose(), 0);
    const r = d.update(guardPose(), MS.guard.minHoldMs + 1);
    expect(r.action).toBe("guarding");
  });

  it("アタック動作中は action=attacking が最優先", () => {
    const d = createActionDetector();
    let last = d.update(idlePose(), 0);
    for (const f of attackSequence()) {
      last = d.update(f.world, f.t);
    }
    expect(last.action).toBe("attacking");
  });

  it("結果に3ディテクタのスコアを同梱する", () => {
    const d = createActionDetector();
    const r = d.update(idlePose(), 0);
    expect(r).toHaveProperty("charge");
    expect(r).toHaveProperty("guard");
    expect(r).toHaveProperty("attack");
  });

  it("カスタム params を受け取れる", () => {
    const d = createActionDetector(DEFAULT_DETECTOR_PARAMS);
    expect(d.update(idlePose(), 0).action).toBe("idle");
  });
});
