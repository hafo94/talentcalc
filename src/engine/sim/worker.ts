// Web Worker entry (section 4.7): plain postMessage, no library. One request at a time; the client cancels a run by
// terminating the worker.
import { runSim } from "./run";
import { simWeights } from "./weights";
import type { SimRequest, SimResponse } from "./types";

const port = self as unknown as {
  postMessage(message: SimResponse): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
};

port.onmessage = (e) => {
  const req = e.data;
  const onProgress = (done: number, total: number) =>
    port.postMessage({ type: "progress", id: req.id, done, total });
  try {
    if (req.type === "weights") {
      port.postMessage({ type: "weights", id: req.id, result: simWeights(req.request, onProgress) });
      return;
    }
    if (req.type !== "run") return;
    const result = runSim(req.input, req.config, { onProgress });
    port.postMessage({ type: "result", id: req.id, result });
  } catch (err) {
    port.postMessage({
      type: "error",
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
