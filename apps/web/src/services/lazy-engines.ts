/**
 * Entry-safe access to the heavy engine modules (video, motion, audio, media
 * import, text animation ...).
 *
 * The welcome screen and the stores must not statically import the engines:
 * they are ~1.4 MB of the startup chunk. Anything that needs an engine goes
 * through this module instead, which resolves a memoised dynamic import of
 * `./engine-modules` (the only place that statically imports them). The module
 * is warmed together with the editor chunk (see editor-loader), so the first
 * time the editor needs an engine it is already resolved and the sync getter
 * returns it. Code that can run before that (project load from a cold start)
 * uses `whenEngineModulesLoaded`, which replays once the import settles.
 */
type EngineModules = typeof import("./engine-modules");

let loaded: EngineModules | null = null;
let pending: Promise<EngineModules> | null = null;
const loadedCallbacks: Array<(modules: EngineModules) => void> = [];

export function loadEngineModules(): Promise<EngineModules> {
  if (!pending) {
    pending = import("./engine-modules").then((modules) => {
      loaded = modules;
      for (const callback of loadedCallbacks.splice(0)) {
        try {
          callback(modules);
        } catch (error) {
          console.error("[lazy-engines] load callback failed:", error);
        }
      }
      return modules;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

type OptionalEngineModules = typeof import("./optional-engine-modules");
let optionalPending: Promise<OptionalEngineModules> | null = null;
let optionalLoaded: OptionalEngineModules | null = null;

/** The optional engine modules if they have already been loaded (never starts the load), else null. */
export function getLoadedOptionalEngineModules(): OptionalEngineModules | null {
  return optionalLoaded;
}

/** Engines nothing on the first-paint path needs (subtitles, speech-to-text, templates, sound library, multicam); memoised. */
export function loadOptionalEngineModules(): Promise<OptionalEngineModules> {
  if (!optionalPending) {
    optionalPending = import("./optional-engine-modules").then((modules) => {
      optionalLoaded = modules;
      return modules;
    });
    optionalPending.catch(() => {
      optionalPending = null;
    });
  }
  return optionalPending;
}

/** The engine modules if they have finished loading, else null. */
export function getLoadedEngineModules(): EngineModules | null {
  return loaded;
}

/**
 * Run `callback` with the engine modules: synchronously when already loaded,
 * otherwise as soon as the (memoised) import settles. Starts the load.
 */
export function whenEngineModulesLoaded(
  callback: (modules: EngineModules) => void,
): void {
  if (loaded) {
    callback(loaded);
    return;
  }
  loadedCallbacks.push(callback);
  void loadEngineModules();
}

/**
 * Register a callback that runs once, right after the modules load, without
 * starting the load itself (stores use this to hydrate their engine fields).
 */
export function onEngineModulesLoaded(
  callback: (modules: EngineModules) => void,
): void {
  if (loaded) {
    callback(loaded);
    return;
  }
  loadedCallbacks.push(callback);
}

/**
 * Test seam: replace the resolved engine modules (a partial fake, or null to
 * restore the real import on the next `loadEngineModules`). Tests that used to
 * `vi.mock("@openreel/core")` to fake an engine use this instead, because the
 * real modules are resolved once up front in the shared test setup.
 */
export function setEngineModulesForTests(
  modules: Partial<EngineModules> | null,
): void {
  if (modules === null) {
    loaded = null;
    pending = null;
    return;
  }
  loaded = modules as EngineModules;
  pending = Promise.resolve(loaded);
}
