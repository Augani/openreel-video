import { useKieAIPoller } from "./useKieAIPoller";

/** Runs the KieAI poller. Loaded lazily by App so the poller, its store and the KieAI client stay off the startup chunk. */
export default function KieAIPollerHost(): null {
  useKieAIPoller();
  return null;
}
