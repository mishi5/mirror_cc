import { describe, it, expect } from "vitest";
import { createAttackDetector } from "../../../src/pose/detectors/attack";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, attackSequence, makeWorld } from "./fixtures";
import { KEY_JOINT_INDICES } from "../../../src/pose/constants";

const P = DEFAULT_DETECTOR_PARAMS.attack;
const K = KEY_JOINT_INDICES;

describe("createAttackDetector", () => {
  it("静止 (idle) では窓が埋まっても active=false", () => {
    const d = createAttackDetector(P);
    let r = { active: false, score: 0 } as { active: boolean; score: number };
    for (let i = 0; i < 8; i++) {
      r = d.update(idlePose(), i * 40);
    }
    expect(r.active).toBe(false);
  });

  it("前方への急速移動で attack が検出される", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of attackSequence()) {
      if (d.update(f.world, f.t).active) sawActive = true;
    }
    expect(sawActive).toBe(true);
  });

  it("発火後 refractoryMs 以内は再発火しない", () => {
    const d = createAttackDetector(P);
    const seq = attackSequence();
    let fired = false;
    for (const f of seq) {
      if (d.update(f.world, f.t).active) fired = true;
    }
    expect(fired).toBe(true);
    const lastT = seq[seq.length - 1]!.t;
    const r2 = d.update(seq[seq.length - 1]!.world, lastT + 10);
    expect(r2.active).toBe(false);
  });

  it("RC-1 回帰: スラスト途中の低 visibility フレームで履歴が消えず発火する", () => {
    const d = createAttackDetector(P);
    // a0,a1 を通常供給 → blur フレーム (手首 visibility 0.2、push されない) → a3,a4,a5
    const seq = attackSequence();
    let sawActive = false;
    sawActive = d.update(seq[0]!.world, seq[0]!.t).active || sawActive;
    sawActive = d.update(seq[1]!.world, seq[1]!.t).active || sawActive;
    const blur = makeWorld({
      [K.LEFT_WRIST]: { x: 0.15, y: -0.35, z: -0.17, visibility: 0.2 },
      [K.RIGHT_WRIST]: { x: -0.15, y: -0.35, z: -0.17, visibility: 0.2 },
    });
    sawActive = d.update(blur, 120).active || sawActive;
    sawActive = d.update(seq[3]!.world, seq[3]!.t).active || sawActive;
    sawActive = d.update(seq[4]!.world, seq[4]!.t).active || sawActive;
    sawActive = d.update(seq[5]!.world, seq[5]!.t).active || sawActive;
    expect(sawActive).toBe(true);
  });

  it("null 入力でも履歴は消えず、その後のスラストで発火する", () => {
    const d = createAttackDetector(P);
    const seq = attackSequence();
    let sawActive = false;
    sawActive = d.update(seq[0]!.world, seq[0]!.t).active || sawActive;
    sawActive = d.update(seq[1]!.world, seq[1]!.t).active || sawActive;
    sawActive = d.update(null, 120).active || sawActive;
    sawActive = d.update(seq[3]!.world, seq[3]!.t).active || sawActive;
    sawActive = d.update(seq[4]!.world, seq[4]!.t).active || sawActive;
    sawActive = d.update(seq[5]!.world, seq[5]!.t).active || sawActive;
    expect(sawActive).toBe(true);
  });

  it("古いサンプルは windowMs で失効し、長時間後の静止で誤発火しない", () => {
    const d = createAttackDetector(P);
    for (const f of attackSequence()) d.update(f.world, f.t); // ~t300 で発火
    // 長時間ギャップ後に静止 → 古いスラストサンプルは windowMs(250) 失効
    let r = { active: false } as { active: boolean };
    for (let i = 0; i < 6; i++) {
      r = d.update(idlePose(), 10000 + i * 40);
    }
    expect(r.active).toBe(false);
  });

  it("detail に speed/dist を出す", () => {
    const d = createAttackDetector(P);
    let last = d.update(idlePose(), 0);
    for (const f of attackSequence()) last = d.update(f.world, f.t);
    expect(last.detail).toMatch(/spd=.* dst=.*/);
  });

  it("インスタンスごとに履歴が独立", () => {
    const a = createAttackDetector(P);
    const b = createAttackDetector(P);
    for (const f of attackSequence()) a.update(f.world, f.t);
    let rb = { active: false } as { active: boolean };
    for (let i = 0; i < 8; i++) rb = b.update(idlePose(), i * 40);
    expect(rb.active).toBe(false);
  });
});
