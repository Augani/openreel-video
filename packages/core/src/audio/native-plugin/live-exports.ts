/**
 * Node-safe surface of the live insert code for the desktop main process: no Web Audio, no worklet, nothing that needs a DOM.
 * (The main process imports core by relative path, like the plugin render loop does, and must not pull the graph in.)
 */
export * from "./live/live-latency";
export * from "./live/live-ring";
export { sanitizeLatencySamples, blockParameterValues, changedParameterValues } from "./native-plugin-render";
