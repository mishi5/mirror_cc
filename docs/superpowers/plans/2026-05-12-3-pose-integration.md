# Phase 1 (カメラ + MediaPipe Pose Landmarker 統合) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webcam 映像を全画面ミラー表示し、MediaPipe Pose Landmarker でリアルタイム姿勢推定して 2D Canvas オーバーレイに骨格を描画する。Phase 2 以降の入力源となる純粋関数 (`pose/transforms.ts`) を網羅的にテストする。

**Architecture:** ブラウザ SPA。`<video>` 要素に getUserMedia 映像を流し、`<canvas>` を上に重ねて 2D で骨格描画。MediaPipe は VIDEO モードで毎フレーム同期推論。Phase 0 の Three.js キューブは Phase 4 で復活させる前提で一時撤去する。

**Tech Stack:** Vite, TypeScript 5, `@mediapipe/tasks-vision` (FULL モデル + Google CDN), 2D Canvas API, Vitest

**対象 Issue:** https://github.com/mishi5/mirror_cc/issues/3 (親: #1, 依存: #2)
**Spec:** `docs/superpowers/specs/2026-05-12-3-pose-integration-design.md`

---

## File Structure

```
src/
  main.ts                 # Modify: cube ロジック削除、App をブート
  app.ts                  # Create: App クラス (Webcam + Landmarker + Loop)
  pose/
    constants.ts          # Create: KEY_JOINT_INDICES, POSE_CONNECTIONS, モデル URL, デフォルト閾値
    types.ts              # Create: KeyJoints, PoseFrame, AppStatus 型
    transforms.ts         # Create: mirrorLandmarks, selectKeyJoints, isVisible (純粋関数)
    webcam.ts             # Create: getUserMedia ラッパ
    landmarker.ts         # Create: MediaPipe PoseLandmarker ラッパ
  debug/
    overlay.ts            # Create: 2D Canvas で landmark/connection 描画
    hud.ts                # Create: FPS / detect time 表示
  ui/
    status.ts             # Create: loading/error/ok の状態切替
tests/
  pose/
    transforms.test.ts    # Create: transforms.ts の純粋関数テスト
index.html                # Modify: webcam/overlay/hud/status DOM、cube 系 CSS 削除
package.json              # Modify: @mediapipe/tasks-vision を依存追加
CLAUDE.md                 # Modify: アーキテクチャ節に src/ui/ を追記
```

---

### Task 1: 依存追加 (@mediapipe/tasks-vision)

**Files:**
- Modify: `package.json`
- Auto-update: `package-lock.json`

- [ ] **Step 1: `@mediapipe/tasks-vision` をインストール**

Run: `npm install --save-exact @mediapipe/tasks-vision@0.10.16`

(バージョンを pin する。`@latest` だと予期せぬ破壊的変更が入り得る)

Expected: `added 1 package` のような成功メッセージ。`package.json` の `dependencies` に `"@mediapipe/tasks-vision": "0.10.16"` (キャレットなし) が追加され、`package-lock.json` が更新される。

- [ ] **Step 2: lint / tsc / test がベースラインで通ることを確認**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `npm run test`
Expected: tests/smoke.test.ts 2 passed

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
#3 chore: @mediapipe/tasks-vision を依存追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 型と定数 (pose/types.ts, pose/constants.ts)

**Files:**
- Create: `src/pose/types.ts`
- Create: `src/pose/constants.ts`

- [ ] **Step 1: `src/pose/types.ts` を作成**

```ts
import type { NormalizedLandmark, Landmark } from "@mediapipe/tasks-vision";

/**
 * 1人分の姿勢推定結果。MediaPipe の raw 出力を最小限に整形した内部表現。
 * landmarks は画像正規化座標 (0..1)。worldLandmarks は腰中点を原点とするメートル単位 3D。
 */
export interface PoseFrame {
  /** 推論完了時の performance.now() */
  readonly timestamp: number;
  /** 33点のランドマーク (画像正規化座標)。ミラー反転前。 */
  readonly landmarks: ReadonlyArray<NormalizedLandmark>;
  /** 33点のワールドランドマーク (腰中点原点, メートル)。Phase 4 で利用予定。 */
  readonly worldLandmarks: ReadonlyArray<Landmark>;
  /** detectForVideo にかかった時間 (ms)。HUD 表示用。 */
  readonly detectTimeMs: number;
}

/**
 * ゲームで使う 9 点の主要ジョイント。selectKeyJoints の戻り値。
 */
export interface KeyJoints {
  readonly nose: NormalizedLandmark;
  readonly leftShoulder: NormalizedLandmark;
  readonly rightShoulder: NormalizedLandmark;
  readonly leftElbow: NormalizedLandmark;
  readonly rightElbow: NormalizedLandmark;
  readonly leftWrist: NormalizedLandmark;
  readonly rightWrist: NormalizedLandmark;
  readonly leftIndex: NormalizedLandmark;
  readonly rightIndex: NormalizedLandmark;
}

/**
 * UI 状態 (ローディング / エラー / 通常)。ui/status.ts で参照。
 */
export type AppStatus =
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string; readonly retryLabel?: string }
  | { readonly kind: "ok" };
```

- [ ] **Step 2: `src/pose/constants.ts` を作成**

```ts
/**
 * MediaPipe Pose Landmarker の 33 ランドマークのうち、ゲームで使う 9 点のインデックス。
 * 参照: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
 */
export const KEY_JOINT_INDICES = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
} as const;

/** デバッグオーバーレイで描く骨格の接続。MediaPipe 標準より絞り込んだ最小セット。 */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], // 肩
  [11, 13],
  [13, 15], // 左腕
  [12, 14],
  [14, 16], // 右腕
  [15, 19], // 左手首-人差し指
  [16, 20], // 右手首-人差し指
];

/** デフォルトの visibility 閾値。これ未満のランドマークは描画/判定から除外する。 */
export const DEFAULT_VISIBILITY_THRESHOLD = 0.5;

/** MediaPipe Pose Landmarker のモデルファイル (Google 公式 CDN, FULL float16)。 */
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

/** @mediapipe/tasks-vision の WASM (jsDelivr 経由)。 */
export const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm";

/** getUserMedia の希望解像度。実機が下回る場合は自動で fallback。 */
export const WEBCAM_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
    facingMode: "user",
  },
  audio: false,
};
```

- [ ] **Step 3: 型エラーが無いことを確認**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: exit 0、warning 0

- [ ] **Step 5: コミット**

```bash
git add src/pose/types.ts src/pose/constants.ts
git commit -m "$(cat <<'EOF'
#3 feat: pose の型と定数を追加 (PoseFrame, KeyJoints, KEY_JOINT_INDICES, POSE_CONNECTIONS)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 純粋関数 transforms.ts (TDD)

テスト → 実装の順で書く。

**Files:**
- Create: `tests/pose/transforms.test.ts`
- Create: `src/pose/transforms.ts`

- [ ] **Step 1: テストを書く (失敗する状態)**

`tests/pose/transforms.test.ts`:

```ts
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
      makeLandmark(0.2, 0.3, 0.4, 0.9),
      makeLandmark(0.7, 0.5, -0.1, 0.8),
    ];
    const result = mirrorLandmarks(input);
    expect(result[0]).toEqual({ x: 0.8, y: 0.3, z: 0.4, visibility: 0.9 });
    expect(result[1]).toEqual({ x: 0.3, y: 0.5, z: -0.1, visibility: 0.8 });
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
    const lm: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    expect(isVisible(lm, 0.5)).toBe(false);
  });

  it("閾値を省略すると DEFAULT_VISIBILITY_THRESHOLD を使う", () => {
    expect(isVisible(makeLandmark(0, 0, 0, DEFAULT_VISIBILITY_THRESHOLD))).toBe(true);
    expect(
      isVisible(makeLandmark(0, 0, 0, DEFAULT_VISIBILITY_THRESHOLD - 0.01)),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認**

Run: `npm run test`
Expected: `tests/pose/transforms.test.ts` が "Cannot find module ... transforms" 系のエラーで失敗する (実装ファイルが未作成)。`tests/smoke.test.ts` は引き続き 2 件パス。

- [ ] **Step 3: 実装を書く (テストが通る最小限)**

`src/pose/transforms.ts`:

```ts
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  DEFAULT_VISIBILITY_THRESHOLD,
  KEY_JOINT_INDICES,
} from "./constants";
import type { KeyJoints } from "./types";

/**
 * 各ランドマークの x を 1 - x に反転する純粋関数。
 *
 * Phase 1 では overlay と video の両方を CSS `transform: scaleX(-1)` でミラー表示しており、
 * 描画用途では本関数を呼ぶ必要がない (二重反転になるため)。
 * 姿勢判定 (Phase 2) でゲーム座標系に変換したい場合などに利用するユーティリティ。
 * 入力配列は変更せず、新しい配列を返す。
 */
export function mirrorLandmarks(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): NormalizedLandmark[] {
  return landmarks.map((lm) => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

/**
 * 33点の中からゲームで使う 9 点を抽出する。33 点未満の場合は例外。
 */
export function selectKeyJoints(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): KeyJoints {
  if (landmarks.length < 33) {
    throw new Error(
      `selectKeyJoints: 33 landmarks required, got ${landmarks.length}`,
    );
  }
  return {
    nose: landmarks[KEY_JOINT_INDICES.NOSE]!,
    leftShoulder: landmarks[KEY_JOINT_INDICES.LEFT_SHOULDER]!,
    rightShoulder: landmarks[KEY_JOINT_INDICES.RIGHT_SHOULDER]!,
    leftElbow: landmarks[KEY_JOINT_INDICES.LEFT_ELBOW]!,
    rightElbow: landmarks[KEY_JOINT_INDICES.RIGHT_ELBOW]!,
    leftWrist: landmarks[KEY_JOINT_INDICES.LEFT_WRIST]!,
    rightWrist: landmarks[KEY_JOINT_INDICES.RIGHT_WRIST]!,
    leftIndex: landmarks[KEY_JOINT_INDICES.LEFT_INDEX]!,
    rightIndex: landmarks[KEY_JOINT_INDICES.RIGHT_INDEX]!,
  };
}

/**
 * ランドマークが描画 / 判定可能なほど信頼できるかを判定する。
 * visibility は MediaPipe が 0..1 で返す。未定義の場合は 0 扱い。
 */
export function isVisible(
  landmark: NormalizedLandmark,
  threshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): boolean {
  return (landmark.visibility ?? 0) >= threshold;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test`
Expected: `tests/pose/transforms.test.ts` の全 11 件 + `tests/smoke.test.ts` の 2 件 = 計 13 件パス

- [ ] **Step 5: lint と tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add tests/pose/transforms.test.ts src/pose/transforms.ts
git commit -m "$(cat <<'EOF'
#3 feat: pose/transforms.ts に純粋関数 (mirror, selectKeyJoints, isVisible) を追加

TDD でテスト → 実装の順に作成。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: src/pose/webcam.ts (getUserMedia ラッパ)

**Files:**
- Create: `src/pose/webcam.ts`

- [ ] **Step 1: webcam.ts を作成**

```ts
import { WEBCAM_CONSTRAINTS } from "./constants";

/**
 * getUserMedia で取得したカメラ映像を <video> に接続する。
 * 成功時に video.videoWidth / videoHeight が確定する (loadedmetadata 待ち)。
 *
 * 失敗時は元の DOMException をそのまま throw する:
 *   - NotAllowedError: ユーザがカメラ権限を拒否
 *   - NotFoundError: カメラデバイスが見つからない
 *   - OverconstrainedError: 要求した制約 (解像度等) を満たすデバイスが無い
 *   - その他: ハード障害など
 */
export async function attachWebcam(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(WEBCAM_CONSTRAINTS);
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
  await video.play();
  return stream;
}

/**
 * stream の全トラックを停止し、video の srcObject を切り離す。
 */
export function detachWebcam(video: HTMLVideoElement, stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  video.srcObject = null;
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/pose/webcam.ts
git commit -m "$(cat <<'EOF'
#3 feat: pose/webcam.ts に getUserMedia ラッパを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: src/pose/landmarker.ts (MediaPipe ラッパ)

**Files:**
- Create: `src/pose/landmarker.ts`

- [ ] **Step 1: landmarker.ts を作成**

```ts
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { POSE_MODEL_URL, VISION_WASM_URL } from "./constants";
import type { PoseFrame } from "./types";

/**
 * MediaPipe Pose Landmarker のラッパ。VIDEO モードで 1 人のみ検出。
 * createPoseLandmarker は WASM とモデルの非同期取得を含み、失敗時は throw する。
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/**
 * 1 フレーム分の推論を行い PoseFrame に整形する。
 * pose が検出できなかった (landmarks 空) 場合は null を返す。
 * timestamp は performance.now() を渡すこと (MediaPipe は単調増加を要求)。
 */
export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): PoseFrame | null {
  const start = performance.now();
  const result: PoseLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  const detectTimeMs = performance.now() - start;

  const first = result.landmarks[0];
  const firstWorld = result.worldLandmarks[0];
  if (!first || !firstWorld) {
    return null;
  }
  return {
    timestamp: timestampMs,
    landmarks: first,
    worldLandmarks: firstWorld,
    detectTimeMs,
  };
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/pose/landmarker.ts
git commit -m "$(cat <<'EOF'
#3 feat: pose/landmarker.ts に MediaPipe PoseLandmarker ラッパを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: src/debug/overlay.ts (2D Canvas 描画)

**Files:**
- Create: `src/debug/overlay.ts`

- [ ] **Step 1: overlay.ts を作成**

```ts
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { POSE_CONNECTIONS, DEFAULT_VISIBILITY_THRESHOLD } from "../pose/constants";
import { isVisible } from "../pose/transforms";

const LANDMARK_COLOR = "#44aaff";
const CONNECTION_COLOR = "#ffffff";
const LANDMARK_RADIUS_PX = 6;
const CONNECTION_WIDTH_PX = 3;

/**
 * 2D Canvas に landmark と connection を描画する。
 * landmarks は画像正規化座標 (0..1)。canvas サイズと演算で px に変換する。
 * visibility 閾値以下のランドマーク・接続は描画しない。
 *
 * canvas は CSS で webcam と同一サイズに重ねており、`transform: scaleX(-1)` で
 * ミラー反転されているため、x の反転は CSS 任せにし overlay 側では行わない。
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  width: number,
  height: number,
  threshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): void {
  ctx.clearRect(0, 0, width, height);
  if (landmarks.length === 0) return;

  // 接続線
  ctx.strokeStyle = CONNECTION_COLOR;
  ctx.lineWidth = CONNECTION_WIDTH_PX;
  ctx.lineCap = "round";
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if (!isVisible(la, threshold) || !isVisible(lb, threshold)) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * width, la.y * height);
    ctx.lineTo(lb.x * width, lb.y * height);
    ctx.stroke();
  }

  // ランドマーク (描画対象を絞らず全 33 点、ただし visibility でフィルタ)
  ctx.fillStyle = LANDMARK_COLOR;
  for (const lm of landmarks) {
    if (!isVisible(lm, threshold)) continue;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, LANDMARK_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * canvas の drawing buffer サイズを CSS サイズ × devicePixelRatio に揃え、
 * 描画コンテキストをそれに合わせてスケールする。Retina 対応。
 */
export function resizeOverlayCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/debug/overlay.ts
git commit -m "$(cat <<'EOF'
#3 feat: debug/overlay.ts に 2D Canvas 骨格描画を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: src/debug/hud.ts (FPS / detect time)

**Files:**
- Create: `src/debug/hud.ts`

- [ ] **Step 1: hud.ts を作成**

```ts
/**
 * 簡易 HUD。指数移動平均で FPS と detect time をなめらかに表示する。
 * value = value + (sample - value) * SMOOTHING で更新。
 */
const SMOOTHING = 0.1;

export class Hud {
  private fpsEl: HTMLElement;
  private detectEl: HTMLElement;
  private root: HTMLElement;
  private lastFrameTime: number | null = null;
  private smoothedFps = 0;
  private smoothedDetectMs = 0;

  constructor(root: HTMLElement, fpsEl: HTMLElement, detectEl: HTMLElement) {
    this.root = root;
    this.fpsEl = fpsEl;
    this.detectEl = detectEl;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /**
   * 毎フレーム呼ぶ。now は performance.now()、detectMs は pose detect の実時間 (ms)。
   * pose が検出できなかったフレームでも呼んで FPS を更新できる (detectMs は前値継続でよい)。
   */
  update(now: number, detectMs: number): void {
    if (this.lastFrameTime !== null) {
      const dt = now - this.lastFrameTime;
      const instantFps = dt > 0 ? 1000 / dt : 0;
      this.smoothedFps += (instantFps - this.smoothedFps) * SMOOTHING;
    }
    this.lastFrameTime = now;
    this.smoothedDetectMs += (detectMs - this.smoothedDetectMs) * SMOOTHING;

    this.fpsEl.textContent = `FPS: ${this.smoothedFps.toFixed(0)}`;
    this.detectEl.textContent = `detect: ${this.smoothedDetectMs.toFixed(1)} ms`;
  }
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/debug/hud.ts
git commit -m "$(cat <<'EOF'
#3 feat: debug/hud.ts に FPS / detect time HUD を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: src/ui/status.ts (loading/error/ok UI)

**Files:**
- Create: `src/ui/status.ts`

- [ ] **Step 1: status.ts を作成**

```ts
import type { AppStatus } from "../pose/types";

/**
 * #status 要素の見た目と動作を制御する。
 * - `data-state="loading"` / `"error"` / `"ok"` で CSS 表示切替
 * - error 時は retry ボタンを表示しコールバックを発火
 *
 * DOM 構成 (index.html 側で固定):
 *   <div id="status" data-state="loading">
 *     <p id="status-message">...</p>
 *     <button id="status-retry" hidden>...</button>
 *   </div>
 */
export class StatusUi {
  private root: HTMLElement;
  private message: HTMLElement;
  private retry: HTMLButtonElement;
  private onRetry: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    message: HTMLElement,
    retry: HTMLButtonElement,
  ) {
    this.root = root;
    this.message = message;
    this.retry = retry;
    this.retry.addEventListener("click", () => {
      this.onRetry?.();
    });
  }

  setStatus(status: AppStatus, onRetry?: () => void): void {
    this.root.dataset.state = status.kind;
    this.onRetry = onRetry ?? null;

    if (status.kind === "ok") {
      this.message.textContent = "";
      this.retry.hidden = true;
      this.retry.textContent = "";
      return;
    }

    this.message.textContent = status.message;

    if (status.kind === "error" && onRetry) {
      this.retry.hidden = false;
      this.retry.textContent = status.retryLabel ?? "再試行";
    } else {
      this.retry.hidden = true;
    }
  }
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/ui/status.ts
git commit -m "$(cat <<'EOF'
#3 feat: ui/status.ts に loading/error/ok 状態管理を追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: src/app.ts (統合 App クラス)

**Files:**
- Create: `src/app.ts`

- [ ] **Step 1: app.ts を作成**

```ts
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { attachWebcam, detachWebcam } from "./pose/webcam";
import { createPoseLandmarker, detectPose } from "./pose/landmarker";
import { drawOverlay, resizeOverlayCanvas } from "./debug/overlay";
import { Hud } from "./debug/hud";
import { StatusUi } from "./ui/status";

export interface AppDom {
  readonly video: HTMLVideoElement;
  readonly overlay: HTMLCanvasElement;
  readonly hud: { root: HTMLElement; fps: HTMLElement; detect: HTMLElement };
  readonly status: { root: HTMLElement; message: HTMLElement; retry: HTMLButtonElement };
}

export class App {
  private dom: AppDom;
  private statusUi: StatusUi;
  private hud: Hud;
  private overlayCtx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private rafId: number | null = null;
  private consecutiveDetectErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;

  constructor(dom: AppDom) {
    this.dom = dom;
    this.statusUi = new StatusUi(dom.status.root, dom.status.message, dom.status.retry);
    this.hud = new Hud(dom.hud.root, dom.hud.fps, dom.hud.detect);
    const ctx = dom.overlay.getContext("2d");
    if (!ctx) {
      throw new Error("2D context not available on overlay canvas");
    }
    this.overlayCtx = ctx;
    window.addEventListener("resize", () => resizeOverlayCanvas(dom.overlay));
  }

  async start(): Promise<void> {
    this.statusUi.setStatus({ kind: "loading", message: "カメラを起動中…" });
    try {
      this.stream = await attachWebcam(this.dom.video);
    } catch (err) {
      this.handleCameraError(err);
      return;
    }

    this.statusUi.setStatus({
      kind: "loading",
      message: "姿勢推定モデルを読み込み中…",
    });
    try {
      this.landmarker = await createPoseLandmarker();
    } catch (err) {
      this.handleModelError(err);
      return;
    }

    resizeOverlayCanvas(this.dom.overlay);
    this.statusUi.setStatus({ kind: "ok" });
    this.hud.show();
    this.consecutiveDetectErrors = 0;
    this.loop();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      detachWebcam(this.dom.video, this.stream);
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.hud.hide();
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker) return;

    const now = performance.now();
    let detectMs = 0;
    try {
      const frame = detectPose(this.landmarker, this.dom.video, now);
      if (frame) {
        // 注: video と overlay canvas は CSS で scaleX(-1) されているため
        // mirror 反転はそこで完結する。ここではミラー処理を行わず raw landmark を
        // そのまま canvas 座標 (= 元画像座標) で描画する。
        const rect = this.dom.overlay.getBoundingClientRect();
        drawOverlay(this.overlayCtx, frame.landmarks, rect.width, rect.height);
        detectMs = frame.detectTimeMs;
      } else {
        // 人体未検出: overlay をクリア
        const rect = this.dom.overlay.getBoundingClientRect();
        this.overlayCtx.clearRect(0, 0, rect.width, rect.height);
      }
      this.consecutiveDetectErrors = 0;
    } catch (err) {
      this.consecutiveDetectErrors += 1;
      console.error("pose detect error:", err);
      if (this.consecutiveDetectErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        this.stop();
        this.statusUi.setStatus(
          {
            kind: "error",
            message: "姿勢推定が連続して失敗しました。リロードしてください。",
          },
          () => location.reload(),
        );
        return;
      }
    }

    this.hud.update(now, detectMs);
  };

  private handleCameraError(err: unknown): void {
    const name = err instanceof DOMException ? err.name : "";
    let message = "カメラの起動に失敗しました。";
    if (name === "NotAllowedError") {
      message = "カメラへのアクセスを許可してください。";
    } else if (name === "NotFoundError") {
      message = "カメラが見つかりません。デバイスを接続してください。";
    } else if (name === "OverconstrainedError") {
      message = "利用可能なカメラが要求条件を満たしません。";
    }
    console.error("camera error:", err);
    this.statusUi.setStatus({ kind: "error", message }, () => {
      this.statusUi.setStatus({ kind: "loading", message: "再試行中…" });
      void this.start();
    });
  }

  private handleModelError(err: unknown): void {
    console.error("model error:", err);
    this.statusUi.setStatus(
      {
        kind: "error",
        message:
          "姿勢推定モデルの読み込みに失敗しました。ネットワーク接続を確認してください。",
        retryLabel: "リロード",
      },
      () => location.reload(),
    );
  }
}
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add src/app.ts
git commit -m "$(cat <<'EOF'
#3 feat: app.ts に Webcam + Landmarker + 描画ループの統合 App クラスを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: index.html + src/main.ts 書き換え

Phase 0 の Three.js キューブを撤去し、webcam UI に差し替える。

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`

- [ ] **Step 1: index.html を Write ツールで完全書き換え**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mirror C.C.</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #000;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      #app {
        position: relative;
        width: 100vw;
        height: 100vh;
      }
      #webcam,
      #overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
      }
      #overlay {
        pointer-events: none;
      }
      #hud {
        position: absolute;
        right: 12px;
        bottom: 12px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 6px;
        font-size: 13px;
        line-height: 1.4;
        display: flex;
        flex-direction: column;
        gap: 2px;
        pointer-events: none;
        font-variant-numeric: tabular-nums;
      }
      #status {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: rgba(0, 0, 0, 0.85);
        text-align: center;
        padding: 24px;
      }
      #status[data-state="ok"] {
        display: none;
      }
      #status-message {
        margin: 0;
        font-size: 18px;
      }
      #status-retry {
        padding: 10px 20px;
        font-size: 14px;
        background: #44aaff;
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
      }
      #status-retry[hidden] {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <video id="webcam" autoplay playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div id="hud" hidden>
        <span id="hud-fps">FPS: —</span>
        <span id="hud-detect">detect: — ms</span>
      </div>
      <div id="status" data-state="loading">
        <p id="status-message">カメラとモデルを準備しています…</p>
        <button id="status-retry" hidden>再試行</button>
      </div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: src/main.ts を Write ツールで完全書き換え**

```ts
import { App } from "./app";

function getRequired<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!el || !(el instanceof ctor)) {
    throw new Error(`#${id} not found or wrong type`);
  }
  return el;
}

const app = new App({
  video: getRequired("webcam", HTMLVideoElement),
  overlay: getRequired("overlay", HTMLCanvasElement),
  hud: {
    root: getRequired("hud", HTMLElement),
    fps: getRequired("hud-fps", HTMLElement),
    detect: getRequired("hud-detect", HTMLElement),
  },
  status: {
    root: getRequired("status", HTMLElement),
    message: getRequired("status-message", HTMLElement),
    retry: getRequired("status-retry", HTMLButtonElement),
  },
});

void app.start();
```

- [ ] **Step 3: lint / tsc / build**

Run: `npm run lint`
Expected: exit 0、warning 0

Run: `npx tsc --noEmit`
Expected: exit 0

Run: `npm run build`
Expected: dist/ が生成され、`✓ built in Xms` 出力。MediaPipe の WASM はランタイム取得なので bundle には含まれない。

- [ ] **Step 4: 全テストが引き続き通ることを確認**

Run: `npm run test`
Expected: smoke.test.ts (2) + transforms.test.ts (12) = 14 件パス

- [ ] **Step 5: コミット**

```bash
git add index.html src/main.ts
git commit -m "$(cat <<'EOF'
#3 feat: index.html と main.ts を webcam + overlay UI に書き換え

Phase 0 の Three.js キューブを撤去 (Phase 4 で復活予定)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: CLAUDE.md 更新 (src/ui/ 追記)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md のアーキテクチャ節を Edit で更新**

`src/scenes/`の行の直後に `src/ui/` を追加する。具体的には:

旧:
```
    scenes/              # タイトル / キャリブレーション / 試合 / リザルト
    audio/               # SE / BGM
    debug/               # デバッグオーバーレイ・パラメータ調整
```

新:
```
    scenes/              # タイトル / キャリブレーション / 試合 / リザルト
    ui/                  # 全体 UI (loading/error 等の状態オーバーレイ)
    audio/               # SE / BGM
    debug/               # デバッグオーバーレイ・パラメータ調整
```

- [ ] **Step 2: lint / tsc**

Run: `npm run lint`
Expected: exit 0

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: コミット**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
#3 docs: CLAUDE.md のアーキテクチャ節に src/ui/ を追記

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 全件検証

**Files:** なし

- [ ] **Step 1: lint**

Run: `npm run lint`
Expected: exit 0、warning 0

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: テスト**

Run: `npm run test`
Expected: `smoke.test.ts (2)` + `transforms.test.ts (11)` = 13 件パス

- [ ] **Step 4: ビルド**

Run: `npm run build`
Expected: `dist/` が生成され、`tsc --noEmit && vite build` 両方が exit 0。

- [ ] **Step 5: ブランチの状態確認**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 6: ログ確認**

Run: `git log --oneline -20`
Expected: 11〜12 個の `#3 ...` コミットが並ぶ (spec + plan コミット含む)。

`npm run dev` でのブラウザ動作確認は PR 作成後にユーザに依頼する。確認項目:
- カメラ権限ダイアログ → 許可 → webcam がミラー表示で全画面表示
- 体を動かすと head/shoulder/elbow/wrist/index にランドマークが追従
- 右下に FPS と detect time が表示
- Retina で overlay が webcam とぴったり重なる
- カメラ権限を拒否すると error UI + 再試行ボタンが表示される
