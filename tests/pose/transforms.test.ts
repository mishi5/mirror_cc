import { describe, it, expect } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  mirrorLandmarks,
  selectKeyJoints,
  isVisible,
} from "../../src/pose/transforms";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../../src/pose/constants";

function makeLandmark(
  x: number,
  y: number,
  z = 0,
  visibility = 1,
): NormalizedLandmark {
  return { x, y, z, visibility };
}

function makeLandmarkArray(count: number): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(makeLandmark(i / count, 0.5, 0, 1));
  }
  return arr;
}

describe("mirrorLandmarks", () => {
  it("各ランドマークの x を 1 - x に変換する", () => {
    const input: NormalizedLandmark[] = [
      makeLandmark(0.25, 0.5, 0.5, 0.875),
      makeLandmark(0.75, 0.5, -0.125, 0.5),
    ];
    const result = mirrorLandmarks(input);
    expect(result[0]).toEqual({ x: 0.75, y: 0.5, z: 0.5, visibility: 0.875 });
    expect(result[1]).toEqual({ x: 0.25, y: 0.5, z: -0.125, visibility: 0.5 });
  });

  it("y / z / visibility は不変", () => {
    const lm = makeLandmark(0.4, 0.6, 0.2, 0.75);
    const [out] = mirrorLandmarks([lm]);
    expect(out?.y).toBe(0.6);
    expect(out?.z).toBe(0.2);
    expect(out?.visibility).toBe(0.75);
  });

  it("入力配列を変更しない (純粋)", () => {
    const input: NormalizedLandmark[] = [makeLandmark(0.2, 0.3)];
    const frozen = JSON.stringify(input);
    mirrorLandmarks(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("空配列は空配列を返す", () => {
    expect(mirrorLandmarks([])).toEqual([]);
  });
});

describe("selectKeyJoints", () => {
  it("33点の中から 9 点を正しいインデックスで抽出する", () => {
    const all = makeLandmarkArray(33);
    const keys = selectKeyJoints(all);
    expect(keys.nose).toBe(all[KEY_JOINT_INDICES.NOSE]);
    expect(keys.leftShoulder).toBe(all[KEY_JOINT_INDICES.LEFT_SHOULDER]);
    expect(keys.rightShoulder).toBe(all[KEY_JOINT_INDICES.RIGHT_SHOULDER]);
    expect(keys.leftElbow).toBe(all[KEY_JOINT_INDICES.LEFT_ELBOW]);
    expect(keys.rightElbow).toBe(all[KEY_JOINT_INDICES.RIGHT_ELBOW]);
    expect(keys.leftWrist).toBe(all[KEY_JOINT_INDICES.LEFT_WRIST]);
    expect(keys.rightWrist).toBe(all[KEY_JOINT_INDICES.RIGHT_WRIST]);
    expect(keys.leftIndex).toBe(all[KEY_JOINT_INDICES.LEFT_INDEX]);
    expect(keys.rightIndex).toBe(all[KEY_JOINT_INDICES.RIGHT_INDEX]);
  });

  it("33 未満の配列ではエラー", () => {
    expect(() => selectKeyJoints(makeLandmarkArray(20))).toThrow();
  });
});

describe("isVisible", () => {
  it("visibility が閾値以上なら true", () => {
    expect(isVisible(makeLandmark(0, 0, 0, 0.6), 0.5)).toBe(true);
  });

  it("visibility が閾値未満なら false", () => {
    expect(isVisible(makeLandmark(0, 0, 0, 0.3), 0.5)).toBe(false);
  });

  it("visibility が閾値ちょうどなら true", () => {
    expect(isVisible(makeLandmark(0, 0, 0, 0.5), 0.5)).toBe(true);
  });

  it("visibility が undefined なら false (0 扱い)", () => {
    // visibility プロパティが実行時に存在しないケースを模倣するため型アサーションを使う
    const lm = { x: 0, y: 0, z: 0 } as NormalizedLandmark;
    expect(isVisible(lm, 0.5)).toBe(false);
  });

  it("閾値を省略すると DEFAULT_VISIBILITY_THRESHOLD を使う", () => {
    expect(isVisible(makeLandmark(0, 0, 0, DEFAULT_VISIBILITY_THRESHOLD))).toBe(true);
    expect(
      isVisible(makeLandmark(0, 0, 0, DEFAULT_VISIBILITY_THRESHOLD - 0.01)),
    ).toBe(false);
  });
});
