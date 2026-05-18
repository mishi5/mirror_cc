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
