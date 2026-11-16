import { useEffect, useRef } from "react";
import { getMediaBridge } from "../bridges/media-bridge";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import {
  hasMediaWaveform,
  MediaWaveformLoader,
} from "../services/media-waveform-loader";

export function useMediaWaveforms(ready: boolean): void {
  const project = useProjectStore((state) => state.project);
  const includeVideo = useUIStore((state) => state.showWaveforms);
  const loader = useRef<MediaWaveformLoader | null>(null);
  useEffect(() => {
    const instance = new MediaWaveformLoader({
      generate: async (item, signal) => {
        // These peaks were stripped from the saved project. Decode the actual
        // current blob instead of reusing a cache keyed to an older source.
        const data = await getMediaBridge().generateWaveform(
          item.blob,
          item.id,
          100,
          { enableCaching: false, signal },
        );
        return data?.peaks ?? null;
      },
      publish: (projectId, source, peaks) => {
        useProjectStore.setState((state) => {
          const item = state.project.mediaLibrary.items.find(
            (candidate) => candidate.id === source.id,
          );
          if (
            state.project.id !== projectId ||
            !item ||
            item.blob !== source.blob ||
            item.isPlaceholder ||
            item.isPending ||
            hasMediaWaveform(item)
          )
            return state;
          return {
            project: {
              ...state.project,
              mediaLibrary: {
                ...state.project.mediaLibrary,
                items: state.project.mediaLibrary.items.map((candidate) =>
                  candidate.id === source.id
                    ? { ...candidate, waveformData: peaks }
                    : candidate,
                ),
              },
            },
          };
        });
      },
    });
    loader.current = instance;
    return () => {
      instance.dispose();
      if (loader.current === instance) loader.current = null;
    };
  }, []);
  useEffect(() => {
    loader.current?.update(project, ready, includeVideo);
  }, [project, ready, includeVideo]);
}
