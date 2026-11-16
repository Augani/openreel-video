import type { Project, Clip, Track } from "@openreel/core";

export const buildTriggerTrackBuffer = async (
  project: Project,
  backgroundClip: Clip,
  sourceTrack: Track,
): Promise<AudioBuffer> => {
  const overlappingClips = sourceTrack.clips.filter((sourceClip) => {
    const sourceEnd = sourceClip.startTime + sourceClip.duration;
    const backgroundEnd = backgroundClip.startTime + backgroundClip.duration;
    return (
      sourceClip.id !== backgroundClip.id &&
      sourceClip.startTime < backgroundEnd &&
      sourceEnd > backgroundClip.startTime
    );
  });

  if (overlappingClips.length === 0) {
    throw new Error("No overlapping trigger clips were found for this clip.");
  }

  const decodeContext = new AudioContext();

  try {
    const offlineContext = new OfflineAudioContext(
      Math.max(1, project.settings.channels),
      Math.max(
        1,
        Math.ceil(backgroundClip.duration * project.settings.sampleRate),
      ),
      project.settings.sampleRate,
    );

    let scheduledSources = 0;

    for (const sourceClip of overlappingClips) {
      if (sourceClip.reversed) {
        continue;
      }

      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === sourceClip.mediaId,
      );

      if (!mediaItem?.blob) {
        continue;
      }

      const overlapStart = Math.max(
        backgroundClip.startTime,
        sourceClip.startTime,
      );
      const overlapEnd = Math.min(
        backgroundClip.startTime + backgroundClip.duration,
        sourceClip.startTime + sourceClip.duration,
      );

      if (overlapEnd <= overlapStart) {
        continue;
      }

      try {
        const arrayBuffer = await mediaItem.blob.arrayBuffer();
        const decodedBuffer = await decodeContext.decodeAudioData(
          arrayBuffer.slice(0),
        );
        const source = offlineContext.createBufferSource();
        const gainNode = offlineContext.createGain();
        const playbackRate = Math.max(0.1, sourceClip.speed ?? 1);
        const timelineOffset = overlapStart - backgroundClip.startTime;
        const mediaOffset =
          sourceClip.inPoint +
          Math.max(0, overlapStart - sourceClip.startTime) * playbackRate;
        const renderDuration = overlapEnd - overlapStart;

        source.buffer = decodedBuffer;
        source.playbackRate.value = playbackRate;
        gainNode.gain.value = sourceClip.volume;

        source.connect(gainNode);
        gainNode.connect(offlineContext.destination);
        source.start(
          timelineOffset,
          mediaOffset,
          renderDuration * playbackRate,
        );
        scheduledSources += 1;
      } catch {
        continue;
      }
    }

    if (scheduledSources === 0) {
      throw new Error(
        "No decodable trigger audio was found on the selected source track.",
      );
    }

    return offlineContext.startRendering();
  } finally {
    await decodeContext.close();
  }
};
