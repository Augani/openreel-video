import "@testing-library/jest-dom/vitest";

const { loadDictionary } = await import("@openreel/i18n/translate");
await loadDictionary();
