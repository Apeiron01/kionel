/**
 * Conditional model of optical transfer duration, not a device measurement.
 *
 * The app used to accept 64 MiB in silence. At the channel's real rate that is
 * roughly half an hour of holding a phone steady — a number nobody would agree
 * to if they had been shown it, which is exactly why it has to be shown.
 *
 * The estimate is computed from the settings in front of the user, never from a
 * figure typed into marketing copy, so changing the QR version or frame rate
 * changes the number they are looking at.
 *
 * Synthetic QR decoding establishes codec behavior only. It cannot establish
 * camera goodput or rule out encode/decode bottlenecks on another device.
 * Camera FPS, display FPS, loss and whole-image decode latency all constrain
 * the result. Defaults are assumptions until a device pair is measured.
 */

import { frameBytes } from "./encode.ts";

/** Frame + trailer bytes the protocol spends on every QR. */
const FRAME_OVERHEAD = 20;

/** Display refresh we assume when a frame is held for `hold` refreshes. */
const DISPLAY_HZ = 60;

/**
 * Fraction of frames we expect the camera to miss.
 *
 * Planning assumption only. Recovery under simulated 30% loss does not tell
 * us the physical channel's loss rate, nor fountain recovery overhead.
 */
const EXPECTED_LOSS = 0.25;

/** Envelope, encryption and signature overhead, as a multiplier on file size. */
const WIRE_OVERHEAD = 1.05;

/**
 * What the app accepts. The protocol ceiling, deliberately.
 *
 * An earlier version capped this at 5 MiB so nobody could start a transfer they
 * would regret. That was the wrong instrument: refusing a file the protocol can
 * carry is a limit on the product, while a long transfer is only a limit on the
 * user's patience — and patience is theirs to spend. The honest fix is to price
 * the wait *before* they commit, and to make a long transfer survivable rather
 * than forbidden (see `RESUMABLE_ABOVE_SECONDS`).
 */
export const MAX_CONTENT_LIMIT_BYTES = 64 * 1024 * 1024;

/** @deprecated Kept so callers keep compiling; equal to the ceiling now. */
export const DEFAULT_CONTENT_LIMIT_BYTES = MAX_CONTENT_LIMIT_BYTES;

/**
 * Above this the UI stops treating the transfer as one sitting.
 *
 * The real obstacle to a large file is not the byte count, it is that someone
 * has to hold a phone steady at a screen for the whole thing. Past roughly two
 * minutes that stops being reasonable, so past this point the receiver is told
 * it can stop and resume — which is the difference between "too big" and
 * "several sessions".
 */
export const RESUMABLE_ABOVE_SECONDS = 120;

export interface TransferEstimate {
  basis: "model";
  /** Payload bytes carried per frame after protocol overhead. */
  bytesPerFrame: number;
  /** Frames the sender will display, including expected retransmission. */
  frames: number;
  /** Effective throughput in bytes per second, after expected loss. */
  bytesPerSecond: number;
  seconds: number;
  /** Human-readable duration, already rounded to something worth reading. */
  label: string;
  /** Too long for one sitting — the receiver should be offered resume. */
  needsResume: boolean;
}

export function estimateTransfer(
  contentBytes: number,
  options: { version: number; hold: number; tiles?: number; displayHz?: number; cameraFps?: number; decodeMs?: number; lossRate?: number },
): TransferEstimate {
  if (!Number.isSafeInteger(contentBytes) || contentBytes < 0) throw new Error("invalid file size");
  const tiles = options.tiles ?? 1;
  if (![1, 4, 9].includes(tiles)) throw new Error("code count must be 1, 4 or 9");
  const displayHz = options.displayHz ?? DISPLAY_HZ;
  const cameraFps = options.cameraFps ?? 30;
  const lossRate = options.lossRate ?? EXPECTED_LOSS;
  if (![options.hold, displayHz, cameraFps].every(v => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(lossRate) || lossRate < 0 || lossRate >= 1 ||
      (options.decodeMs !== undefined && (!Number.isFinite(options.decodeMs) || options.decodeMs <= 0))) {
    throw new Error("invalid transfer model parameters");
  }
  // Linear scaling holds only IF every tile is readable, within the same decode budget.
  const bytesPerFrame = Math.max(1, frameBytes(options.version) - FRAME_OVERHEAD) * tiles;
  const framesPerSecond = Math.min(displayHz / options.hold, cameraFps, options.decodeMs === undefined ? Infinity : 1000 / options.decodeMs);

  const wireBytes = Math.ceil(contentBytes * WIRE_OVERHEAD);
  const sourceFrames = Math.ceil(wireBytes / bytesPerFrame);
  // Lost frames have to be sent again, so the sender shows more than it needs.
  const frames = Math.ceil(sourceFrames / (1 - lossRate));

  const seconds = frames / framesPerSecond;
  return {
    basis: "model",
    bytesPerFrame,
    frames,
    bytesPerSecond: Math.round(bytesPerFrame * framesPerSecond * (1 - lossRate)),
    seconds,
    label: durationLabel(seconds),
    needsResume: seconds > RESUMABLE_ABOVE_SECONDS,
  };
}

/**
 * Deliberately coarse. "4 minutes 37 seconds" claims a precision the optical
 * channel does not have; "about 5 minutes" is both honest and easier to act on.
 */
export function durationLabel(seconds: number): string {
  if (seconds < 1) return "under a second";
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = seconds / 60;
  if (minutes < 60) return `about ${Math.max(1, Math.round(minutes))} minutes`;
  const hours = minutes / 60;
  return `about ${hours.toFixed(1)} hours`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
