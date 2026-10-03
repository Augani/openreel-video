# Multi-camera editing

Open **Multi-Camera Editing** near the top of the inspector. It remains available with no selection, a single clip, or multiple selected clips. Selected timeline cameras are preselected when the panel opens.

1. Put camera recordings of the same event on the timeline. Keep camera sources on their own unlocked tracks.
2. Choose at least two recordings and select **Create Group**.
3. Use **Sync Audio** for recordings with shared reference sound, or enter offsets manually.
4. Move the playhead inside the group's time range and use a camera's **Cut to … at playhead** button. This creates an editable output track and makes the camera cut at that time.
5. Alternatively, select **Auto Edit** for a speaker-driven edit. Expand **Automatic edit settings** to adjust pacing and overlap behavior. Turn off **Sync cameras before Auto Edit** to retain manual offsets.

Generated edits hide and mute camera source tracks and clear their solo state. The source clips remain in the project. One undo restores the previous output and source-track state; group creation and camera cuts also support undo/redo. Saved camera groups return when the project reopens.

Automatic analysis requires available source audio and normal-speed forward clips. Unreliable audio matches produce an error instead of claiming a successful sync. Speaker detection works best with distinct microphone recordings; a shared mixed soundtrack may not distinguish speakers. Manual camera cutting works without audio analysis.
