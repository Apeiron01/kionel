/// <reference types="vite/client" />

interface HTMLVideoElement {
  requestVideoFrameCallback?(cb: (now: number) => void): number;
}
