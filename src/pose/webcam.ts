import { WEBCAM_CONSTRAINTS } from "./constants";

/**
 * getUserMedia で取得したカメラ映像を <video> に接続する。
 * 成功時に video.videoWidth / videoHeight が確定する (loadedmetadata 待ち)。
 *
 * 失敗時は元の DOMException をそのまま throw する:
 *   - getUserMedia 由来:
 *     - NotAllowedError: ユーザがカメラ権限を拒否
 *     - NotFoundError: カメラデバイスが見つからない
 *     - OverconstrainedError: 要求した制約 (解像度等) を満たすデバイスが無い
 *   - video.play() 由来:
 *     - NotAllowedError: ブラウザの autoplay policy で再生できない (getUserMedia の同名エラーとは別。muted を維持していれば通常発生しない)
 *   - その他: ハード障害など
 */
export async function attachWebcam(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(WEBCAM_CONSTRAINTS);
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    // listener を先に登録してから readyState を確認することで、
    // 登録前にイベントが発火しても取り逃さない (Promise の重複 resolve は no-op)。
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    if (video.readyState >= 1) {
      resolve();
    }
  });
  await video.play();
  return stream;
}

/**
 * stream の全トラックを停止し、video の srcObject を切り離す。
 * track.stop() 前に video.pause() を呼ぶことで
 * "play() request was interrupted by pause()" の警告を抑制する。
 */
export function detachWebcam(video: HTMLVideoElement, stream: MediaStream): void {
  video.pause();
  for (const track of stream.getTracks()) {
    track.stop();
  }
  video.srcObject = null;
}
