import { WEBCAM_CONSTRAINTS } from "./constants";

/**
 * getUserMedia で取得したカメラ映像を <video> に接続する。
 * 成功時に video.videoWidth / videoHeight が確定する (loadedmetadata 待ち)。
 *
 * 失敗時は元の DOMException をそのまま throw する:
 *   - NotAllowedError: ユーザがカメラ権限を拒否
 *   - NotFoundError: カメラデバイスが見つからない
 *   - OverconstrainedError: 要求した制約 (解像度等) を満たすデバイスが無い
 *   - その他: ハード障害など
 */
export async function attachWebcam(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(WEBCAM_CONSTRAINTS);
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
  await video.play();
  return stream;
}

/**
 * stream の全トラックを停止し、video の srcObject を切り離す。
 */
export function detachWebcam(video: HTMLVideoElement, stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  video.srcObject = null;
}
