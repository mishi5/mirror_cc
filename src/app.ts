import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { attachWebcam, detachWebcam } from "./pose/webcam";
import { createPoseLandmarker, detectPose } from "./pose/landmarker";
import { drawOverlay, resizeOverlayCanvas } from "./debug/overlay";
import { Hud } from "./debug/hud";
import { StatusUi } from "./ui/status";
import { createActionDetector, type ActionDetector } from "./pose/detectors/action-detector";
import { ActionHud } from "./debug/action-hud";
import { DebugRecorder } from "./debug/recorder";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "./pose/constants";
import { jointVec, sub, length } from "./pose/detectors/geometry";

/** 肩↔手首の 3D 距離 (腕の伸展量, m)。取得不可なら null。新アタック信号の候補。 */
function armExtension(
  world: ReadonlyArray<Readonly<{ x: number; y: number; z: number; visibility?: number }>>,
  shoulderIdx: number,
  wristIdx: number,
): number | null {
  const s = jointVec(world, shoulderIdx, DEFAULT_VISIBILITY_THRESHOLD);
  const w = jointVec(world, wristIdx, DEFAULT_VISIBILITY_THRESHOLD);
  if (!s || !w) return null;
  return length(sub(w, s));
}

/**
 * 主要関節 (鼻/両肩/両手首) の worldLandmarks visibility を診断表示する。
 * ディテクタは worldLandmarks の visibility >= 閾値 でゲートしているため、
 * これが低い/0 のときは「フレーム外」か「worldLandmarks に visibility が
 * 乗っていない」かを切り分けられる。閾値未満は ! を付ける。
 */
function formatWorldVisibility(
  world: ReadonlyArray<Readonly<{ visibility?: number }>>,
): string {
  const K = KEY_JOINT_INDICES;
  const f = (idx: number): string => {
    const v = world[idx]?.visibility ?? 0;
    return v.toFixed(2) + (v < DEFAULT_VISIBILITY_THRESHOLD ? "!" : "");
  };
  return (
    `vis n=${f(K.NOSE)} Ls=${f(K.LEFT_SHOULDER)} ` +
    `Rs=${f(K.RIGHT_SHOULDER)} Lw=${f(K.LEFT_WRIST)} Rw=${f(K.RIGHT_WRIST)}`
  );
}

export interface AppDom {
  readonly video: HTMLVideoElement;
  readonly overlay: HTMLCanvasElement;
  readonly hud: {
    root: HTMLElement;
    fps: HTMLElement;
    detect: HTMLElement;
    action: HTMLElement;
    scores: HTMLElement;
    details: HTMLElement;
    vis: HTMLElement;
  };
  readonly status: { root: HTMLElement; message: HTMLElement; retry: HTMLButtonElement };
}

const MAX_CONSECUTIVE_DETECT_ERRORS = 5;

export class App {
  private dom: AppDom;
  private statusUi: StatusUi;
  private hud: Hud;
  private actionDetector: ActionDetector = createActionDetector();
  private actionHud: ActionHud;
  private recorder = new DebugRecorder();
  private overlayCtx: CanvasRenderingContext2D;
  private overlayWidth = 0;
  private overlayHeight = 0;
  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private rafId: number | null = null;
  private consecutiveDetectErrors = 0;
  private isStarting = false;

  constructor(dom: AppDom) {
    this.dom = dom;
    this.statusUi = new StatusUi(dom.status.root, dom.status.message, dom.status.retry);
    this.hud = new Hud(dom.hud.root, dom.hud.fps, dom.hud.detect);
    this.actionHud = new ActionHud(dom.hud.action, dom.hud.scores, dom.hud.details);
    const ctx = dom.overlay.getContext("2d");
    if (!ctx) {
      throw new Error("2D context not available on overlay canvas");
    }
    this.overlayCtx = ctx;
  }

  async start(): Promise<void> {
    if (this.isStarting) return;
    this.isStarting = true;
    try {
      // 既存リソースを必ず破棄してから再初期化 (retry 時の二重リソース防止)
      this.stop();
      window.addEventListener("resize", this.handleResize);
      window.addEventListener("keydown", this.handleKey);

      this.statusUi.setStatus({ kind: "loading", message: "カメラを起動中…" });
      try {
        this.stream = await attachWebcam(this.dom.video);
      } catch (err) {
        this.handleCameraError(err);
        return;
      }
      // webcam の自然 aspect を CSS 変数に反映し、#webcam-stage の表示サイズを決める。
      // canvas は CSS で object-fit が効かないため、stage の aspect を webcam に合わせて
      // letterbox/pillarbox 表示にし、video と canvas を完全に同じ矩形に重ねる。
      this.applyWebcamAspect();

      this.statusUi.setStatus({
        kind: "loading",
        message: "姿勢推定モデルを読み込み中…",
      });
      try {
        this.landmarker = await createPoseLandmarker();
      } catch (err) {
        this.handleModelError(err);
        return;
      }

      this.refreshOverlayCtx();
      this.statusUi.setStatus({ kind: "ok" });
      this.hud.show();
      this.consecutiveDetectErrors = 0;
      this.loop();
    } finally {
      this.isStarting = false;
    }
  }

  stop(): void {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleKey);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      detachWebcam(this.dom.video, this.stream);
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.hud.hide();
    // ActionDetector の内部履歴・クールタイムを破棄し、retry 時に
    // stale state を持ち越さない (stop() の clean-slate 保証に合わせる)。
    this.actionDetector = createActionDetector();
    this.actionHud.clear();
  }

  private handleResize = (): void => {
    this.refreshOverlayCtx();
  };

  private handleKey = (e: KeyboardEvent): void => {
    if (e.key === "l" || e.key === "L") {
      this.recorder.download();
    }
  };

  private applyWebcamAspect(): void {
    const { videoWidth, videoHeight } = this.dom.video;
    if (videoWidth > 0 && videoHeight > 0) {
      const aspect = videoWidth / videoHeight;
      document.documentElement.style.setProperty(
        "--webcam-aspect",
        String(aspect),
      );
    }
  }

  private refreshOverlayCtx(): void {
    const ctx = resizeOverlayCanvas(this.dom.overlay);
    if (ctx) {
      this.overlayCtx = ctx;
    }
    const rect = this.dom.overlay.getBoundingClientRect();
    this.overlayWidth = rect.width;
    this.overlayHeight = rect.height;
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker) return;

    const now = performance.now();
    let detectMs = 0;
    try {
      const frame = detectPose(this.landmarker, this.dom.video, now);
      if (frame) {
        // video と overlay canvas は CSS で scaleX(-1) されているため
        // mirror 反転はそこで完結する。raw landmark を canvas 座標で描画する。
        drawOverlay(this.overlayCtx, frame.landmarks, this.overlayWidth, this.overlayHeight);
        detectMs = frame.detectTimeMs;
        const actionResult = this.actionDetector.update(
          frame.worldLandmarks,
          now,
        );
        this.actionHud.update(actionResult);

        const K = KEY_JOINT_INDICES;
        const w = frame.worldLandmarks;
        const visAt = (idx: number): number => w[idx]?.visibility ?? 0;
        this.recorder.record({
          t: now,
          action: actionResult.action,
          cScore: actionResult.charge.score,
          gScore: actionResult.guard.score,
          aScore: actionResult.attack.score,
          cActive: actionResult.charge.active,
          gActive: actionResult.guard.active,
          aActive: actionResult.attack.active,
          attackDetail: actionResult.attack.detail ?? "",
          extLeft: armExtension(w, K.LEFT_SHOULDER, K.LEFT_WRIST),
          extRight: armExtension(w, K.RIGHT_SHOULDER, K.RIGHT_WRIST),
          visNose: visAt(K.NOSE),
          visLs: visAt(K.LEFT_SHOULDER),
          visRs: visAt(K.RIGHT_SHOULDER),
          visLw: visAt(K.LEFT_WRIST),
          visRw: visAt(K.RIGHT_WRIST),
        });

        const rec = this.recorder.stats();
        this.dom.hud.vis.textContent =
          formatWorldVisibility(frame.worldLandmarks) +
          ` | rec=${rec.frames} atk=${rec.attackFrames} [L=ログ保存]`;
      } else {
        this.overlayCtx.clearRect(0, 0, this.overlayWidth, this.overlayHeight);
        const actionResult = this.actionDetector.update(null, now);
        this.actionHud.update(actionResult);
        const rec = this.recorder.stats();
        this.dom.hud.vis.textContent =
          `vis: no pose (体がフレーム外) | rec=${rec.frames} atk=${rec.attackFrames} [L=ログ保存]`;
      }
      this.consecutiveDetectErrors = 0;
    } catch (err) {
      this.consecutiveDetectErrors += 1;
      console.error("pose detect error:", err);
      if (this.consecutiveDetectErrors >= MAX_CONSECUTIVE_DETECT_ERRORS) {
        this.stop();
        this.statusUi.setStatus(
          {
            kind: "error",
            message: "姿勢推定が連続して失敗しました。リロードしてください。",
            retryLabel: "リロード",
          },
          () => location.reload(),
        );
        return;
      }
    }

    this.hud.update(now, detectMs);
  };

  private handleCameraError(err: unknown): void {
    const name = err instanceof DOMException ? err.name : "";
    let message = "カメラの起動に失敗しました。";
    if (name === "NotAllowedError") {
      message = "カメラへのアクセスを許可してください。";
    } else if (name === "NotFoundError") {
      message = "カメラが見つかりません。デバイスを接続してください。";
    } else if (name === "OverconstrainedError") {
      message = "利用可能なカメラが要求条件を満たしません。";
    }
    console.error("camera error:", err);
    this.statusUi.setStatus({ kind: "error", message }, () => {
      this.statusUi.setStatus({ kind: "loading", message: "再試行中…" });
      void this.start();
    });
  }

  private handleModelError(err: unknown): void {
    console.error("model error:", err);
    this.statusUi.setStatus(
      {
        kind: "error",
        message:
          "姿勢推定モデルの読み込みに失敗しました。ネットワーク接続を確認してください。",
        retryLabel: "リロード",
      },
      () => location.reload(),
    );
  }
}
