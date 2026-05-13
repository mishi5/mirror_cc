import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { attachWebcam, detachWebcam } from "./pose/webcam";
import { createPoseLandmarker, detectPose } from "./pose/landmarker";
import { drawOverlay, resizeOverlayCanvas } from "./debug/overlay";
import { Hud } from "./debug/hud";
import { StatusUi } from "./ui/status";

export interface AppDom {
  readonly video: HTMLVideoElement;
  readonly overlay: HTMLCanvasElement;
  readonly hud: { root: HTMLElement; fps: HTMLElement; detect: HTMLElement };
  readonly status: { root: HTMLElement; message: HTMLElement; retry: HTMLButtonElement };
}

const MAX_CONSECUTIVE_DETECT_ERRORS = 5;

export class App {
  private dom: AppDom;
  private statusUi: StatusUi;
  private hud: Hud;
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

      this.statusUi.setStatus({ kind: "loading", message: "カメラを起動中…" });
      try {
        this.stream = await attachWebcam(this.dom.video);
      } catch (err) {
        this.handleCameraError(err);
        return;
      }

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
  }

  private handleResize = (): void => {
    this.refreshOverlayCtx();
  };

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
      } else {
        this.overlayCtx.clearRect(0, 0, this.overlayWidth, this.overlayHeight);
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
