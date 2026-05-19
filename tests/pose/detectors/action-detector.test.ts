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

  it("guard 姿勢では guarding になり charge は同時 active にならない (face 排他)", () => {
    const d = createActionDetector();
    d.update(guardPose(), 0);
    const r = d.update(guardPose(), MS.charge.minHoldMs + 1);
    expect(r.guard.active).toBe(true);
    expect(r.charge.active).toBe(false);
    expect(r.action).toBe("guarding");
  });

  it("charge 後の腕伸展バーストで action=attacking が観測される (charge gate)", () => {
    const d = createActionDetector();
    // まず charge を活性化して attack gate を開く
    d.update(chargePose(), 0);
    d.update(chargePose(), MS.charge.minHoldMs + 50); // charge active
    const base = MS.charge.minHoldMs + 100;
    let sawAttacking = false;
    for (const f of attackSequence()) {
      const r = d.update(f.world, base + f.t);
      if (r.action === "attacking") sawAttacking = true;
    }
    expect(sawAttacking).toBe(true);
  });

  it("charge 無しの腕伸展では attacking にならない (gate 閉)", () => {
    const d = createActionDetector();
    let sawAttacking = false;
    for (const f of attackSequence()) {
      if (d.update(f.world, f.t).action === "attacking") sawAttacking = true;
    }
    expect(sawAttacking).toBe(false);
  });

  it("結果に3ディテクタのスコアを同梱する", () => {
    const d = createActionDetector();
    const r = d.update(idlePose(), 0);
    expect(r).toHaveProperty("charge");
    expect(r).toHaveProperty("guard");
    expect(r).toHaveProperty("attack");
  });

  it("カスタム params が下位ディテクタに伝播する (charge.minHoldMs を極大化すると charging しない)", () => {
    const slow = {
      ...DEFAULT_DETECTOR_PARAMS,
      charge: { ...DEFAULT_DETECTOR_PARAMS.charge, minHoldMs: 1_000_000 },
    };
    const d = createActionDetector(slow);
    d.update(chargePose(), 0);
    // 通常なら charge.minHoldMs(200) 経過で charging だが、minHoldMs=1e6 なので
    // 現実的なタイムスタンプでは active にならない
    const r = d.update(chargePose(), 5000);
    expect(r.charge.active).toBe(false);
    expect(r.action).toBe("idle");
  });
});
