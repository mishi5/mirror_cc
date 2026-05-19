import { describe, it, expect } from "vitest";
import { DebugRecorder, type RecorderSample } from "../../src/debug/recorder";

function sample(overrides: Partial<RecorderSample> = {}): RecorderSample {
  return {
    t: 0,
    action: "idle",
    cScore: 0,
    gScore: 0,
    aScore: 0,
    cActive: false,
    gActive: false,
    aActive: false,
    attackDetail: "spd=- dst=-",
    extLeft: null,
    extRight: null,
    visNose: 1,
    visLs: 1,
    visRs: 1,
    visLw: 1,
    visRw: 1,
    ...overrides,
  };
}

describe("DebugRecorder", () => {
  it("record でフレームが蓄積され stats に反映される", () => {
    const r = new DebugRecorder();
    r.record(sample({ t: 1 }));
    r.record(sample({ t: 2 }));
    expect(r.stats().frames).toBe(2);
    expect(r.stats().attackFrames).toBe(0);
  });

  it("aActive のフレームを attackFrames として数える", () => {
    const r = new DebugRecorder();
    r.record(sample({ aActive: false }));
    r.record(sample({ aActive: true }));
    r.record(sample({ aActive: true }));
    expect(r.stats().attackFrames).toBe(2);
  });

  it("maxSamples を超えると古いフレームを捨てる (リングバッファ)", () => {
    const r = new DebugRecorder(3);
    for (let i = 0; i < 5; i++) r.record(sample({ t: i }));
    const stats = r.stats();
    expect(stats.frames).toBe(3);
    const parsed = JSON.parse(r.serialize()) as {
      frames: { t: number }[];
      frameCount: number;
    };
    expect(parsed.frameCount).toBe(3);
    // 最古 (t=0,1) は捨てられ t=2,3,4 が残る
    expect(parsed.frames.map((f) => f.t)).toEqual([2, 3, 4]);
  });

  it("mark で ground-truth ラベルを記録し serialize に含む", () => {
    const r = new DebugRecorder();
    r.record(sample({ t: 10 }));
    r.mark("punch", 12);
    r.mark("punch", 30);
    expect(r.stats().marks).toBe(2);
    const parsed = JSON.parse(r.serialize()) as {
      marks: { t: number; label: string }[];
    };
    expect(parsed.marks).toEqual([
      { t: 12, label: "punch" },
      { t: 30, label: "punch" },
    ]);
  });

  it("serialize は attackFrames と frames を含む JSON を返す", () => {
    const r = new DebugRecorder();
    r.record(sample({ aActive: true, action: "attacking" }));
    const parsed = JSON.parse(r.serialize()) as {
      attackFrames: number;
      frames: { action: string }[];
    };
    expect(parsed.attackFrames).toBe(1);
    expect(parsed.frames[0]!.action).toBe("attacking");
  });
});
