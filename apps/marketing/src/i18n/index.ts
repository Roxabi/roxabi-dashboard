export { fr } from "./fr";
export { en } from "./en";
export type { Translations } from "./fr";

// Graph demo data (shared, untranslated technical issue refs)
export const GRAPH_NODES = [
  { id: "800", num: "#800", status: "epic",    title: "Epic: factory Q2",           x: 200, y: 28,  w: 130 },
  { id: "847", num: "#847", status: "ready",   title: "Ajout plugin webhook NATS",  x: 52,  y: 100, w: 118 },
  { id: "851", num: "#851", status: "ready",   title: "Docs API publique",          x: 200, y: 100, w: 108 },
  { id: "839", num: "#839", status: "running", title: "Refactor clipool worker",    x: 348, y: 100, w: 118 },
  { id: "855", num: "#855", status: "blocked", title: "Migrate vers bun workspace", x: 348, y: 178, w: 118 },
  { id: "312", num: "#312", status: "ready",   title: "Fallback provider chain",    x: 52,  y: 178, w: 118 },
  { id: "318", num: "#318", status: "blocked", title: "Rate-limit par tenant",      x: 52,  y: 248, w: 108 },
  { id: "198", num: "#198", status: "running", title: "Streaming STT pipeline",     x: 200, y: 248, w: 118 },
] as const;

export const GRAPH_EDGES = [
  { from: "800", to: "847", type: "parent" },
  { from: "800", to: "851", type: "parent" },
  { from: "800", to: "839", type: "parent" },
  { from: "800", to: "855", type: "parent" },
  { from: "839", to: "855", type: "blocked-by" },
  { from: "312", to: "318", type: "blocked-by" },
] as const;

export type GraphNode = (typeof GRAPH_NODES)[number];
export type GraphEdge = (typeof GRAPH_EDGES)[number];