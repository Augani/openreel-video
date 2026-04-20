import React from "react";
import ReactDOM from "react-dom/client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import App from "./App";
import "./index.css";
import { I18nProvider } from "./i18n";
import { registerServiceWorker } from "./services/service-worker";

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

if (POSTHOG_KEY && POSTHOG_HOST) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
  });
}

registerServiceWorker().then((registration) => {
  if (registration) {
  }
});

const root = document.getElementById("root")!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <I18nProvider>
      {POSTHOG_KEY && POSTHOG_HOST ? (
        <PostHogProvider client={posthog}>
          <App />
        </PostHogProvider>
      ) : (
        <App />
      )}
    </I18nProvider>
  </React.StrictMode>,
);
