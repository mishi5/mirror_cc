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
    /** |wrist.y - nose.y| <= この値なら顔の高さとみなし charge から除外 (guard 領域と排他化) */
    readonly faceExclY: number;
    readonly enterScore: number;
    readonly exitScore: number;
    readonly minHoldMs: number;
    /** active 解除前に score < exitScore が継続必要な時間 (ms)。1フレームのジッタで落とさない */
    readonly releaseMs: number;
  };
  readonly guard: {
    /** |wrist.y - nose.y| 許容 (m)。顔の高さ帯 */
    readonly faceBandY: number;
    /** 手首が鼻より前 (z 負方向) の最小量 (m) */
    readonly forwardZ: number;
    readonly enterScore: number;
    readonly exitScore: number;
    readonly minHoldMs: number;
    /** active 解除前に score < exitScore が継続必要な時間 (ms)。交差ジッタで落とさない */
    readonly releaseMs: number;
  };
  readonly attack: {
    /**
     * アタック = charge 直後の腕伸展バースト。単眼の z は弱いため、肩↔手首の
     * 3D 距離 (腕の伸展量) を信号に使う。charge gate で idle 動作と判別する。
     */
    /** 伸展バースト評価の時間窓 (ms)。窓内 oldest→newest の ext 変化を見る */
    readonly windowMs: number;
    /** 評価に必要な最小スパン (ms) */
    readonly minWindowMs: number;
    /** 窓内の伸展増加量 (newest - oldest, m) の最小値 */
    readonly extBurstDelta: number;
    /** 窓末端の絶対伸展量 (肩↔手首, m) がこれ以上 (腕が伸び切り近い) */
    readonly extHighAbs: number;
    /** charge が active だった時刻からこの時間内のみアタック有効 (ms)。ゲーム的にも正しい */
    readonly gateMs: number;
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
    faceExclY: 0.15,
    enterScore: 0.6,
    exitScore: 0.4,
    minHoldMs: 200,
    releaseMs: 150,
  },
  guard: {
    faceBandY: 0.2,
    forwardZ: 0.05,
    enterScore: 0.6,
    exitScore: 0.4,
    minHoldMs: 150,
    releaseMs: 200,
  },
  attack: {
    // 実ログ分析の初期値 (charging の伸展は ~0.32 に密集 p90=0.43、
    // session 伸展 p95=0.50)。charge から 0.45+ へ 0.12 以上伸展した瞬間を狙う。
    // ラベル付きログで最終調整する。
    windowMs: 300,
    minWindowMs: 80,
    extBurstDelta: 0.12,
    extHighAbs: 0.45,
    gateMs: 1200,
    refractoryMs: 500,
  },
};
