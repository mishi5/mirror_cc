import { describe, it, expect } from "vitest";
import { createAttackDetector } from "../../../src/pose/detectors/attack";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, attackSequence } from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.attack;

describe("createAttackDetector", () => {
  it("静止 (idle) では active=false", () => {
    const d = createAttackDetector(P);
    let r = d.update(idlePose(), 0);
    r = d.update(idlePose(), 60);
    r = d.update(idlePose(), 120);
    expect(r.active).toBe(false);
  });

  it("前方への急速移動で active=true になる", () => {
    const d = createAttackDetector(P);
    let last = { active: false, score: 0 } as { active: boolean; score: number };
    for (const f of attackSequence()) {
      last = d.update(f.world, f.t);
    }
    expect(last.active).toBe(true);
  });

  it("発火後 refractoryMs 以内は再発火しない", () => {
    const d = createAttackDetector(P);
    const seq = attackSequence();
    let fired = false;
    for (const f of seq) {
      const r = d.update(f.world, f.t);
      if (r.active) fired = true;
    }
    expect(fired).toBe(true);
    const lastT = seq[seq.length - 1]!.t;
    const r2 = d.update(seq[seq.length - 1]!.world, lastT + 10);
    expect(r2.active).toBe(false);
  });

  it("null 入力で active=false / score 0", () => {
    const d = createAttackDetector(P);
    const r = d.update(null, 0);
    expect(r).toEqual({ active: false, score: 0 });
  });

  it("インスタンスごとに履歴が独立", () => {
    const a = createAttackDetector(P);
    const b = createAttackDetector(P);
    for (const f of attackSequence()) a.update(f.world, f.t);
    const rb = b.update(idlePose(), 0);
    expect(rb.active).toBe(false);
  });
});
