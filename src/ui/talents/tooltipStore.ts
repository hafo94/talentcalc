import { create } from "zustand";

interface TooltipState {
  nodeId: number | null;
  anchor: HTMLElement | null;
  open(nodeId: number, anchor: HTMLElement): void;
  close(): void;
}

export const useTooltip = create<TooltipState>()((set) => ({
  nodeId: null,
  anchor: null,
  open: (nodeId, anchor) => set({ nodeId, anchor }),
  close: () => set({ nodeId: null, anchor: null }),
}));
