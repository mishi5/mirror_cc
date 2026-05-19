import { App } from "./app";

function getRequired<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!el || !(el instanceof ctor)) {
    throw new Error(`#${id} not found or wrong type`);
  }
  return el;
}

const app = new App({
  video: getRequired("webcam", HTMLVideoElement),
  overlay: getRequired("overlay", HTMLCanvasElement),
  hud: {
    root: getRequired("hud", HTMLElement),
    fps: getRequired("hud-fps", HTMLElement),
    detect: getRequired("hud-detect", HTMLElement),
    action: getRequired("hud-action", HTMLElement),
    scores: getRequired("hud-scores", HTMLElement),
    details: getRequired("hud-details", HTMLElement),
  },
  status: {
    root: getRequired("status", HTMLElement),
    message: getRequired("status-message", HTMLElement),
    retry: getRequired("status-retry", HTMLButtonElement),
  },
});

void app.start();
