import { describe, it, expect } from "vitest";
import { createGuardDetector } from "../../../src/pose/detectors/guard";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, guardPose, makeWorld } from "./fixtures";
import { KEY_JOINT_INDICES } from "../../../src/pose/constants";

const P = DEFAULT_DETECTOR_PARAMS.guard;

const K = KEY_JOINT_INDICES;

/**
 * 顔の高さ・顔より前だが「交差していない」world。
 * face / forward ゲートは通るが cross ゲートだけで弾かれることを検証するため。
 * 肩 x=±0.18 → center x=0。非交差: 左手首 x>0 (左肩と同じ +x 側), 右手首 x<0。
 */
function uncrossedGuardWorld() {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_WRIST]: { x: 0.1, y: -0.6, z: -0.2 },
    [K.RIGHT_WRIST]: { x: -0.1, y: -0.6, z: -0.2 },
  });
}

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

  it("face/forward は満たすが交差していないと score=0 / active=false", () => {
    const d = createGuardDetector(P);
    const r = d.update(uncrossedGuardWorld(), 0);
    expect(r.score).toBe(0);
    expect(r.active).toBe(false);
  });

  it("null 入力で active=false / score 0", () => {
    const d = createGuardDetector(P);
    const r = d.update(null, 0);
    expect(r.active).toBe(false);
    expect(r.score).toBe(0);
  });

  it("G-T1: hold 中に1フレーム条件が切れるとタイマーがリセットされ早期 active しない", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);
    d.update(idlePose(), 100);            // 中断 → candidate リセット
    d.update(guardPose(), 150);           // 再開始 (candidateSince=150)
    const mid = d.update(guardPose(), 250); // 250-150=100 < minHoldMs(150)? minHoldMs=150 → 100<150
    expect(mid.active).toBe(false);
    const late = d.update(guardPose(), 360); // 360-150=210 >= 150
    expect(late.active).toBe(true);
  });

  it("G-T4: active→idle 遷移テストで中間状態を明示 assert", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);
    const r1 = d.update(guardPose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true); // 前提を明示
    d.update(idlePose(), P.minHoldMs + 2);
    const r = d.update(idlePose(), P.minHoldMs + 2 + P.releaseMs + 5);
    expect(r.active).toBe(false);
  });

  it("G-held: held= が hold 開始からの累積時間として正しい数値 (I-1 回帰防止)", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);                       // enterCandidateSince=0
    d.update(guardPose(), P.minHoldMs + 1);         // active, activeSince=0
    const r = d.update(guardPose(), P.minHoldMs + 500);
    expect(r.detail).toBeDefined();
    const heldMs = Number(/held=(\d+)ms/.exec(r.detail ?? "")?.[1]);
    // activeSince=enterCandidateSince=0 なので held = minHoldMs+500
    expect(heldMs).toBeGreaterThanOrEqual(P.minHoldMs + 500);
  });

  it("G-null-resets-activeSince: active 中に null を渡すと held がリセットされ再 hold で小さい値から", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);
    d.update(guardPose(), P.minHoldMs + 1);
    const big = d.update(guardPose(), P.minHoldMs + 5000);
    const bigHeld = Number(/held=(\d+)ms/.exec(big.detail ?? "")?.[1]);
    expect(bigHeld).toBeGreaterThanOrEqual(P.minHoldMs + 5000);
    // null で状態リセット
    const afterNull = d.update(null, P.minHoldMs + 5001);
    expect(afterNull.active).toBe(false);
    expect(afterNull.score).toBe(0);
    // 再 hold: 新しい enterCandidateSince から
    const t0 = 100000;
    d.update(guardPose(), t0);
    d.update(guardPose(), t0 + P.minHoldMs + 1);
    const fresh = d.update(guardPose(), t0 + P.minHoldMs + 50);
    const freshHeld = Number(/held=(\d+)ms/.exec(fresh.detail ?? "")?.[1]);
    expect(freshHeld).toBeLessThan(bigHeld); // 古い累積を引き継がない
  });

  it("G-T5: active 中に1フレーム交差が崩れても releaseMs 未満なら active 維持し held 継続", () => {
    const d = createGuardDetector(P);
    d.update(guardPose(), 0);
    const r1 = d.update(guardPose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true);
    const jitter = d.update(idlePose(), P.minHoldMs + 50);
    expect(jitter.active).toBe(true);
    const back = d.update(guardPose(), P.minHoldMs + 70);
    expect(back.active).toBe(true);
    const heldMs = Number(/held=(\d+)ms/.exec(back.detail ?? "")?.[1]);
    expect(heldMs).toBeGreaterThanOrEqual(P.minHoldMs);
  });
});
