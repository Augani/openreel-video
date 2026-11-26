import '@testing-library/jest-dom';

const { loadDictionary } = await import('@openreel/i18n/translate');
await loadDictionary();

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});
