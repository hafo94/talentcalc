// Web Worker entry (section 4.7): plain postMessage, no library. One request at a time; the client cancels a run by
// terminating the worker.
import { runSim } from "./run";
import type { SimRequest, SimResponse } from "./types";

const port = self as unknown as {
  postMessage(message: SimResponse): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
};

port.onmessage = (e) => {
  const req = e.data;
  if (req.type !== "run") return;
  try {
    const result = runSim(req.input, req.config, {
      onProgress: (done, total) => port.postMessage({ type: "progress", id: req.id, done, total }),
    });
    port.postMessage({ type: "result", id: req.id, result });
  } catch (err) {
    port.postMessage({
      type: "error",
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
