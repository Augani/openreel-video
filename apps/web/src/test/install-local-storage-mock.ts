export function installLocalStorageMock(): void {
  if (typeof window.localStorage?.setItem === "function") return;

  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: localStorageMock,
  });
}

installLocalStorageMock();
