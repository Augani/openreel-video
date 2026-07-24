import { useCallback } from "react";

type EventProperties = Record<string, string | number | boolean | null>;

const analyticsKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const analyticsHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
let analyticsClientPromise: Promise<typeof import("posthog-js").default | null> | null = null;

function getAnalyticsClient(): Promise<typeof import("posthog-js").default | null> {
  if (!analyticsKey || !analyticsHost) return Promise.resolve(null);
  if (!analyticsClientPromise) {
    analyticsClientPromise = import("posthog-js").then(({ default: client }) => {
      client.init(analyticsKey, {
        api_host: analyticsHost,
        capture_pageview: true,
        capture_pageleave: true,
      });
      return client;
    });
  }
  return analyticsClientPromise;
}

export function useAnalytics() {
  const track = useCallback(
    (event: string, properties?: EventProperties) => {
      void getAnalyticsClient().then((client) => client?.capture(event, properties));
    },
    [],
  );

  const identify = useCallback(
    (userId: string, properties?: EventProperties) => {
      void getAnalyticsClient().then((client) => client?.identify(userId, properties));
    },
    [],
  );

  return { track, identify, isEnabled: Boolean(analyticsKey && analyticsHost) };
}

export const AnalyticsEvents = {
  PROJECT_CREATED: "project_created",
  PROJECT_OPENED: "project_opened",
  PROJECT_EXPORTED: "project_exported",
  CLIP_ADDED: "clip_added",
  TEXT_ADDED: "text_added",
  EFFECT_APPLIED: "effect_applied",
  PARTICLE_EFFECT_ADDED: "particle_effect_added",
  TEMPLATE_USED: "template_used",
} as const;
