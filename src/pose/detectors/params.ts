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
    /** 肘ストレートネス (0-1) の窓内増加量。前向きパンチでも反応する別信号 */
    readonly straightBurstDelta: number;
    /** 肘ストレートネスの窓末端絶対値 (0-1)。これ以上で「腕がほぼ伸びた」 */
    readonly straightHighAbs: number;
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
    // 子供向け緩めプリセット (2nd ラベル付きログ分析後):
    // idle ext は p50=0.411 と高い (子供は腕を動かすため) が、charging との
    // 差を最低限残して誤発火爆発を防ぐ。
    //   extHighAbs 0.43 (charging p90=0.417 のすぐ上)
    //   extBurstDelta 0.08 (charging delta p90~0.07 のすぐ上)
    //   gateMs 2000ms (一度チャージしたら2秒間打てる)
    //   refractoryMs 300ms (連打しやすく)
    // 厳密判定が必要なら params を上書きして調整可能。
    windowMs: 300,
    minWindowMs: 60,
    extBurstDelta: 0.08,
    extHighAbs: 0.43,
    // 肘ストレートネスは前向きパンチでも反応する補助信号 (OR 論理):
    // charge 姿勢で肘 ~90°(straightness 0.5) → パンチで ~180°(1.0) になる。
    // burst 0.15 (0.5 → 0.65 以上の急変)、high 0.80 (実際に伸びきり気味)。
    straightBurstDelta: 0.15,
    straightHighAbs: 0.8,
    gateMs: 2000,
    refractoryMs: 300,
  },
};
