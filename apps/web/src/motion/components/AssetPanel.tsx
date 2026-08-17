import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  FileJson,
  FileCode2,
  Filter,
  Plus,
  Search,
  Upload,
} from "@/icons/lucide-compat";
import {
  ToolcraftFileDropControl,
  ToolcraftTextInputControl,
} from "@openreel/ui";
import {
  createMotionImageAssetFromMediaItem,
  createMotionImageLayerFromAsset,
  createMotionVideoAssetFromMediaItem,
  createMotionVideoLayerFromAsset,
  importLottieAsMotionComposition,
  importSvgAsMotionComposition,
  type MediaItem,
  type MotionAsset,
  type MotionComposition,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { useMotionStore } from "../stores/motion-store";
import { useTranslation } from "react-i18next";

interface AssetPanelProps {
  composition: MotionComposition;
}

type AssetCategory =
  | "all"
  | "footage"
  | "images"
  | "audio"
  | "solids"
  | "comps";

interface GridEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: "image" | "video" | "audio" | "solid";
  readonly thumbnailUrl: string | null;
  readonly onActivate?: () => void;
}

const CATEGORY_TABS: ReadonlyArray<{ id: AssetCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "footage", label: "Footage" },
  { id: "images", label: "Images" },
  { id: "audio", label: "Audio" },
  { id: "solids", label: "Solids" },
  { id: "comps", label: "Comps" },
];

const SOLID_ASSET_TYPES: ReadonlyArray<MotionAsset["type"]> = [
  "svg",
  "lottie",
  "figma",
];

export function AssetPanel({ composition }: AssetPanelProps): JSX.Element {
  const { t } = useTranslation();
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions,
  );
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const importMedia = useProjectStore((state) => state.importMedia);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const selectAudioClip = useMotionStore((state) => state.selectAudioClip);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const playhead = useMotionStore((state) => state.playhead);
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssetCategory>("all");
  const [sceneAssetsOnly, setSceneAssetsOnly] = useState(false);
  const [isImportingMedia, setIsImportingMedia] = useState(false);

  const getLatestComposition = useCallback(
    () =>
      useProjectStore.getState().getMotionComposition(composition.id) ??
      composition,
    [composition],
  );

  const insertionTime = useCallback(
    (target: MotionComposition) =>
      Math.min(
        Math.max(0, playhead),
        Math.max(0, target.duration - 1 / Math.max(1, target.frameRate)),
      ),
    [playhead],
  );

  const persistLayer = useCallback(
    async (nextComposition: MotionComposition, layerId: string, name: string) => {
      const result = await upsertMotionComposition(nextComposition);
      if (!result.success) {
        toast.error(
          "Could not add asset",
          result.error?.message ?? "The motion scene could not be updated.",
        );
        return false;
      }
      selectLayer(layerId);
      toast.success("Layer added", `${name} added at the playhead.`);
      return true;
    },
    [selectLayer, upsertMotionComposition],
  );

  const addImageAssetAsLayer = useCallback(
    async (asset: MotionAsset, includeAsset: boolean) => {
      if (asset.type !== "image") return;
      const target = getLatestComposition();
      const startTime = insertionTime(target);
      const layer = createMotionImageLayerFromAsset(asset, {
        id: `motion-layer-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        startTime,
        duration: Math.max(1 / target.frameRate, target.duration - startTime),
        compositionWidth: target.width,
        compositionHeight: target.height,
      });
      await persistLayer(
        {
          ...target,
          assets: includeAsset ? [...target.assets, asset] : target.assets,
          layers: [...target.layers, layer],
          modifiedAt: Date.now(),
        },
        layer.id,
        asset.name,
      );
    },
    [getLatestComposition, insertionTime, persistLayer],
  );

  const addVideoAssetAsLayer = useCallback(
    async (asset: MotionAsset, includeAsset: boolean) => {
      if (asset.type !== "video") return;
      const target = getLatestComposition();
      const startTime = insertionTime(target);
      const availableDuration = Math.max(
        1 / target.frameRate,
        target.duration - startTime,
      );
      const layer = createMotionVideoLayerFromAsset(asset, {
        id: `motion-layer-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        startTime,
        duration: Math.min(
          availableDuration,
          asset.duration && asset.duration > 0
            ? asset.duration
            : availableDuration,
        ),
        compositionWidth: target.width,
        compositionHeight: target.height,
      });
      await persistLayer(
        {
          ...target,
          assets: includeAsset ? [...target.assets, asset] : target.assets,
          layers: [...target.layers, layer],
          modifiedAt: Date.now(),
        },
        layer.id,
        asset.name,
      );
    },
    [getLatestComposition, insertionTime, persistLayer],
  );

  const addMediaAsImageLayer = useCallback(
    async (item: MediaItem) => {
      if (item.type !== "image") return;
      const target = getLatestComposition();
      const existingAsset = target.assets.find(
        (asset) => asset.mediaId === item.id,
      );
      const asset = existingAsset ?? createMotionImageAssetFromMediaItem(item);
      await addImageAssetAsLayer(asset, !existingAsset);
    },
    [addImageAssetAsLayer, getLatestComposition],
  );

  const addMediaAsVideoLayer = useCallback(
    async (item: MediaItem) => {
      if (item.type !== "video") return;
      const target = getLatestComposition();
      const existingAsset = target.assets.find(
        (asset) => asset.mediaId === item.id,
      );
      const asset = existingAsset ?? createMotionVideoAssetFromMediaItem(item);
      await addVideoAssetAsLayer(asset, !existingAsset);
    },
    [addVideoAssetAsLayer, getLatestComposition],
  );

  const addMediaAsAudioClip = useCallback(
    async (item: MediaItem) => {
      if (item.type !== "audio") return;
      const target = getLatestComposition();
      const startTime = insertionTime(target);
      const availableDuration = Math.max(
        1 / target.frameRate,
        target.duration - startTime,
      );
      const clipDuration =
        item.metadata.duration && item.metadata.duration > 0
          ? Math.min(item.metadata.duration, availableDuration)
          : availableDuration;
      const audioClip = {
        id: `motion-audio-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: item.name,
        mediaId: item.id,
        startTime,
        duration: clipDuration,
        trimStart: 0,
        gain: 1,
      };
      const result = await upsertMotionComposition({
        ...target,
        audioClips: [...(target.audioClips ?? []), audioClip],
        modifiedAt: Date.now(),
      });
      if (result.success) {
        selectAudioClip(audioClip.id);
        setRightTab("sync");
        toast.success("Audio added", `${item.name} added at the playhead.`);
      } else {
        toast.error(
          "Could not add audio",
          result.error?.message ?? "The motion scene could not be updated.",
        );
      }
    },
    [
      getLatestComposition,
      insertionTime,
      selectAudioClip,
      setRightTab,
      upsertMotionComposition,
    ],
  );

  const addMediaAsLayer = useCallback(
    (item: MediaItem) => {
      if (item.type === "image") void addMediaAsImageLayer(item);
      else if (item.type === "video") void addMediaAsVideoLayer(item);
      else if (item.type === "audio") void addMediaAsAudioClip(item);
    },
    [addMediaAsAudioClip, addMediaAsImageLayer, addMediaAsVideoLayer],
  );

  const addExistingAssetAsLayer = useCallback(
    (asset: MotionAsset) => {
      if (asset.type === "image") void addImageAssetAsLayer(asset, false);
      else if (asset.type === "video") void addVideoAssetAsLayer(asset, false);
    },
    [addImageAssetAsLayer, addVideoAssetAsLayer],
  );

  const saveImportedComposition = async (imported: MotionComposition) => {
    const result = await upsertMotionComposition(imported);
    if (!result.success) {
      throw new Error(result.error?.message ?? "Could not import composition.");
    }
    setActiveCompositionId(imported.id);
    selectLayer(imported.layers[0]?.id ?? null);
  };

  const importSvgFile = async (file: File) => {
    try {
      const svgContent = await file.text();
      const imported = importSvgAsMotionComposition(svgContent, {
        name: file.name.replace(/\.svg$/i, "") || "Imported SVG",
      });
      await saveImportedComposition(imported);
      toast.success("SVG imported", imported.name);
    } catch (error) {
      console.error("[MotionCreator] SVG import failed:", error);
      toast.error(
        "SVG import failed",
        error instanceof Error ? error.message : "Could not read this SVG.",
      );
    }
  };

  const importLottieFile = async (file: File) => {
    try {
      const lottie = JSON.parse(await file.text());
      const imported = importLottieAsMotionComposition({
        ...lottie,
        nm: lottie.nm || file.name.replace(/\.(json|lottie)$/i, ""),
      });
      await saveImportedComposition(imported);
      toast.success("Lottie imported", imported.name);
    } catch (error) {
      console.error("[MotionCreator] Lottie import failed:", error);
      toast.error(
        "Lottie import failed",
        error instanceof Error ? error.message : "Could not read this Lottie file.",
      );
    }
  };

  const handleSvgInputChange = (files: File | File[] | null) => {
    const file = Array.isArray(files) ? files[0] : files;
    if (file) void importSvgFile(file);
  };

  const handleLottieInputChange = (files: File | File[] | null) => {
    const file = Array.isArray(files) ? files[0] : files;
    if (file) void importLottieFile(file);
  };

  const handleMediaInputChange = (files: File | File[] | null) => {
    const selectedFiles = (Array.isArray(files) ? files : files ? [files] : []).filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.type.startsWith("video/") ||
        file.type.startsWith("audio/"),
    );
    if (selectedFiles.length === 0) return;
    void (async () => {
      setIsImportingMedia(true);
      let imported = 0;
      try {
        for (const file of selectedFiles) {
          const result = await importMedia(file);
          if (result.success) imported += 1;
          else {
            toast.error(
              "Media import failed",
              result.error?.message ?? `Could not import ${file.name}.`,
            );
          }
        }
        if (imported > 0) {
          toast.success(
            imported === 1 ? "Media imported" : `${imported} files imported`,
            "Select the asset to add it at the playhead.",
          );
        }
      } finally {
        setIsImportingMedia(false);
      }
    })();
  };

  const compositions = useMemo(
    () => motionCompositions ?? [],
    [motionCompositions],
  );

  const gridEntries = useMemo<GridEntry[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = (name: string) =>
      normalizedQuery.length === 0 ||
      name.toLowerCase().includes(normalizedQuery);

    if (category === "comps") {
      return compositions
        .filter((comp) => matchesQuery(comp.name))
        .map<GridEntry>((comp) => ({
          key: `comp-${comp.id}`,
          name: comp.name,
          kind: "solid",
          thumbnailUrl: null,
          onActivate: () => setActiveCompositionId(comp.id),
        }));
    }

    const sceneEntries = composition.assets
      .filter((asset) => {
        if (!matchesQuery(asset.name)) return false;
        if (category === "all") return true;
        if (category === "footage") return asset.type === "video";
        if (category === "images") return asset.type === "image";
        if (category === "audio") return asset.type === "audio";
        if (category === "solids") return SOLID_ASSET_TYPES.includes(asset.type);
        return false;
      })
      .map<GridEntry>((asset) => ({
        key: `asset-${asset.id}`,
        name: asset.name,
        kind:
          asset.type === "video"
            ? "video"
            : asset.type === "image"
              ? "image"
              : asset.type === "audio"
                ? "audio"
                : "solid",
        thumbnailUrl: asset.url ?? null,
        onActivate:
          asset.type === "image" || asset.type === "video"
            ? () => addExistingAssetAsLayer(asset)
            : undefined,
      }));

    const mediaEntries = sceneAssetsOnly
      ? []
      : mediaItems
      .filter((item) => {
        if (!matchesQuery(item.name)) return false;
        if (category === "all") return true;
        if (category === "footage") return item.type === "video";
        if (category === "images") return item.type === "image";
        if (category === "audio") return item.type === "audio";
        if (category === "solids") return false;
        return false;
      })
      .map<GridEntry>((item) => ({
        key: `media-${item.id}`,
        name: item.name,
        kind: item.type,
        thumbnailUrl: item.thumbnailUrl ?? item.originalUrl ?? null,
        onActivate:
          item.type === "image" ||
          item.type === "video" ||
          item.type === "audio"
            ? () => addMediaAsLayer(item)
            : undefined,
      }));

    return [...sceneEntries, ...mediaEntries];
  }, [
    query,
    category,
    composition.assets,
    mediaItems,
    compositions,
    setActiveCompositionId,
    sceneAssetsOnly,
    addExistingAssetAsLayer,
    addMediaAsLayer,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col p-[18px_16px]">
      <div className="mb-[14px] flex items-center justify-between">
        <span className="text-[18px] font-bold text-fg">{t("Assets")}</span>
        <div className="flex items-center gap-1">
          <ToolcraftFileDropControl
            accept="image/*,video/*,audio/*"
            label={isImportingMedia ? t("Importing…") : t("Import Media")}
            icon={<Upload size={14} aria-hidden />}
            onChange={handleMediaInputChange}
            variant="button"
            disabled={isImportingMedia}
          />
          <ToolcraftFileDropControl
            accept=".svg,image/svg+xml"
            label={t("Import SVG")}
            icon={<FileCode2 size={14} aria-hidden />}
            onChange={handleSvgInputChange}
            variant="button"
          />
          <ToolcraftFileDropControl
            accept=".json,.lottie,application/json"
            label={t("Import Lottie")}
            icon={<FileJson size={14} aria-hidden />}
            onChange={handleLottieInputChange}
            variant="button"
          />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <ToolcraftTextInputControl
          value={query}
          onChange={setQuery}
          placeholder={t("Search assets...")}
          ariaLabel={t("Search assets")}
          leading={<Search size={15} aria-hidden />}
          className="flex-1"
          inputClassName="h-10 rounded-[9px] bg-bg"
        />
        <button
          type="button"
          aria-label={t("Show scene assets only")}
          aria-pressed={sceneAssetsOnly}
          title={t("Show scene assets only")}
          onClick={() => setSceneAssetsOnly((value) => !value)}
          className={`flex w-[42px] items-center justify-center rounded-[9px] border transition-colors ${
            sceneAssetsOnly
              ? "border-accent bg-accent-soft text-accent"
              : "border-border bg-bg text-fg-3 hover:text-fg"
          }`}
        >
          <Filter size={16} aria-hidden />
        </button>
      </div>

      <div className="mb-4 flex gap-[18px] overflow-x-auto border-b border-border">
        {CATEGORY_TABS.map((tab) => {
          const isActive = tab.id === category;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={
                isActive
                  ? "shrink-0 border-b-2 border-accent pb-[9px] text-[13px] font-semibold text-fg"
                  : "shrink-0 pb-[9px] text-[13px] font-medium text-fg-muted"
              }
            >
              {t(tab.label)}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mb-2.5 flex items-center justify-between text-[12px] font-semibold text-fg-3">
          <span>{sceneAssetsOnly ? "Scene Assets" : "Available Assets"}</span>
          <span className="font-mono text-[10px] font-medium text-fg-muted">
            {gridEntries.length}
          </span>
        </div>
        {gridEntries.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {gridEntries.map((entry) => (
              <ThumbnailCell key={entry.key} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-bg-1 px-3 py-6 text-center text-[11px] text-fg-muted">
            {sceneAssetsOnly
              ? "No reusable assets in this scene yet."
              : "No assets match this search or category."}
          </div>
        )}

        <div className="mb-2.5 mt-4 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-fg-3">
            {t("Compositions")}</span>
          <button
            type="button"
            aria-label={t("Create motion scene")}
            onClick={() => void createMotionComposition("Motion Scene")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[#a0a0a5] transition-colors hover:bg-bg hover:text-accent"
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>

        {compositions.map((comp) => {
          const isActive = comp.id === composition.id;
          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => setActiveCompositionId(comp.id)}
              className={
                isActive
                  ? "mb-2 flex w-full items-center gap-2.5 rounded-lg bg-track-bg p-2 text-left"
                  : "mb-2 flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-track-bg"
              }
            >
              <span className="flex h-6 w-[30px] shrink-0 items-center justify-center rounded-[5px] bg-bg-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c7c82" strokeWidth="1.8">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] font-semibold text-fg">
                  {comp.name}
                </span>
                <span className="text-[11px] font-medium text-fg-muted">
                  {comp.width}×{comp.height} · {comp.frameRate}{t("fps")}</span>
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--fg-muted)"
                strokeWidth="2"
                className="shrink-0"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThumbnailCell({ entry }: { entry: GridEntry }): JSX.Element {
  return (
    <button
      type="button"
      onClick={entry.onActivate}
      disabled={!entry.onActivate}
      title={entry.onActivate ? `Add ${entry.name} to the scene` : entry.name}
      className="group flex flex-col text-left disabled:cursor-default"
    >
      <span className="block h-[70px] overflow-hidden rounded-lg border border-border bg-bg-2">
        {entry.thumbnailUrl ? (
          <img
            src={entry.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-fg-muted">
            <ThumbnailIcon kind={entry.kind} />
          </span>
        )}
      </span>
      <span className="mt-1.5 truncate text-[12px] font-medium text-fg-2">
        {entry.name}
      </span>
    </button>
  );
}

function ThumbnailIcon({ kind }: { kind: GridEntry["kind"] }): JSX.Element {
  if (kind === "video") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "audio") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="8" cy="8" r="4" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
      <path d="M14 4h6v6" />
    </svg>
  );
}
