"use client";

import { MAX_FILE_BYTES, type ParsedFile } from "./parse";
import type { WorkerResult } from "./parse.worker";

/** Parse a picked file in a web worker. Rejects with a message for the user. */
export async function readInWorker(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 10 MB. Split it into smaller date ranges.");
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<ParsedFile>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerResult>) => (e.data.ok ? resolve(e.data.file) : reject(new Error(e.data.error)));
      worker.onerror = () => reject(new Error("We couldn't read that file."));
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
