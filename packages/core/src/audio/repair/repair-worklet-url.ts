/// <reference path="./vite-worker-url.d.ts" />
// Isolated so tests and non-browser code never evaluate the bundler-specific import.
import workletUrl from "./repair-worklet?worker&url";

export default workletUrl;
