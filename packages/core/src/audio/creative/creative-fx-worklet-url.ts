/// <reference path="../repair/vite-worker-url.d.ts" />
// Isolated so tests and non-browser code never evaluate the bundler-specific import.
import workletUrl from "./creative-fx-worklet?worker&url";

export default workletUrl;
