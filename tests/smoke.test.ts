import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("Vitest が起動し、最低限の expect が動作する", () => {
    expect(1 + 1).toBe(2);
  });

  it("TypeScript strict 型チェックでオブジェクトリテラルが推論できる", () => {
    const obj: { a: number; b: string } = { a: 1, b: "x" };
    expect(obj.a).toBe(1);
    expect(obj.b).toBe("x");
  });
});
