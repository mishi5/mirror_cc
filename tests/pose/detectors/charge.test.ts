import { describe, it, expect } from "vitest";
import { createChargeDetector } from "../../../src/pose/detectors/charge";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, chargePose, guardPose, makeWorld } from "./fixtures";
import { KEY_JOINT_INDICES } from "../../../src/pose/constants";

const P = DEFAULT_DETECTOR_PARAMS.charge;

const K = KEY_JOINT_INDICES;

/** forward ≈ 0.5 (wrist z=-0.05, forwardZ=0.1), band/closeness=1 → rawScore ≈ 0.5 */
function partialChargeWorld() {
  return makeWorld({
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_WRIST]: { x: 0.1, y: -0.25, z: -0.05 },
    [K.RIGHT_WRIST]: { x: -0.1, y: -0.25, z: -0.05 },
  });
}

/** charge と同じだが手首 y が高さ帯外 (y=0.2、肩 -0.5 + yBandHigh 0.45 = -0.05 を大きく超過) */
function outOfBandWorld() {
  return makeWorld({
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_WRIST]: { x: 0.1, y: 0.2, z: -0.28 },
    [K.RIGHT_WRIST]: { x: -0.1, y: 0.2, z: -0.28 },
  });
}

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

  it("T-1: hold 中に1フレームでも条件が切れるとタイマーがリセットされ早期 active しない", () => {
    const d = createChargeDetector(P);
    d.update(chargePose(), 0);          // candidate 開始
    d.update(idlePose(), 100);          // 中断 → candidate リセット
    d.update(chargePose(), 150);        // 再開始 (candidateSince=150)
    const mid = d.update(chargePose(), 250); // 250-150=100 < minHoldMs(200)
    expect(mid.active).toBe(false);
    const late = d.update(chargePose(), 360); // 360-150=210 >= 200
    expect(late.active).toBe(true);
  });

  it("T-2: active 中に score がヒステリシス帯 [exit,enter) でも active を維持", () => {
    const d = createChargeDetector(P);
    d.update(chargePose(), 0);
    const r1 = d.update(chargePose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true);
    const band = d.update(partialChargeWorld(), P.minHoldMs + 200);
    expect(band.score).toBeGreaterThanOrEqual(P.exitScore);
    expect(band.score).toBeLessThan(P.enterScore);
    expect(band.active).toBe(true); // exitScore を下回らない限り維持
  });

  it("T-3: 手首が高さ帯を外れると score=0 (band の hard gate)", () => {
    const d = createChargeDetector(P);
    const r = d.update(outOfBandWorld(), 0);
    expect(r.score).toBe(0);
    expect(r.active).toBe(false);
  });

  it("T-4: active→idle 遷移テストで中間状態を明示 assert", () => {
    const d = createChargeDetector(P);
    d.update(chargePose(), 0);
    const r1 = d.update(chargePose(), P.minHoldMs + 1);
    expect(r1.active).toBe(true); // 前提を明示
    const r = d.update(idlePose(), P.minHoldMs + 200);
    expect(r.active).toBe(false);
  });

  it("guard 姿勢 (手首が顔の高さ) は faceExcl で charge から除外され score=0", () => {
    const d = createChargeDetector(P);
    // guardPose: 手首 y≈-0.6, nose y=-0.62 → |diff|≈0.02 <= faceExclY(0.15) → 除外
    const r = d.update(guardPose(), 0);
    expect(r.score).toBe(0);
    expect(r.active).toBe(false);
  });
});
