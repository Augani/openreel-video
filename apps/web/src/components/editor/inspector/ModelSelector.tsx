import React, { useState, useCallback } from "react";
import { Star, StarOff, ChevronDown } from "lucide-react";
import { useSettingsStore } from "../../../stores/settings-store";
import type { ElevenLabsModel } from "./tts-types";

interface ModelSelectorProps {
  allModels: ElevenLabsModel[];
  isLoadingModels: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  allModels,
  isLoadingModels,
}) => {
  const {
    elevenLabsModel,
    setElevenLabsModel,
    favoriteModels,
    addFavoriteModel,
    removeFavoriteModel,
  } = useSettingsStore();

  const [showAllModels, setShowAllModels] = useState(false);

  const isFavoriteModel = useCallback(
    (modelId: string) => favoriteModels.some((m) => m.modelId === modelId),
    [favoriteModels],
  );

  const toggleFavoriteModel = useCallback(
    (model: ElevenLabsModel) => {
      if (isFavoriteModel(model.model_id)) {
        removeFavoriteModel(model.model_id);
      } else {
        addFavoriteModel({
          modelId: model.model_id,
          name: model.name,
        });
      }
    },
    [isFavoriteModel, addFavoriteModel, removeFavoriteModel],
  );

  const getSelectedModelName = useCallback((): string => {
    const model = allModels.find((m) => m.model_id === elevenLabsModel);
    if (model) return model.name;
    const favModel = favoriteModels.find((m) => m.modelId === elevenLabsModel);
    if (favModel) return favModel.name;
    return elevenLabsModel;
  }, [elevenLabsModel, allModels, favoriteModels]);

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-medium text-text-secondary">
        Model
      </label>

      {favoriteModels.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[9px] text-text-muted flex items-center gap-1">
            <Star size={9} className="text-amber-400 fill-amber-400" /> Favorite Models
          </span>
          <div className="flex flex-wrap gap-1.5">
            {favoriteModels.map((fav) => (
              <button
                key={fav.modelId}
                onClick={() => setElevenLabsModel(fav.modelId)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                  elevenLabsModel === fav.modelId
                    ? "bg-primary text-white font-medium"
                    : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                }`}
              >
                <Star size={8} className="text-amber-400 fill-amber-400" />
                <span>{fav.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div
          className="flex-1 h-8 px-2 rounded-lg border border-border bg-background-tertiary text-[10px] text-text-primary flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setShowAllModels(!showAllModels)}
        >
          <span className="truncate">
            {isLoadingModels ? "Loading models..." : getSelectedModelName()}
          </span>
          <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${showAllModels ? "rotate-180" : ""}`} />
        </div>
      </div>

      {showAllModels && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {allModels.length === 0 ? (
              <div className="p-3 text-center text-[10px] text-text-muted">
                {isLoadingModels ? "Loading models..." : "No models available"}
              </div>
            ) : (
              allModels.map((model) => {
                const isSelected = elevenLabsModel === model.model_id;
                const isFav = isFavoriteModel(model.model_id);
                const langCount = model.languages?.length ?? 0;

                return (
                  <div
                    key={model.model_id}
                    className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-background-tertiary border-l-2 border-transparent"
                    }`}
                    onClick={() => {
                      setElevenLabsModel(model.model_id);
                      setShowAllModels(false);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-text-primary truncate">
                          {model.name}
                        </span>
                      </div>
                      <div className="text-[8px] text-text-muted truncate">
                        {model.description
                          ? (model.description.length > 80 ? model.description.slice(0, 80) + "..." : model.description)
                          : ""}
                        {langCount > 0 && ` · ${langCount} languages`}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteModel(model);
                      }}
                      className={`p-1 rounded hover:bg-background-elevated transition-colors shrink-0 ${
                        isFav ? "text-amber-400" : "text-text-muted hover:text-amber-400"
                      }`}
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      {isFav ? (
                        <Star size={10} className="fill-current" />
                      ) : (
                        <StarOff size={10} />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-2 py-1 border-t border-border bg-background-secondary text-[8px] text-text-muted text-center">
            {allModels.length} models available
          </div>
        </div>
      )}
    </div>
  );
};
