import "../../test/install-local-storage-mock";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { initLanguage, languageStore } from "@openreel/i18n";
import { WelcomeScreen } from "./WelcomeScreen";
import { useEngineStore } from "../../stores/engine-store";
import { useUIStore } from "../../stores/ui-store";
import { useOnboardingStore } from "../../stores/onboarding-store";

vi.mock("../../hooks/use-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("../../hooks/useEditorPreload", () => ({ useEditorPreload: () => {} }));
vi.mock("../../hooks/usePhoneEditor", () => ({ usePhoneEditor: () => false }));
vi.mock("../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: vi.fn() }),
  AnalyticsEvents: { PROJECT_CREATED: "project_created" },
}));

beforeEach(() => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  useUIStore.setState({ skipWelcomeScreen: false });
  useOnboardingStore.setState({
    status: "done",
    skippedBy: undefined,
    openSheet: null,
    bandOpen: false,
    formatChosenProjectId: undefined,
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("openreel.language");
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("renders the welcome screen in Simplified Chinese and keeps brand names", () => {
  render(<WelcomeScreen />);

  expect(screen.getByText("从想法到导出。")).toBeInTheDocument();
  expect(screen.getByText("横向")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建横向项目" })).toBeInTheDocument();
  expect(screen.getByText("浏览模板")).toBeInTheDocument();
  expect(screen.getAllByText(/Open Reel Video/).length).toBeGreaterThan(0);
});
