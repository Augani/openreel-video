import React, { useState, useCallback } from "react";
import { Card } from "@openreel/ui";

import { Button, buttonVariants, cn } from "@openreel/ui";

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
      <span className="text-fg-2 text-[10px] font-medium">
        Model
      </span>

      {favoriteModels.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-fg-2 font-normal flex items-center gap-1 text-[9px]"
          >
            <Star size={9} className="text-amber-400 fill-amber-400" /> Favorite
            Models
          </span>
          <div className="flex flex-wrap gap-1.5">
            {favoriteModels.map((fav) => (
              <Button variant="ghost" key={fav.modelId} onClick={() => setElevenLabsModel(fav.modelId)} type="button" aria-label={`Select ${fav.name}`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                  elevenLabsModel === fav.modelId
                    ? "bg-primary text-white font-medium"
                    : "bg-bg-2 text-fg-2 hover:text-fg border border-border"
                }`)}>
                <Star size={8} className="text-amber-400 fill-amber-400" />
                <span className="text-fg-2 font-normal text-[10px]">
                  {fav.name}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setShowAllModels(!showAllModels)} type="button" aria-label="Toggle model list" className="group/card min-w-0 whitespace-normal text-left duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 hover:bg-bg-2 p-3 flex-1 h-8 px-2 rounded-lg border border-border bg-bg-2 text-[10px] text-fg flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors">
          <span className="text-fg font-normal truncate text-[10px]">
            {isLoadingModels ? "Loading models..." : getSelectedModelName()}
          </span>
          <ChevronDown
            size={12}
            className={`shrink-0 text-fg-3 transition-transform ${
              showAllModels ? "rotate-180" : ""
            }`}
          />
        </Button>
      </div>

      {showAllModels && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-0 overflow-hidden border border-border">
          <div className="max-h-48 overflow-y-auto">
            {allModels.length === 0 ? (
              <span className="text-fg-2 font-normal block p-3 text-center text-[10px]">
                {isLoadingModels ? "Loading models..." : "No models available"}
              </span>
            ) : (
              allModels.map((model) => {
                const isSelected = elevenLabsModel === model.model_id;
                const isFav = isFavoriteModel(model.model_id);
                const langCount = model.languages?.length ?? 0;

                return (
                  <Card key={model.model_id} className={cn("shadow-none", buttonVariants({ variant: "ghost" }), cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-bg-2 border-l-2 border-transparent"
                    }`), "relative w-fit max-w-full")}>
                  <Button variant="ghost" type="button" aria-label={`Select ${model.name}`} onClick={() => { setElevenLabsModel(model.model_id); setShowAllModels(false); }} className="absolute -inset-y-px -left-0.5 -right-px h-[calc(100%+2px)] w-[calc(100%+3px)] rounded-[inherit] bg-transparent p-0 hover:bg-transparent" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-fg text-[10px] font-medium truncate">
                          {model.name}
                        </span>
                      </div>
                      <span className="text-fg-2 font-normal truncate text-[8px]">
                        {model.description
                          ? model.description.length > 80
                            ? model.description.slice(0, 80) + "..."
                            : model.description
                          : ""}
                        {langCount > 0 && ` · ${langCount} languages`}
                      </span>
                    </div>

                    <Button variant="ghost" size="icon-sm" onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteModel(model);
                      }} type="button" aria-label={isFav ? "Remove from favorites" : "Add to favorites"} title={isFav ? "Remove from favorites" : "Add to favorites"} className={cn("relative z-10 inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", `p-1 rounded hover:bg-bg-elev transition-colors shrink-0 ${
                        isFav
                          ? "text-amber-400"
                          : "text-fg-3 hover:text-amber-400"
                      }`)}>
                      {isFav ? (
                          <Star size={10} className="fill-current" />
                        ) : (
                          <StarOff size={10} />
                        )}
                    </Button>
                  </Card>
                );
              })
            )}
          </div>

          <span className="text-fg-2 font-normal block border-t border-border bg-bg-1 px-2 py-1 text-center text-[8px]"
          >
            {allModels.length} models available
          </span>
        </Card>
      )}
    </div>
  );
};
