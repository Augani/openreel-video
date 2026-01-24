import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";

type EventProperties = Record<string, string | number | boolean | null>;

export function useAnalytics() {
  const posthog = usePostHog();

  const track = useCallback(
    (event: string, properties?: EventProperties) => {
      if (posthog) {
        posthog.capture(event, properties);
      }
    },
    [posthog]
  );

  const identify = useCallback(
    (userId: string, properties?: EventProperties) => {
      if (posthog) {
        posthog.identify(userId, properties);
      }
    },
    [posthog]
  );

  return { track, identify, isEnabled: !!posthog };
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
