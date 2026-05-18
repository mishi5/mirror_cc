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
    /** 速度推定の時間窓 (ms)。この窓内のサンプルで oldest→newest を評価 */
    readonly windowMs: number;
    /** 評価に必要な最小スパン (ms)。これ未満は速度が不安定なので評価しない */
    readonly minWindowMs: number;
    /** 前方速度閾値 (m/s) */
    readonly thrustSpeed: number;
    /** 窓内 oldest→newest の前方移動量の最小値 (m) */
    readonly minThrustDist: number;
    /** 連続発火抑止時間 (ms)。姿勢の再発火抑止であり、ゲームのクールタイムとは別 */
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
    windowMs: 250,
    minWindowMs: 80,
    thrustSpeed: 0.35,
    minThrustDist: 0.07,
    refractoryMs: 500,
  },
};
