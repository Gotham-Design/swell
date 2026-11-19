// Runs analyzeFile off the main thread so a 50k-row file doesn't freeze the page.
import { ImportFileError, analyzeFile, type ParsedFile } from "./parse";

export type WorkerResult = { ok: true; file: ParsedFile } | { ok: false; error: string };

const post = (r: WorkerResult) => (self as unknown as { postMessage: (m: WorkerResult) => void }).postMessage(r);

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    post({ ok: true, file: analyzeFile(new Uint8Array(e.data)) });
  } catch (err) {
    post({ ok: false, error: err instanceof ImportFileError ? err.message : "We couldn't read that file. Is it a CSV export from your bank?" });
  }
};
