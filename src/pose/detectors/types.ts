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
