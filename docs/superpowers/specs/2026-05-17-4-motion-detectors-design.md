# Phase 2: モーション判定 (チャージ / ガード / アタック) 設計

- 対象 Issue: https://github.com/mishi5/mirror_cc/issues/4
- 親 Issue: https://github.com/mishi5/mirror_cc/issues/1
- 依存: #3 (Phase 1, マージ済み)
- 作成日: 2026-05-17

## 目的

Phase 1 で取得した姿勢ランドマーク列から、ゲーム入力となる3つの姿勢 (チャージ / ガード / アタック) を判定する。後続 Phase 3 (ゲームロジック) の入力イベント源となる。

## ゴール (DoD)

1. チャージ / ガード / アタックの3姿勢が安定して検出される
2. ヒステリシス・最小持続時間により状態遷移がブレない
3. 判定閾値・ヒステリシス幅・最小持続時間・履歴長がすべてパラメータ化されている
4. デバッグオーバーレイに現在の判定結果 (PoseAction) と各ディテクタの内部スコアが表示される
5. 各ディテクタ・geometry・状態機械にランドマークフィクスチャを使った網羅的ユニットテスト
6. `npm run lint / test / build` と `npx tsc --noEmit` が全てグリーン
7. Chrome 最新版で手動動作確認済み (各姿勢が意図通り検出される)

## 設計上の決定

| 項目 | 採用 | 理由 |
|---|---|---|
| 座標系 | `worldLandmarks` (3D, 腰中点原点, メートル) 主体 | 奥行き (前に突き出す/構える) をカメラ距離に依らず判定可能。腰原点で人物ごとに独立しスケール不変 → 2人化しても判定ロジック不変 |
| アタック判定 | 速度ベース (プレイヤー単位のフレーム履歴) | 「突き出す動作」と「ただ手が前にある状態」を区別する |
| ディテクタ状態 | プレイヤー単位のインスタンス (状態オブジェクト) | モジュールグローバルにしないことで、将来 `numPoses>1` で人数分インスタンス化するだけで2人対応可能 |
| クールタイム | Phase 3 に委譲 | Issue #5 に「ガードのクールタイム管理」と明記済み。Phase 2 は姿勢検出 + 持続時間まで |
| 判定方式 | 幾何学ルールベース | シンプルでデバッグ・チューニング可能。ML はオーバースペック |

### MediaPipe worldLandmarks 座標系 (threejs-art Skill の経験則)

Google 非公開のため経験則。Phase 4 以降の Three.js 変換と一貫させる。

| 軸 | 向き |
|---|---|
| x | 正 = カメラ右 (ミラー視点) |
| y | 正 = 下 |
| z | 負 = カメラに近い (手前) |
| 原点 | 左右の腰 (landmark 23/24) の中点 |

判定への含意:
- 「手を体の前で構える / 前に突き出す」= 手首 z が肩・胴より負方向に大きい
- 「突き出す動作」= 手首 z が負方向へ急速に減少 (速度)
- 「顔の前で交差」= 手首 y が鼻の高さ付近、かつ左右手首の x が体中心を跨いで反対側

この座標系の符号は経験則のため、閾値は `params.ts` で調整可能にし、デバッグ表示で実測しながらチューニングする。

## アーキテクチャ

### ファイル構成

```
src/pose/detectors/
  types.ts            # PoseAction, DetectorScore, ActionDetectorResult, 各 state 型
  params.ts           # 全閾値 / ヒステリシス幅 / 最小持続 / 履歴長 (パラメータ化)
  geometry.ts         # worldLandmark のベクトル演算 (pure, テスト対象の核)
  charge.ts           # チャージ姿勢ディテクタ (インスタンス state)
  guard.ts            # ガード姿勢ディテクタ
  attack.ts           # アタックディテクタ (速度ベース, フレーム履歴)
  action-detector.ts  # 3ディテクタ + 状態機械 -> PoseAction
tests/pose/detectors/
  fixtures.ts         # 各姿勢の代表 worldLandmarks 配列
  geometry.test.ts
  charge.test.ts
  guard.test.ts
  attack.test.ts
  action-detector.test.ts
```

`src/pose/detectors/` は Phase 0 で `.gitkeep` 済み。

### 型 (`detectors/types.ts`)

```ts
export type PoseAction = "idle" | "charging" | "guarding" | "attacking";

/** 各ディテクタの内部スコア (0..1 目安) と判定 bool。デバッグ表示にも使う。 */
export interface DetectorScore {
  readonly active: boolean;
  readonly score: number;     // 連続値 (閾値との距離が分かる)
  readonly detail?: string;   // デバッグ用補足 (任意)
}

export interface ActionDetectorResult {
  readonly action: PoseAction;
  readonly charge: DetectorScore;
  readonly guard: DetectorScore;
  readonly attack: DetectorScore;
}
```

### 入力契約

- 入力は **1人分**の `ReadonlyArray<Readonly<Landmark>>` (= `PoseFrame.worldLandmarks`) と `timestampMs`。
- ディテクタは `worldLandmarks[KEY_JOINT_INDICES.X]` で必要な関節を参照する (Phase 1 の `KEY_JOINT_INDICES` を流用。`selectKeyJoints` は NormalizedLandmark 用なので worldLandmarks には index 直参照 + 専用ヘルパを用意)。
- 33 点未満 / 必要関節が低 visibility の場合は `active:false, score:0` を返す (例外にしない。検出途切れは正常系)。

### geometry.ts (pure, テストの核)

worldLandmark を `{x,y,z}` ベクトルとして扱う最小限の演算:

```ts
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export function sub(a: Vec3, b: Vec3): Vec3;
export function length(v: Vec3): number;
export function midpoint(a: Vec3, b: Vec3): Vec3;
export function dot(a: Vec3, b: Vec3): number;
/** landmark -> Vec3 (visibility は無視) */
export function toVec3(lm: { x: number; y: number; z: number }): Vec3;
```

### 各ディテクタの判定ロジック (worldLandmarks ベース)

すべて「インスタンス生成 → 毎フレーム `update(worldLandmarks, timestampMs)` → `DetectorScore`」の形。状態 (ヒステリシス・履歴・持続) はインスタンス内に閉じる。

**charge.ts (静的)**
- 条件: 左右手首が両肩より前 (z が負方向に `params.charge.forwardZ` 以上)、かつ手首の y が肩〜腰の高さ帯、かつ左右手首間の距離が `params.charge.maxHandSpread` 以下 (体の前に寄せている)。
- スコア: 各条件の充足度を 0..1 に正規化して合成。
- ヒステリシス: `enter` 閾値 > `exit` 閾値。active 中は exit 閾値で判定。
- 最小保持: `params.charge.minHoldMs` 以上連続で enter 条件を満たして初めて active。

**guard.ts (静的, 持続)**
- 条件: 左右手首が鼻の高さ付近 (|wrist.y - nose.y| <= `params.guard.faceBandY`)、左右手首が体中心 (両肩midpoint x) を跨いで交差 (leftWrist.x と rightWrist.x の符号関係が反転)、手首が顔の前 (z が鼻より負方向)。
- 持続時間: active 継続フレームの累積 ms を保持し `DetectorScore.detail` 等で公開 (Phase 3 がクールタイム判断に使える)。
- ヒステリシス + `params.guard.minHoldMs`。

**attack.ts (速度ベース)**
- プレイヤー単位のリングバッファに直近 N フレーム (`params.attack.historyLen`) の手首位置 + timestamp を保持。
- 前方速度 = (z の負方向変化量) / Δt。左右どちらかが `params.attack.thrustSpeed` を超えたら active。
- 誤検出抑制: 開始 z より一定以上前方へ移動した量 (`params.attack.minThrustDist`) も併用。
- アタックは瞬間的なので最小持続は短い / ヒステリシスは「クールっぽい再発火抑止」を `params.attack.refractoryMs` で表現 (※これは姿勢の再発火抑止であり、ゲームのガードクールタイムとは別)。

### 状態機械 (`action-detector.ts`)

3ディテクタのスコアから単一の `PoseAction` を決定:

- 優先度: `attacking` > `guarding` > `charging` > `idle`。
  - アタックは瞬間動作で最優先 (突き出した瞬間)。
  - ガードは持続姿勢、チャージも持続姿勢。同時成立時はガード優先 (防御意図を尊重)。
- 各状態への遷移にディテクタ側のヒステリシス + 最小持続が効くため、状態機械自体は優先度合成 + 直近 action の保持のみ (二重のヒステリシスは入れない)。
- 出力は `ActionDetectorResult` (action + 3スコア)。

### params.ts (全パラメータ集約)

```ts
export interface DetectorParams {
  charge: { forwardZ: number; maxHandSpread: number; yBand: number;
            enterScore: number; exitScore: number; minHoldMs: number; };
  guard:  { faceBandY: number; forwardZ: number;
            enterScore: number; exitScore: number; minHoldMs: number; };
  attack: { historyLen: number; thrustSpeed: number; minThrustDist: number;
            refractoryMs: number; };
}
export const DEFAULT_DETECTOR_PARAMS: DetectorParams = { /* 初期値 */ };
```

値はチューニング前提の初期値。実測しながら調整するため、`App` から差し替え可能にする (引数で受け取る)。

### デバッグ可視化

Phase 1 の `src/debug/hud.ts` を拡張 (または `src/debug/action-hud.ts` を新設) し、毎フレーム以下を表示:
- 現在の `PoseAction`
- charge / guard / attack の `score` と `active`

既存の overlay (骨格) と HUD (FPS/detect) を壊さず追加する。

### Phase 1 統合 (`src/app.ts`)

- `App` が単一の ActionDetector インスタンスを保持 (`createActionDetector(DEFAULT_DETECTOR_PARAMS)`)。
- `loop()` 内、`detectPose` 成功時に `frame.worldLandmarks` と `now` を ActionDetector に供給し、結果をデバッグ HUD に反映。
- 人物未検出フレームは ActionDetector に「無効入力」を渡し idle に落とす (履歴は保持)。
- 将来2人化: `Map<poseIndex, ActionDetector>` にするだけ。Phase 2 では単一インスタンスで実装。

## やらないこと (Phase 2 非ゴール)

- ガードのクールタイム / HP / チャージ蓄積量 / ダメージ → Phase 3 (#5)
- 三すくみ勝敗判定 → Phase 3
- 3D エフェクト・本番 UI → Phase 4
- AI → Phase 5
- `numPoses>1` の実際の2人同時検出 → v0.3 (構造だけ将来対応可能にする)

## 検証戦略

1. **ユニットテスト**:
   - `geometry.test.ts`: ベクトル演算
   - `fixtures.ts`: 各姿勢 (idle / charge / guard / attack 各種) の代表 worldLandmarks 配列
   - `charge/guard/attack.test.ts`: 各ディテクタが代表姿勢を検出し、非該当姿勢を弾く。ヒステリシス (enter/exit) と最小持続の境界。
   - `action-detector.test.ts`: 状態遷移 (idle→charging→attacking、guarding 優先、ヒステリシスでブレない) を時系列フィクスチャで検証。
2. **lint / tsc / build**: green
3. **手動動作確認** (PR 段階でユーザに依頼):
   - チャージ姿勢で `charging`、ガード姿勢で `guarding`、突き出しで `attacking` がデバッグ HUD に出る
   - 姿勢の境界で表示がガタつかない (ヒステリシス効果)
   - 各スコアが妥当な範囲で動く (チューニングの足がかり)
