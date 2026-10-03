# Cut video to music beats

1. Add music and at least two video clips to the timeline. Put the video clips in the order you want on an unlocked track.
2. Select the music clip, open **Audio → Beat Sync**, and choose **Detect Beats**.
3. Select the video track or tracks and choose a cut every **1, 2, 4, or 8 beats**.
4. Review each clip's proposed start and end time, then choose **Apply Beat Cuts**.

The default **Cut Video to Beats** mode uses each video clip once, preserves its source in point, trims its end, and arranges the clips consecutively. Each selected track starts at the first detected beat in the trimmed music. Music stays in place. Undo and redo treat the sequence as one edit.

A clip must contain enough footage for the chosen beat interval. Extend its trim or choose fewer beats per clip if needed. The music must contain enough complete intervals for every selected video clip. Speed changes, reverse playback, freeze frames, grouped tracks, and transitions must be removed before using this mode. Other media occupying the planned video sequence must be moved first. Beat detection runs locally; irregular rhythms may need manual timing adjustments.

**Sync Settings** retains the previous Smart, One per Beat, and Preserve Duration modes, and includes an offset adjustment. Changing the music clip requires detecting beats again.

This creates a montage from existing video clips. It does not select highlights or automatically split a single recording into different shots.
