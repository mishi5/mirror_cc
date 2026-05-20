import { describe, it, expect } from "vitest";
import { createAttackDetector } from "../../../src/pose/detectors/attack";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import {
  attackSequence,
  flatExtensionSequence,
  forwardPunchSequence,
  armsDownStraightenSequence,
  makeWorld,
} from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.attack;

describe("createAttackDetector", () => {
  it("charge gate が閉じていれば伸展バーストでも発火しない", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of attackSequence()) {
      if (d.update(f.world, f.t, false).active) sawActive = true;
    }
    expect(sawActive).toBe(false);
  });

  it("gate 開 + 伸展バーストで attack が検出される", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of attackSequence()) {
      if (d.update(f.world, f.t, true).active) sawActive = true;
    }
    expect(sawActive).toBe(true);
  });

  it("gate 開でも伸展が変化しなければ発火しない", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of flatExtensionSequence()) {
      if (d.update(f.world, f.t, true).active) sawActive = true;
    }
    expect(sawActive).toBe(false);
  });

  it("発火後 refractoryMs 以内は再発火しない", () => {
    const d = createAttackDetector(P);
    const seq = attackSequence();
    let firstFireT: number | null = null;
    for (const f of seq) {
      if (d.update(f.world, f.t, true).active && firstFireT === null) {
        firstFireT = f.t;
      }
    }
    expect(firstFireT).not.toBeNull();
    const last = seq[seq.length - 1]!;
    const r = d.update(last.world, last.t + 10, true);
    expect(r.active).toBe(false);
  });

  it("バースト途中の null フレームで履歴は消えず発火する", () => {
    const d = createAttackDetector(P);
    const seq = attackSequence();
    let sawActive = false;
    sawActive = d.update(seq[0]!.world, seq[0]!.t, true).active || sawActive;
    sawActive = d.update(seq[1]!.world, seq[1]!.t, true).active || sawActive;
    sawActive = d.update(null, 120, true).active || sawActive; // 履歴クリアしない
    sawActive = d.update(seq[3]!.world, seq[3]!.t, true).active || sawActive;
    sawActive = d.update(seq[4]!.world, seq[4]!.t, true).active || sawActive;
    sawActive = d.update(seq[5]!.world, seq[5]!.t, true).active || sawActive;
    expect(sawActive).toBe(true);
  });

  it("detail に ext/eΔ/str/sΔ/gate/peak を出す", () => {
    const d = createAttackDetector(P);
    let last = d.update(makeWorld({}), 0, true);
    for (const f of attackSequence()) last = d.update(f.world, f.t, true);
    expect(last.detail).toMatch(
      /ext=.* eΔ=.* str=.* sΔ=.* gate=[01] pkE=[0-9.]+ pkS=[0-9.]+/,
    );
  });

  it("前向きパンチ (肘ストレートネス バースト) でも発火する", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of forwardPunchSequence()) {
      if (d.update(f.world, f.t, true).active) sawActive = true;
    }
    expect(sawActive).toBe(true);
  });

  it("腕が垂れた状態で肘が伸びても発火しない (arms-down 幾何ゲート)", () => {
    const d = createAttackDetector(P);
    let sawActive = false;
    for (const f of armsDownStraightenSequence()) {
      if (d.update(f.world, f.t, true).active) sawActive = true;
    }
    expect(sawActive).toBe(false);
  });

  it("インスタンスごとに履歴が独立", () => {
    const a = createAttackDetector(P);
    const b = createAttackDetector(P);
    for (const f of attackSequence()) a.update(f.world, f.t, true);
    let rb = { active: false } as { active: boolean };
    for (const f of flatExtensionSequence()) rb = b.update(f.world, f.t, true);
    expect(rb.active).toBe(false);
  });
});
