# Phase 2 (モーション判定: チャージ / ガード / アタック) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 の `PoseFrame.worldLandmarks` から チャージ / ガード / アタック の3姿勢を判定し、ヒステリシス・最小持続を備えた単一の `PoseAction` 状態機械として提供する。デバッグ HUD に判定結果と内部スコアを表示する。

**Architecture:** worldLandmarks (3D, 腰中点原点メートル) を Vec3 として扱う pure な `geometry.ts` を核に、各姿勢ディテクタを「プレイヤー単位のインスタンス状態」を持つファクトリ関数で実装。`action-detector.ts` が3ディテクタを優先度合成して `PoseAction` を出力。`App` は単一インスタンスを保持し毎フレーム供給 (将来 `Map<poseIndex,...>` で2人化可能)。

**Tech Stack:** TypeScript 5 (strict), Vitest, `@mediapipe/tasks-vision` (型のみ), 2D Canvas (debug HUD)

**対象 Issue:** https://github.com/mishi5/mirror_cc/issues/4 (親: #1, 依存: #3)
**Spec:** `docs/superpowers/specs/2026-05-17-4-motion-detectors-design.md`

---

## File Structure

```
src/pose/detectors/
  types.ts            # Create: PoseAction, DetectorScore, ActionDetectorResult
  params.ts           # Create: DetectorParams + DEFAULT_DETECTOR_PARAMS
  geometry.ts         # Create: Vec3 + ベクトル演算 + jointVec (pure, テスト核)
  charge.ts           # Create: createChargeDetector
  guard.ts            # Create: createGuardDetector
  attack.ts           # Create: createAttackDetector (速度ベース, フレーム履歴)
  action-detector.ts  # Create: createActionDetector (状態機械)
src/debug/
  action-hud.ts       # Create: ActionHud (PoseAction + 3スコア表示)
tests/pose/detectors/
  fixtures.ts         # Create: 各姿勢の代表 worldLandmarks 配列
  geometry.test.ts    # Create
  charge.test.ts      # Create
  guard.test.ts       # Create
  attack.test.ts      # Create
  action-detector.test.ts # Create
index.html            # Modify: #hud に action / score 行を追加
src/app.ts            # Modify: ActionDetector + ActionHud を統合
```

`src/pose/detectors/` は Phase 0 で `.gitkeep` 済み。

座標系の符号 (threejs-art 経験則, 全ディテクタ共通):
- x: 正 = カメラ右 (subject の左肩 idx11 は x 正)
- y: 正 = 下 (鼻は肩より y が小さい=負方向)
- z: 負 = カメラに近い (前方)。「前に出す」= z が負方向へ増加
- 原点: 両腰中点

---

### Task 1: 型定義 (`detectors/types.ts`)

**Files:**
- Create: `src/pose/detectors/types.ts`

- [ ] **Step 1: types.ts を作成**

```ts
/**
 * ゲーム入力となる姿勢アクション。action-detector が単一値で出力する。
 */
export type PoseAction = "idle" | "charging" | "guarding" | "attacking";

/**
 * 各ディテクタの内部状態。score は連続値 (閾値との距離が分かる) でデバッグ表示に使う。
 * active はヒステリシス・最小持続適用後の最終判定。
 */
export interface DetectorScore {
  readonly active: boolean;
  readonly score: number;
  readonly detail?: string;
}

/**
 * action-detector の 1 フレーム出力。action は優先度合成結果、
 * 各スコアはデバッグ可視化用に同梱する。
 */
export interface ActionDetectorResult {
  readonly action: PoseAction;
  readonly charge: DetectorScore;
  readonly guard: DetectorScore;
  readonly attack: DetectorScore;
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: exit 0, 0 warning

- [ ] **Step 4: コミット**

```bash
git add src/pose/detectors/types.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors の型を追加 (PoseAction, DetectorScore, ActionDetectorResult)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: パラメータ (`detectors/params.ts`)

**Files:**
- Create: `src/pose/detectors/params.ts`

- [ ] **Step 1: params.ts を作成**

すべて worldLandmarks のメートル単位。値はチューニング前提の初期値 (デバッグ HUD で実測しながら調整する)。

```ts
/**
 * 全ディテクタの判定パラメータ。値はチューニング前提の初期値。
 * 距離は worldLandmarks のメートル、時間は ms、速度は m/s。
 * 「前方」は z が負方向 (カメラに近い側)。
 */
export interface DetectorParams {
  readonly charge: {
    /** 手首が肩より前 (z 負方向) に必要な最小量 (m) */
    readonly forwardZ: number;
    /** 左右手首間の最大許容距離 (m)。体の前に寄せている判定 */
    readonly maxHandSpread: number;
    /** 手首 y の許容下限オフセット (肩 y 基準, y 正=下なので負で肩より上) */
    readonly yBandLow: number;
    /** 手首 y の許容上限オフセット (肩 y 基準) */
    readonly yBandHigh: number;
    readonly enterScore: number;
    readonly exitScore: number;
    readonly minHoldMs: number;
  };
  readonly guard: {
    /** |wrist.y - nose.y| 許容 (m)。顔の高さ帯 */
    readonly faceBandY: number;
    /** 手首が鼻より前 (z 負方向) の最小量 (m) */
    readonly forwardZ: number;
    readonly enterScore: number;
    readonly exitScore: number;
    readonly minHoldMs: number;
  };
  readonly attack: {
    /** フレーム履歴本数 */
    readonly historyLen: number;
    /** 前方速度閾値 (m/s) */
    readonly thrustSpeed: number;
    /** 履歴最古フレームからの前方移動量の最小値 (m) */
    readonly minThrustDist: number;
    /** 連続発火抑止時間 (ms)。姿勢の再発火抑止であり、ゲームのガードクールタイムとは別 */
    readonly refractoryMs: number;
  };
}

export const DEFAULT_DETECTOR_PARAMS: DetectorParams = {
  charge: {
    forwardZ: 0.1,
    maxHandSpread: 0.45,
    yBandLow: -0.1,
    yBandHigh: 0.45,
    enterScore: 0.6,
    exitScore: 0.4,
    minHoldMs: 200,
  },
  guard: {
    faceBandY: 0.2,
    forwardZ: 0.05,
    enterScore: 0.6,
    exitScore: 0.4,
    minHoldMs: 150,
  },
  attack: {
    historyLen: 6,
    thrustSpeed: 0.8,
    minThrustDist: 0.15,
    refractoryMs: 500,
  },
};
```

- [ ] **Step 2: 型チェック & lint (separate calls)**

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `npm run lint`
Expected: exit 0, 0 warning

- [ ] **Step 3: コミット**

```bash
git add src/pose/detectors/params.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors のパラメータ定義 (DetectorParams + DEFAULT_DETECTOR_PARAMS)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: geometry.ts (TDD, pure ベクトル演算 + 関節アクセス)

**Files:**
- Create: `tests/pose/detectors/geometry.test.ts`
- Create: `src/pose/detectors/geometry.ts`

- [ ] **Step 1: テストを先に書く**

```ts
import { describe, it, expect } from "vitest";
import {
  toVec3,
  sub,
  length,
  midpoint,
  dot,
  jointVec,
} from "../../../src/pose/detectors/geometry";

describe("toVec3", () => {
  it("x/y/z だけを取り出す (visibility 無視)", () => {
    expect(toVec3({ x: 1, y: 2, z: 3, visibility: 0.9 })).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("sub", () => {
  it("成分ごとに減算する", () => {
    expect(sub({ x: 5, y: 3, z: 1 }, { x: 1, y: 1, z: 1 })).toEqual({ x: 4, y: 2, z: 0 });
  });
});

describe("length", () => {
  it("ユークリッドノルム", () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBe(5);
  });
  it("ゼロベクトルは 0", () => {
    expect(length({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe("midpoint", () => {
  it("2点の中点", () => {
    expect(midpoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 })).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("dot", () => {
  it("内積", () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });
});

describe("jointVec", () => {
  const world = [
    { x: 0, y: 0, z: 0, visibility: 0.9 },
    { x: 1, y: 1, z: 1, visibility: 0.2 },
    { x: 2, y: 2, z: 2, visibility: 0.8 },
  ];

  it("index の関節を Vec3 で返す", () => {
    expect(jointVec(world, 2, 0.5)).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("visibility が閾値未満なら null", () => {
    expect(jointVec(world, 1, 0.5)).toBeNull();
  });

  it("範囲外 index なら null", () => {
    expect(jointVec(world, 99, 0.5)).toBeNull();
  });

  it("visibility 未定義は 0 扱いで null", () => {
    expect(jointVec([{ x: 1, y: 1, z: 1 }], 0, 0.5)).toBeNull();
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `npm run test`
Expected: `tests/pose/detectors/geometry.test.ts` がモジュール未作成で失敗。既存 13 件 (smoke 2 + transforms 11) は通る。

- [ ] **Step 3: 実装を書く**

```ts
/** worldLandmark を 3D ベクトルとして扱う最小限の純粋演算群。 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** landmark から x/y/z だけ取り出す (visibility は無視)。 */
export function toVec3(lm: { x: number; y: number; z: number }): Vec3 {
  return { x: lm.x, y: lm.y, z: lm.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * worldLandmarks 配列から index の関節を Vec3 で取得する。
 * 範囲外、または visibility が minVisibility 未満なら null (検出途切れは正常系)。
 */
export function jointVec(
  world: ReadonlyArray<Readonly<{ x: number; y: number; z: number; visibility?: number }>>,
  index: number,
  minVisibility: number,
): Vec3 | null {
  const lm = world[index];
  if (!lm) return null;
  if ((lm.visibility ?? 0) < minVisibility) return null;
  return { x: lm.x, y: lm.y, z: lm.z };
}
```

- [ ] **Step 4: テスト実行 → 通過を確認**

Run: `npm run test`
Expected: geometry.test.ts の 10 ケース + 既存 13 = 計 23 件パス

- [ ] **Step 5: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/detectors/geometry.test.ts src/pose/detectors/geometry.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors/geometry.ts に Vec3 演算と jointVec を追加 (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: テストフィクスチャ (`tests/pose/detectors/fixtures.ts`)

各姿勢の代表 worldLandmarks (33 点) を生成するヘルパ。座標系: x 正=右, y 正=下, z 負=前。原点=腰中点。

**Files:**
- Create: `tests/pose/detectors/fixtures.ts`

- [ ] **Step 1: fixtures.ts を作成**

`@mediapipe/tasks-vision` の `Landmark` 型 (= {x,y,z,visibility}) に合わせる。必要な関節 (KEY_JOINT_INDICES) だけ意味のある値を入れ、他は原点・低 visibility で埋める。

```ts
import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES } from "../../../src/pose/constants";

/** 33 点を visibility 0 のダミーで初期化し、指定 index だけ上書きする。 */
export function makeWorld(
  overrides: Record<number, { x: number; y: number; z: number; visibility?: number }>,
): Landmark[] {
  const world: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    world.push({ x: 0, y: 0, z: 0, visibility: 0 });
  }
  for (const [idxStr, v] of Object.entries(overrides)) {
    const idx = Number(idxStr);
    world[idx] = { x: v.x, y: v.y, z: v.z, visibility: v.visibility ?? 0.95 };
  }
  return world;
}

const K = KEY_JOINT_INDICES;

/** 直立・腕を下げた idle 姿勢。肩より下に手首、前後 z はほぼ 0。 */
export function idlePose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.2, y: -0.25, z: 0 },
    [K.RIGHT_ELBOW]: { x: -0.2, y: -0.25, z: 0 },
    [K.LEFT_WRIST]: { x: 0.21, y: 0.0, z: 0 },
    [K.RIGHT_WRIST]: { x: -0.21, y: 0.0, z: 0 },
    [K.LEFT_INDEX]: { x: 0.21, y: 0.08, z: 0 },
    [K.RIGHT_INDEX]: { x: -0.21, y: 0.08, z: 0 },
  });
}

/** 両手を体の前 (z 負方向) で胸〜腹の高さ、左右を寄せたチャージ姿勢。 */
export function chargePose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.16, y: -0.3, z: -0.15 },
    [K.RIGHT_ELBOW]: { x: -0.16, y: -0.3, z: -0.15 },
    [K.LEFT_WRIST]: { x: 0.1, y: -0.25, z: -0.28 },
    [K.RIGHT_WRIST]: { x: -0.1, y: -0.25, z: -0.28 },
    [K.LEFT_INDEX]: { x: 0.08, y: -0.25, z: -0.32 },
    [K.RIGHT_INDEX]: { x: -0.08, y: -0.25, z: -0.32 },
  });
}

/** 両手首を顔の高さで左右交差させ、顔の前 (z 負) に置いたガード姿勢。 */
export function guardPose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.1, y: -0.45, z: -0.15 },
    [K.RIGHT_ELBOW]: { x: -0.1, y: -0.45, z: -0.15 },
    // 交差: 左手首 (本来 x 正側) が x 負側へ、右手首が x 正側へ
    [K.LEFT_WRIST]: { x: -0.08, y: -0.6, z: -0.2 },
    [K.RIGHT_WRIST]: { x: 0.08, y: -0.6, z: -0.2 },
    [K.LEFT_INDEX]: { x: -0.1, y: -0.62, z: -0.22 },
    [K.RIGHT_INDEX]: { x: 0.1, y: -0.62, z: -0.22 },
  });
}

/**
 * アタックのフレーム列。手首が時間とともに前方 (z 負方向) へ急速移動する。
 * 各要素は { world, t } で t は ms。
 */
export function attackSequence(): ReadonlyArray<{ world: Landmark[]; t: number }> {
  const frames: { world: Landmark[]; t: number }[] = [];
  const baseZ = -0.05;
  for (let i = 0; i < 6; i++) {
    const z = baseZ - i * 0.06; // 1 フレーム 60ms で 0.06m 前進 ≈ 1.0 m/s
    frames.push({
      t: i * 60,
      world: makeWorld({
        [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
        [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
        [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
        [K.LEFT_WRIST]: { x: 0.15, y: -0.35, z: z },
        [K.RIGHT_WRIST]: { x: -0.15, y: -0.35, z: z },
      }),
    });
  }
  return frames;
}
```

- [ ] **Step 2: 型チェック (fixtures 単体では未使用なので tsc のみ)**

Run: `npx tsc --noEmit`
Expected: exit 0 (※ fixtures.ts は `include` の tests 配下。未使用 export の lint エラーが出る場合は次タスクで参照されるため、この時点では tsc のみ確認)

- [ ] **Step 3: コミット**

```bash
git add tests/pose/detectors/fixtures.ts
git commit -m "$(cat <<'EOF'
#4 test: detectors テスト用の worldLandmarks フィクスチャを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: charge.ts (TDD)

**Files:**
- Create: `tests/pose/detectors/charge.test.ts`
- Create: `src/pose/detectors/charge.ts`

- [ ] **Step 1: テストを書く**

```ts
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
    // 0ms 時点では hold 未達で active=false
    const r0 = d.update(chargePose(), 0);
    expect(r0.score).toBeGreaterThanOrEqual(P.enterScore);
    expect(r0.active).toBe(false);
    // minHoldMs 経過後に active
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
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `npm run test`
Expected: charge.test.ts がモジュール未作成で失敗。geometry.test.ts + 既存は通る。

- [ ] **Step 3: 実装を書く**

```ts
import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, midpoint, length, type Vec3 } from "./geometry";

export interface ChargeDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

/**
 * チャージ姿勢: 両手首が両肩より前 (z 負方向)、肩 y を基準とした高さ帯に収まり、
 * 左右手首間が一定距離以内 (体の前に寄せている)。
 * raw スコア (0..1) に enter/exit ヒステリシスと minHoldMs を適用する。
 */
export function createChargeDetector(
  params: DetectorParams["charge"],
): ChargeDetector {
  let active = false;
  // enter 条件を連続で満たし始めた時刻 (null = 未充足)
  let enterCandidateSince: number | null = null;

  function rawScore(world: ReadonlyArray<Readonly<Landmark>>): number {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !lw || !rw) return 0;

    const shoulder: Vec3 = midpoint(ls, rs);

    // 前方度: 手首が肩より z 負方向にどれだけ出ているか (0..1)
    const fwdL = (shoulder.z - lw.z) / params.forwardZ;
    const fwdR = (shoulder.z - rw.z) / params.forwardZ;
    const forward = clamp01(Math.min(fwdL, fwdR));

    // 高さ帯: 手首 y が [shoulder.y + yBandLow, shoulder.y + yBandHigh] に収まるか
    const inBandL = inBand(lw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const inBandR = inBand(rw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const band = inBandL && inBandR ? 1 : 0;

    // 左右寄せ: 手首間距離が maxHandSpread 以下なら 1、超えると線形減衰
    const spread = length({ x: lw.x - rw.x, y: lw.y - rw.y, z: lw.z - rw.z });
    const closeness = clamp01(1 - Math.max(0, spread - params.maxHandSpread) / params.maxHandSpread);

    // 合成: 全条件の積に近い形 (どれかが 0 なら 0)
    return forward * band * closeness;
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        active = false;
        enterCandidateSince = null;
        return { active: false, score: 0 };
      }
      const score = rawScore(world);

      if (active) {
        if (score < params.exitScore) {
          active = false;
          enterCandidateSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
          }
        } else {
          enterCandidateSince = null;
        }
      }
      return { active, score };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function inBand(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}
```

- [ ] **Step 4: テスト実行 → 通過を確認**

Run: `npm run test`
Expected: charge.test.ts 5 ケース + geometry 10 + 既存 13 = 計 28 件パス

- [ ] **Step 5: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/detectors/charge.test.ts src/pose/detectors/charge.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors/charge.ts チャージ姿勢ディテクタを追加 (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: guard.ts (TDD)

**Files:**
- Create: `tests/pose/detectors/guard.test.ts`
- Create: `src/pose/detectors/guard.ts`

- [ ] **Step 1: テストを書く**

```ts
import { describe, it, expect } from "vitest";
import { createGuardDetector } from "../../../src/pose/detectors/guard";
import { DEFAULT_DETECTOR_PARAMS } from "../../../src/pose/detectors/params";
import { idlePose, guardPose } from "./fixtures";

const P = DEFAULT_DETECTOR_PARAMS.guard;

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

  it("交差していない (手首が肩と同じ側) と active=false", () => {
    const d = createGuardDetector(P);
    // idle は交差していないので score 低
    const r = d.update(idlePose(), 0);
    expect(r.score).toBeLessThan(P.enterScore);
  });

  it("null 入力で active=false / score 0", () => {
    const d = createGuardDetector(P);
    expect(d.update(null, 0)).toEqual({ active: false, score: 0 });
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `npm run test`
Expected: guard.test.ts がモジュール未作成で失敗。

- [ ] **Step 3: 実装を書く**

```ts
import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, midpoint } from "./geometry";

export interface GuardDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

/**
 * ガード姿勢: 両手首が鼻の高さ帯にあり、左右が交差し (左手首が体中心の右側 / 右手首が左側)、
 * 顔より前 (z 負方向)。enter/exit ヒステリシス + minHoldMs。active 中は累積持続 ms を detail に出す。
 */
export function createGuardDetector(
  params: DetectorParams["guard"],
): GuardDetector {
  let active = false;
  let enterCandidateSince: number | null = null;
  let activeSince: number | null = null;
  let lastTs = 0;

  function rawScore(world: ReadonlyArray<Readonly<Landmark>>): number {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const ns = jointVec(world, KEY_JOINT_INDICES.NOSE, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !ns || !lw || !rw) return 0;

    const center = midpoint(ls, rs);

    // 高さ: 両手首が鼻 y ± faceBandY
    const faceL = Math.abs(lw.y - ns.y) <= params.faceBandY;
    const faceR = Math.abs(rw.y - ns.y) <= params.faceBandY;
    if (!faceL || !faceR) return 0;

    // 前方: 両手首が鼻より z 負方向に forwardZ 以上
    const fwdL = ns.z - lw.z >= params.forwardZ;
    const fwdR = ns.z - rw.z >= params.forwardZ;
    if (!fwdL || !fwdR) return 0;

    // 交差: 左肩は x 正側 (threejs-art 経験則)。
    // 非交差時は left wrist が center より x 正、right wrist が x 負。
    // 交差時は符号が反転する。両手首が反対側に来たら 1。
    const leftCrossed = lw.x - center.x < 0;
    const rightCrossed = rw.x - center.x > 0;
    const crossed = leftCrossed && rightCrossed ? 1 : 0;

    return crossed; // 高さ・前方を満たした上で交差していれば 1
  }

  return {
    update(world, timestampMs): DetectorScore {
      lastTs = timestampMs;
      if (!world) {
        active = false;
        enterCandidateSince = null;
        activeSince = null;
        return { active: false, score: 0 };
      }
      const score = rawScore(world);

      if (active) {
        if (score < params.exitScore) {
          active = false;
          enterCandidateSince = null;
          activeSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
            activeSince = timestampMs;
          }
        } else {
          enterCandidateSince = null;
        }
      }

      const detail =
        active && activeSince !== null
          ? `held=${Math.round(lastTs - activeSince)}ms`
          : undefined;
      return { active, score, detail };
    },
  };
}
```

- [ ] **Step 4: テスト実行 → 通過を確認**

Run: `npm run test`
Expected: guard.test.ts 5 + charge 5 + geometry 10 + 既存 13 = 計 33 件パス

- [ ] **Step 5: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/detectors/guard.test.ts src/pose/detectors/guard.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors/guard.ts ガード姿勢ディテクタを追加 (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: attack.ts (TDD, 速度ベース)

**Files:**
- Create: `tests/pose/detectors/attack.test.ts`
- Create: `src/pose/detectors/attack.ts`

- [ ] **Step 1: テストを書く**

```ts
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
    // 直後に同じ前方移動を与えても refractory 中は active=false
    const lastT = seq[seq.length - 1]!.t;
    const r2 = d.update(seq[seq.length - 1]!.world, lastT + 10);
    expect(r2.active).toBe(false);
  });

  it("null 入力で active=false / score 0、履歴は壊さない", () => {
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
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `npm run test`
Expected: attack.test.ts がモジュール未作成で失敗。

- [ ] **Step 3: 実装を書く**

```ts
import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec } from "./geometry";

export interface AttackDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

interface Sample {
  readonly lz: number; // 左手首 z
  readonly rz: number; // 右手首 z
  readonly t: number;
}

/**
 * アタック: 左右どちらかの手首が前方 (z 負方向) へ thrustSpeed (m/s) 以上で移動し、
 * 履歴最古からの前方移動量が minThrustDist 以上。発火後 refractoryMs は再発火しない。
 * 履歴はインスタンス内のリングバッファ (長さ historyLen)。
 */
export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;

  function push(s: Sample): void {
    history.push(s);
    if (history.length > params.historyLen) history.shift();
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        return { active: false, score: 0 };
      }
      const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      if (!lw || !rw) {
        return { active: false, score: 0 };
      }

      push({ lz: lw.z, rz: rw.z, t: timestampMs });
      if (history.length < 2) {
        return { active: false, score: 0 };
      }

      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const dt = (newest.t - oldest.t) / 1000; // s
      if (dt <= 0) {
        return { active: false, score: 0 };
      }

      // 前方移動量 (z 負方向 = oldest.z - newest.z が正)
      const distL = oldest.lz - newest.lz;
      const distR = oldest.rz - newest.rz;
      const dist = Math.max(distL, distR);
      const speed = dist / dt; // m/s

      const score = clamp01(speed / params.thrustSpeed);

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;

      const active =
        !refractory &&
        speed >= params.thrustSpeed &&
        dist >= params.minThrustDist;

      if (active) {
        lastFireMs = timestampMs;
      }
      return { active, score };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
```

- [ ] **Step 4: テスト実行 → 通過を確認**

Run: `npm run test`
Expected: attack.test.ts 5 + guard 5 + charge 5 + geometry 10 + 既存 13 = 計 38 件パス

- [ ] **Step 5: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/detectors/attack.test.ts src/pose/detectors/attack.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors/attack.ts 速度ベースのアタックディテクタを追加 (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: action-detector.ts (TDD, 状態機械)

**Files:**
- Create: `tests/pose/detectors/action-detector.test.ts`
- Create: `src/pose/detectors/action-detector.ts`

- [ ] **Step 1: テストを書く**

```ts
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
    // guard 姿勢は charge 条件を満たさないが、優先度確認のため guard 成立を検証
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
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `npm run test`
Expected: action-detector.test.ts がモジュール未作成で失敗。

- [ ] **Step 3: 実装を書く**

```ts
import type { Landmark } from "@mediapipe/tasks-vision";
import { DEFAULT_DETECTOR_PARAMS, type DetectorParams } from "./params";
import type { ActionDetectorResult, PoseAction } from "./types";
import { createChargeDetector, type ChargeDetector } from "./charge";
import { createGuardDetector, type GuardDetector } from "./guard";
import { createAttackDetector, type AttackDetector } from "./attack";

export interface ActionDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): ActionDetectorResult;
}

/**
 * 3 ディテクタを束ね、優先度 attacking > guarding > charging > idle で
 * 単一の PoseAction を出力する。各ディテクタが既にヒステリシス/最小持続を
 * 持つため、状態機械側で二重のヒステリシスは入れない。
 * 全状態をインスタンス内に閉じる (将来 Map<poseIndex,ActionDetector> で2人化)。
 */
export function createActionDetector(
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS,
): ActionDetector {
  const charge: ChargeDetector = createChargeDetector(params.charge);
  const guard: GuardDetector = createGuardDetector(params.guard);
  const attack: AttackDetector = createAttackDetector(params.attack);

  return {
    update(world, timestampMs): ActionDetectorResult {
      const c = charge.update(world, timestampMs);
      const g = guard.update(world, timestampMs);
      const a = attack.update(world, timestampMs);

      let action: PoseAction = "idle";
      if (a.active) action = "attacking";
      else if (g.active) action = "guarding";
      else if (c.active) action = "charging";

      return { action, charge: c, guard: g, attack: a };
    },
  };
}
```

- [ ] **Step 4: テスト実行 → 通過を確認**

Run: `npm run test`
Expected: action-detector.test.ts 6 + attack 5 + guard 5 + charge 5 + geometry 10 + 既存 13 = 計 44 件パス

- [ ] **Step 5: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/detectors/action-detector.test.ts src/pose/detectors/action-detector.ts
git commit -m "$(cat <<'EOF'
#4 feat: detectors/action-detector.ts 状態機械を追加 (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: デバッグ HUD (`src/debug/action-hud.ts` + index.html)

**Files:**
- Create: `src/debug/action-hud.ts`
- Modify: `index.html`

- [ ] **Step 1: index.html の `#hud` に行を追加**

既存 `#hud` ブロック (Phase 1):

```html
      <div id="hud" hidden>
        <span id="hud-fps">FPS: —</span>
        <span id="hud-detect">detect: — ms</span>
      </div>
```

を以下に置き換える (Edit で `#hud` ブロックのみ差し替え):

```html
      <div id="hud" hidden>
        <span id="hud-fps">FPS: —</span>
        <span id="hud-detect">detect: — ms</span>
        <span id="hud-action">action: —</span>
        <span id="hud-scores">C — / G — / A —</span>
      </div>
```

- [ ] **Step 2: action-hud.ts を作成**

```ts
import type { ActionDetectorResult } from "../pose/detectors/types";

/**
 * 現在の PoseAction と各ディテクタ score をデバッグ表示する。
 * Phase 1 の Hud (FPS/detect) とは別クラスで責務を分離する。
 */
export class ActionHud {
  private actionEl: HTMLElement;
  private scoresEl: HTMLElement;

  constructor(actionEl: HTMLElement, scoresEl: HTMLElement) {
    this.actionEl = actionEl;
    this.scoresEl = scoresEl;
  }

  update(result: ActionDetectorResult): void {
    this.actionEl.textContent = `action: ${result.action}`;
    const c = result.charge.score.toFixed(2);
    const g = result.guard.score.toFixed(2);
    const a = result.attack.score.toFixed(2);
    const mark = (active: boolean): string => (active ? "*" : " ");
    this.scoresEl.textContent =
      `C${mark(result.charge.active)}${c} ` +
      `G${mark(result.guard.active)}${g} ` +
      `A${mark(result.attack.active)}${a}`;
  }

  clear(): void {
    this.actionEl.textContent = "action: —";
    this.scoresEl.textContent = "C — / G — / A —";
  }
}
```

- [ ] **Step 3: lint & tsc (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: build で index.html が壊れていないか確認**

Run: `npm run build`
Expected: 成功、`dist/` 生成

- [ ] **Step 5: コミット**

```bash
git add src/debug/action-hud.ts index.html
git commit -m "$(cat <<'EOF'
#4 feat: debug/action-hud.ts と HUD DOM に判定結果/スコア表示を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: App 統合 (`src/app.ts`)

**Files:**
- Modify: `src/app.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 現状の app.ts と main.ts を確認**

Read ツールで `src/app.ts` と `src/main.ts` を開く。`app.ts` の import 群・`AppDom` interface・`App` constructor・`loop` メソッド、`main.ts` の `getRequired` 呼び出しと `new App({...})` の `hud` オブジェクトを把握する。

- [ ] **Step 2: import と AppDom を追加**

ファイル冒頭の import 群に追加 (既存の import 群の末尾、`StatusUi` import の後):

```ts
import { createActionDetector, type ActionDetector } from "./pose/detectors/action-detector";
import { ActionHud } from "./debug/action-hud";
```

`AppDom` interface の `hud` を以下に変更 (既存):

```ts
  readonly hud: { root: HTMLElement; fps: HTMLElement; detect: HTMLElement };
```

を:

```ts
  readonly hud: {
    root: HTMLElement;
    fps: HTMLElement;
    detect: HTMLElement;
    action: HTMLElement;
    scores: HTMLElement;
  };
```

- [ ] **Step 3: フィールドと constructor を更新**

`private hud: Hud;` の宣言の直後に追加:

```ts
  private actionDetector: ActionDetector = createActionDetector();
  private actionHud: ActionHud;
```

constructor 内、`this.hud = new Hud(...)` の直後に追加:

```ts
    this.actionHud = new ActionHud(dom.hud.action, dom.hud.scores);
```

- [ ] **Step 4: loop に判定処理を組み込む**

`loop` メソッド内、`if (frame) {` ブロックの `drawOverlay(...)` 呼び出しの直後 (detectMs 代入の前後どちらでもよいが frame 利用箇所内) に追加:

```ts
        const actionResult = this.actionDetector.update(
          frame.worldLandmarks,
          now,
        );
        this.actionHud.update(actionResult);
```

`else {` ブロック (人物未検出。overlay clear している箇所) に追加:

```ts
        const actionResult = this.actionDetector.update(null, now);
        this.actionHud.update(actionResult);
```

- [ ] **Step 4b: src/main.ts の DOM 配線を更新**

`AppDom.hud` に `action` / `scores` が必須追加されたため、`src/main.ts` の `new App({...})` の `hud` オブジェクトに2要素を追加する。Phase 1 の main.ts は次の形:

```ts
  hud: {
    root: getRequired("hud", HTMLElement),
    fps: getRequired("hud-fps", HTMLElement),
    detect: getRequired("hud-detect", HTMLElement),
  },
```

を以下に置き換える (Edit で `hud:` ブロックのみ差し替え):

```ts
  hud: {
    root: getRequired("hud", HTMLElement),
    fps: getRequired("hud-fps", HTMLElement),
    detect: getRequired("hud-detect", HTMLElement),
    action: getRequired("hud-action", HTMLElement),
    scores: getRequired("hud-scores", HTMLElement),
  },
```

(`getRequired` は Phase 1 の main.ts に既にあるヘルパ。`#hud-action` / `#hud-scores` は Task 9 で index.html に追加済み。)

- [ ] **Step 5: lint & tsc & test (separate calls)**

Run: `npm run lint`
Expected: exit 0, 0 warning

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `npm run test`
Expected: 44 件パス (変更なし)

- [ ] **Step 6: build**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: コミット**

```bash
git add src/app.ts src/main.ts
git commit -m "$(cat <<'EOF'
#4 feat: app.ts に ActionDetector と ActionHud を統合

worldLandmarks を毎フレーム ActionDetector に供給し判定結果を HUD 表示。
単一インスタンスだが将来 Map<poseIndex,ActionDetector> で2人化可能な構造。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 全件検証

**Files:** なし

- [ ] **Step 1: lint**

Run: `npm run lint`
Expected: exit 0, 0 warning

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: テスト**

Run: `npm run test`
Expected: 44 件パス (smoke 2 + transforms 11 + geometry 10 + charge 5 + guard 5 + attack 5 + action-detector 6)

- [ ] **Step 4: ビルド**

Run: `npm run build`
Expected: `dist/` 生成、両ステップ exit 0

- [ ] **Step 5: ブランチ状態**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 6: ログ確認**

Run: `git log --oneline -15`
Expected: `#4 ...` コミットが spec/plan 含め並ぶ

`npm run dev` のブラウザ動作確認は PR 作成後にユーザに依頼する。確認項目:
- チャージ姿勢 (両手を体の前で構える) で HUD が `action: charging`
- ガード姿勢 (両手を顔の前で交差) で `action: guarding`
- 手を前に突き出すと `action: attacking`
- 姿勢境界で表示がガタつかない (ヒステリシス)
- 各スコア (C/G/A) が妥当な範囲で動く (チューニングの足がかり)
