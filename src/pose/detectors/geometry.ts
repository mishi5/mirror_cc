/** worldLandmark を 3D ベクトルとして扱う最小限の純粋演算群。 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** landmark から x/y/z だけ取り出す (visibility は無視)。 */
export function toVec3(lm: { x: number; y: number; z: number; visibility?: number }): Vec3 {
  return { x: lm.x, y: lm.y, z: lm.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
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

/**
 * 3点のなす角の straightness を返す。中央点 (elbow) を頂点として、両端 (shoulder/wrist)
 * へのベクトル間の角度。0=完全に折り畳まれた状態 (同方向, 物理的にはほぼ無い)、
 * 0.5=直角 (典型的な曲げ姿勢)、1=180°完全伸展。
 *
 * MediaPipe 単眼の世界座標では「肩-手首距離」は前向き動作で潰れる (奥行き z が
 * 強く減衰) が、肘の位置自体は奥行き依存が小さく、肘角度は punch 方向に依らず
 * "曲げ→伸ばし" を捉えられる。前向きパンチでも横/上スイングでも反応する。
 *
 * 長さ 0 のベクトルが含まれる場合は null。
 */
export function straightness(shoulder: Vec3, elbow: Vec3, wrist: Vec3): number | null {
  const se = sub(shoulder, elbow);
  const we = sub(wrist, elbow);
  const ls = length(se);
  const lw = length(we);
  if (ls === 0 || lw === 0) return null;
  const cos = dot(se, we) / (ls * lw);
  const clamped = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  return (1 - clamped) / 2;
}
