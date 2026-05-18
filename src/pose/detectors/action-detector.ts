import type { Landmark } from "@mediapipe/tasks-vision";
import { DEFAULT_DETECTOR_PARAMS, type DetectorParams } from "./params";
import type { ActionDetectorResult, PoseAction } from "./types";
import { createChargeDetector, type ChargeDetector } from "./charge";
import { createGuardDetector, type GuardDetector } from "./guard";
import { createAttackDetector, type AttackDetector } from "./attack";

export interface ActionDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): ActionDetectorResult;
}

/**
 * 3 ディテクタを束ね、優先度 attacking > guarding > charging > idle で
 * 単一の PoseAction を出力する。各ディテクタが既にヒステリシス/最小持続を
 * 持つため、状態機械側で二重のヒステリシスは入れない。
 * 全状態をインスタンス内に閉じる (将来 Map<poseIndex,ActionDetector> で2人化)。
 */
export function createActionDetector(
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS,
): ActionDetector {
  const charge: ChargeDetector = createChargeDetector(params.charge);
  const guard: GuardDetector = createGuardDetector(params.guard);
  const attack: AttackDetector = createAttackDetector(params.attack);

  return {
    update(world, timestampMs): ActionDetectorResult {
      const c = charge.update(world, timestampMs);
      const g = guard.update(world, timestampMs);
      const a = attack.update(world, timestampMs);

      let action: PoseAction = "idle";
      if (a.active) action = "attacking";
      else if (g.active) action = "guarding";
      else if (c.active) action = "charging";

      return { action, charge: c, guard: g, attack: a };
    },
  };
}
