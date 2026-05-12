# Phase 1: カメラ + MediaPipe Pose Landmarker 統合 設計

- 対象 Issue: https://github.com/mishi5/mirror_cc/issues/3
- 親 Issue: https://github.com/mishi5/mirror_cc/issues/1
- 依存: #2 (Phase 0, マージ済み)
- 作成日: 2026-05-12

## 目的

Webcam 映像を取得して MediaPipe Pose Landmarker でリアルタイム姿勢推定を行い、デバッグオーバーレイで骨格を可視化する。後続 Phase 2 (姿勢判定) と Phase 4 (3D 描画) の入力源となる基盤を構築する。

## ゴール (DoD)

1. ブラウザでアクセスすると webcam 映像が画面全体にミラー表示される
2. 体を動かすと頭・両肩・両肘・両手首・両指のランドマークがリアルタイムにオーバーレイ描画される
3. FPS と pose detect time (ms) が画面右下に表示される
4. カメラ権限拒否・モデル読込失敗時に分かりやすいエラー画面を表示する
5. `src/pose/transforms.ts` の純粋関数群 (mirror, key joints select, visibility) に網羅的ユニットテスト
6. `npm run lint / test / build` と `npx tsc --noEmit` がすべてグリーン
7. Chrome 最新版で手動動作確認済み

## 設計上の決定

| 項目 | 採用 | 理由 |
|---|---|---|
| 推論 SDK | `@mediapipe/tasks-vision` | 公式 npm 配信。WebAssembly + ESM 対応 |
| モデル | pose_landmarker_full.task (約 8MB) | 精度と速度のバランス。Phase 2 の判定に必要な手首/指の精度が出る |
| 配信 | Google CDN (storage.googleapis.com) | リポ肥大化を避ける。Phase 4 までは CDN で運用 |
| 推論モード | VIDEO (同期返し) | 描画ループに自然に統合できる。LIVE_STREAM の async callback の複雑さを回避 |
| 検出人数 | 1 (`numPoses: 1`) | 1人プレイ前提 |
| 表示 | ミラー表示 (`transform: scaleX(-1)`) | セルフィー視点で自然な操作感 |
| 描画レイヤ | `<video>` + 2D `<canvas>` オーバーレイ | シンプルで Phase 1 として overengineering を避ける。Three.js シーンは Phase 4 で再導入 |

### threejs-art Skill の知見から留意する点

- **MediaPipe 座標軸は Google 非公開**。経験則として `worldLandmarks` は x=カメラ右, y=下, z=手前 (より負ほどカメラに近い)、原点は左右の腰の中点。Three.js (y-up) に変換するときは y を反転する必要がある。本フェーズでは表示は `landmarks` (画像正規化座標 0..1) を使うため worldLandmarks は型だけ保持して Phase 4 で本格利用する
- **GLSL ASCII オンリー / `setSize` の第三引数 / `.glsl ?raw` import** などの罠は Phase 1 ではシェーダーを書かないので非該当
- **初期化は非同期**。MediaPipe `PoseLandmarker.createFromOptions` の await 中に UI を「loading...」にする

## アーキテクチャ

### DOM 構成 (index.html)

Phase 0 の Three.js キューブを取り除き、以下に置き換える:

```html
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
```

CSS で:
- `#webcam` / `#overlay` は `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover` + `transform: scaleX(-1)`
- `#hud` 右下にフローティング、半透明背景
- `#status` 中央オーバーレイ、`data-state` で `loading | error | ok` を切替 (CSS で表示制御)

### ファイル構成

```
src/
  main.ts                # エントリ。App をブートストラップ
  app.ts                 # App クラス: Webcam + PoseLandmarker + 描画ループの統合
  pose/
    webcam.ts            # getUserMedia ラッパ + 解像度ネゴ
    landmarker.ts        # MediaPipe PoseLandmarker のラッパ (VIDEO モード)
    transforms.ts        # 純粋関数: ミラー反転, KeyJoints 抽出, visibility 判定
    constants.ts         # KEY_JOINT_INDICES, POSE_CONNECTIONS, モデル/WASM URL
    types.ts             # PoseFrame, KeyJoints, AppStatus
  debug/
    overlay.ts           # 2D Canvas に landmark/connection を描画
    hud.ts               # FPS + detect time を DOM に反映
  ui/
    status.ts            # #status の表示制御 (loading/error/ok)
tests/
  pose/
    transforms.test.ts   # transforms.ts の純粋関数テスト
```

`src/ui/` は CLAUDE.md のアーキテクチャに無いが、UI 状態管理が pose にも debug にも属さないため新設する。完了時に CLAUDE.md を更新する。

### App クラスの責務

```ts
class App {
  async start(): Promise<void>;        // 全体起動: webcam → landmarker → loop
  private async initWebcam(): Promise<void>;
  private async initLandmarker(): Promise<void>;
  private loop(now: DOMHighResTimeStamp): void;
  private handleError(kind: "camera" | "model", err: unknown): void;
  stop(): void;                        // テスト用・HMR で使う
}
```

- 描画ループは `requestAnimationFrame` ベース
- 毎フレーム: `video.currentTime` ベースのタイムスタンプで `landmarker.detectForVideo(video, ts)` を呼ぶ
- 結果を `transforms.mirrorLandmarks()` → `overlay.draw()` に渡す
- `hud.update(fps, detectTime)`
- 例外は `handleError()` で UI 反映、ループ停止

### 純粋関数 (テスト対象)

```ts
// src/pose/transforms.ts

export function mirrorLandmarks(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): NormalizedLandmark[];
// x → 1 - x、他はそのまま

export interface KeyJoints {
  nose: NormalizedLandmark;
  leftShoulder: NormalizedLandmark;
  rightShoulder: NormalizedLandmark;
  leftElbow: NormalizedLandmark;
  rightElbow: NormalizedLandmark;
  leftWrist: NormalizedLandmark;
  rightWrist: NormalizedLandmark;
  leftIndex: NormalizedLandmark;
  rightIndex: NormalizedLandmark;
}

export function selectKeyJoints(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): KeyJoints;
// インデックスマップに従って 9 点を抽出。33 未満ならエラー

export function isVisible(
  landmark: NormalizedLandmark,
  threshold = DEFAULT_VISIBILITY_THRESHOLD,
): boolean;
// landmark.visibility ?? 0 >= threshold
```

### POSE_CONNECTIONS (オーバーレイ描画)

```ts
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],          // 肩
  [11, 13], [13, 15],// 左腕
  [12, 14], [14, 16],// 右腕
  [15, 19],          // 左手首-人差し指
  [16, 20],          // 右手首-人差し指
  // 頭は鼻 (0) と両肩中点を別途描画
];
```

### モデル/WASM URL

```ts
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

export const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
```

`@mediapipe/tasks-vision` の `FilesetResolver.forVisionTasks(VISION_WASM_URL)` で WASM 解決。npm パッケージはバージョン固定するため `package.json` の依存を pin する。

### エラーハンドリング

- `initWebcam` 失敗 (`NotAllowedError`, `NotFoundError`, `OverconstrainedError`):
  - `#status` に状態 `error`、メッセージ + 再試行ボタン (`#status-retry`) 表示
- `initLandmarker` 失敗 (model 取得失敗、WASM 初期化失敗):
  - `#status` に状態 `error`、メッセージ + リロードボタン表示
- ループ内 `detectForVideo` 失敗:
  - 連続失敗 (例: 5フレーム) で停止 + エラー表示

### パフォーマンス目標

- 60fps 描画 (RAF)
- pose detect: 平均 30ms 以下を目標 (FULL モデル + 640x480 で実機検証)
- detect が遅い場合は HUD で可視化 (現状把握だけ、最適化は別フェーズ)

## CLAUDE.md 更新

完了時に `src/ui/` を CLAUDE.md のアーキテクチャ節に追記する (一次的な書き換え)。

## やらないこと (Phase 1 非ゴール)

- 姿勢判定 (チャージ/ガード/アタック) → Phase 2
- ゲーム状態 (HP, チャージ量) → Phase 3
- 3D ファイター描画 → Phase 4 (このときに Phase 0 のキューブが復活)
- AI → Phase 5
- タイトル/キャリブレーション/リザルト画面 → Phase 6
- worldLandmarks の本格利用 (型だけ保持、後続 Phase で利用)

## 検証戦略

1. **ユニットテスト** (`transforms.test.ts`): mirrorLandmarks, selectKeyJoints, isVisible を網羅
2. **lint / tsc / build**: green
3. **手動動作確認** (PR 段階でユーザに依頼):
   - `npm run dev` → カメラ権限を許可 → 自分の姿が映ること
   - 手を動かして overlay の手のランドマークが追従すること
   - 画面右下に FPS と detect time が表示されること
   - カメラ権限を拒否した場合に error UI が表示されること
   - Retina ディスプレイで overlay が webcam とぴったり重なること
