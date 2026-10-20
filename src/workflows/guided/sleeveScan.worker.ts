/// <reference lib="webworker" />
/**
 * Web Worker for the whole-photo sleeve scan (docs/marker-detection.md). Receives one full-res
 * grey image (transferred, not copied) and answers with the scan result.
 */
import { scanSleeves, type ScanResult } from './sleeveScan';

export interface ScanRequest {
  width: number;
  height: number;
  grey: Uint8ClampedArray;
  markerIds: string[];
  budgetMs?: number;
}

export type ScanReply = { ok: true; result: ScanResult } | { ok: false; error: string };

self.onmessage = (ev: MessageEvent<ScanRequest>) => {
  const { width, height, grey, markerIds, budgetMs } = ev.data;
  let reply: ScanReply;
  try {
    reply = { ok: true, result: scanSleeves({ width, height, grey }, { markerIds, budgetMs }) };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
