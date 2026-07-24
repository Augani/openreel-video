import React, { useState, useCallback } from "react";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Star, StarOff, ChevronDown } from "@/icons/lucide-compat";
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
      <Text type="supporting" color="secondary" className="text-[10px] font-medium">
        Model
      </Text>

      {favoriteModels.length > 0 && (
        <div className="space-y-1.5">
          <Text
            type="supporting"
            color="secondary"
            className="flex items-center gap-1 text-[9px]"
          >
            <Star size={9} className="text-amber-400 fill-amber-400" /> Favorite
            Models
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {favoriteModels.map((fav) => (
              <ClickableCard
                key={fav.modelId}
                label={`Select ${fav.name}`}
                onClick={() => setElevenLabsModel(fav.modelId)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                  elevenLabsModel === fav.modelId
                    ? "bg-primary text-white font-medium"
                    : "bg-bg-2 text-fg-2 hover:text-fg border border-border"
                }`}
              >
                <Star size={8} className="text-amber-400 fill-amber-400" />
                <Text type="supporting" className="text-[10px]">
                  {fav.name}
                </Text>
              </ClickableCard>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <ClickableCard
          label="Toggle model list"
          className="flex-1 h-8 px-2 rounded-lg border border-border bg-bg-2 text-[10px] text-fg flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => setShowAllModels(!showAllModels)}
        >
          <Text type="supporting" color="primary" className="truncate text-[10px]">
            {isLoadingModels ? "Loading models..." : getSelectedModelName()}
          </Text>
          <ChevronDown
            size={12}
            className={`shrink-0 text-fg-3 transition-transform ${
              showAllModels ? "rotate-180" : ""
            }`}
          />
        </ClickableCard>
      </div>

      {showAllModels && (
        <Card variant="muted" padding={0} className="overflow-hidden border border-border">
          <div className="max-h-48 overflow-y-auto">
            {allModels.length === 0 ? (
              <Text type="supporting" color="secondary" className="block p-3 text-center text-[10px]">
                {isLoadingModels ? "Loading models..." : "No models available"}
              </Text>
            ) : (
              allModels.map((model) => {
                const isSelected = elevenLabsModel === model.model_id;
                const isFav = isFavoriteModel(model.model_id);
                const langCount = model.languages?.length ?? 0;

                return (
                  <ClickableCard
                    key={model.model_id}
                    label={`Select ${model.name}`}
                    className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-bg-2 border-l-2 border-transparent"
                    }`}
                    onClick={() => {
                      setElevenLabsModel(model.model_id);
                      setShowAllModels(false);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Text type="supporting" color="primary" className="text-[10px] font-medium truncate">
                          {model.name}
                        </Text>
                      </div>
                      <Text type="supporting" color="secondary" className="truncate text-[8px]">
                        {model.description
                          ? model.description.length > 80
                            ? model.description.slice(0, 80) + "..."
                            : model.description
                          : ""}
                        {langCount > 0 && ` · ${langCount} languages`}
                      </Text>
                    </div>

                    <IconButton
                      label={isFav ? "Remove from favorites" : "Add to favorites"}
                      icon={
                        isFav ? (
                          <Star size={10} className="fill-current" />
                        ) : (
                          <StarOff size={10} />
                        )
                      }
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteModel(model);
                      }}
                      className={`p-1 rounded hover:bg-bg-elev transition-colors shrink-0 ${
                        isFav
                          ? "text-amber-400"
                          : "text-fg-3 hover:text-amber-400"
                      }`}
                    />
                  </ClickableCard>
                );
              })
            )}
          </div>

          <Text
            type="supporting"
            color="secondary"
            className="block border-t border-border bg-bg-1 px-2 py-1 text-center text-[8px]"
          >
            {allModels.length} models available
          </Text>
        </Card>
      )}
    </div>
  );
};
