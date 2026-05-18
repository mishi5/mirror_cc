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
