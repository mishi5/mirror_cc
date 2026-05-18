import { describe, it, expect } from "vitest";
import { createAttackDetector } from "../../../src/pose/detectors/attack";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, attackSequence } from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.attack;

describe("createAttackDetector", () => {
  it("静止 (idle) では active=false (バッファ充填後も)", () => {
    const d = createAttackDetector(P);
    let r = { active: false, score: 0 } as { active: boolean; score: number };
    // historyLen+1 フレーム以上与えてバッファを満たし、それでも非アクティブを確認
    for (let i = 0; i < P.historyLen + 2; i++) {
      r = d.update(idlePose(), i * 60);
    }
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

  it("refractoryMs 経過後は再発火する", () => {
    const d = createAttackDetector(P);
    let firstFireT: number | null = null;
    for (const f of attackSequence()) {
      const r = d.update(f.world, f.t);
      if (r.active && firstFireT === null) firstFireT = f.t;
    }
    expect(firstFireT).not.toBeNull();
    // refractory ウィンドウ経過後に新たなスラストを再生
    const offset = firstFireT! + P.refractoryMs + 1;
    let refired = false;
    for (const f of attackSequence()) {
      const r = d.update(f.world, f.t + offset);
      if (r.active) {
        refired = true;
        break;
      }
    }
    expect(refired).toBe(true);
  });

  it("dropout(null) で履歴がクリアされ、復帰後は historyLen フレーム揃うまで発火しない (I-1 回帰防止)", () => {
    const d = createAttackDetector(P);
    // 1回発火させる
    for (const f of attackSequence()) d.update(f.world, f.t);
    // null で dropout → 履歴クリア
    d.update(null, 400);
    // refractory を十分越えた offset で、historyLen 未満 (5フレーム) のスラストを与える
    const O = 5000;
    const seq = attackSequence();
    let activeWithin5 = false;
    for (let i = 0; i < 5; i++) {
      const f = seq[i]!;
      const r = d.update(f.world, O + f.t);
      if (r.active) activeWithin5 = true;
    }
    // 履歴がクリアされていれば 5 フレームではバッファが埋まらず発火不可
    expect(activeWithin5).toBe(false);
    // 6 フレーム目でバッファが揃い、refractory も過ぎているので発火
    const f6 = seq[5]!;
    const r6 = d.update(f6.world, O + f6.t);
    expect(r6.active).toBe(true);
  });
});
