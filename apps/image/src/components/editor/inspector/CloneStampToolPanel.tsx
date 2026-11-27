import { useUIStore } from '../../../stores/ui-store';
import { Stamp, RotateCcw } from 'lucide-react';
import { useT } from "@openreel/i18n/react";

export function CloneStampToolPanel() {
  const t = useT();
  const { cloneStampSettings, setCloneStampSettings } = useUIStore();

  const resetSettings = () => {
    setCloneStampSettings({
      size: 30,
      hardness: 50,
      opacity: 1,
      flow: 1,
      aligned: true,
      sampleAllLayers: false,
      sourcePoint: null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stamp size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">{t("Clone Stamp")}</h3>
        </div>
        <button
          onClick={resetSettings}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
          title={t("Reset")}
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("Hold Alt/Option and click to set source point, then paint to clone.")}
      </p>

      {cloneStampSettings.sourcePoint && (
        <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded">
          {t("Source: (")}{Math.round(cloneStampSettings.sourcePoint.x)}, {Math.round(cloneStampSettings.sourcePoint.y)})
        </div>
      )}

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{t("Size")}</span>
            <span className="text-xs font-mono text-muted-foreground">{cloneStampSettings.size}px</span>
          </div>
          <input
            type="range"
            min={1}
            max={500}
            value={cloneStampSettings.size}
            onChange={(e) => setCloneStampSettings({ size: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{t("Hardness")}</span>
            <span className="text-xs font-mono text-muted-foreground">{cloneStampSettings.hardness}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cloneStampSettings.hardness}
            onChange={(e) => setCloneStampSettings({ hardness: Number(e.target.value) })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{t("Opacity")}</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(cloneStampSettings.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cloneStampSettings.opacity * 100}
            onChange={(e) => setCloneStampSettings({ opacity: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">{t("Flow")}</span>
            <span className="text-xs font-mono text-muted-foreground">{Math.round(cloneStampSettings.flow * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cloneStampSettings.flow * 100}
            onChange={(e) => setCloneStampSettings({ flow: Number(e.target.value) / 100 })}
            className="w-full h-1.5 appearance-none bg-secondary rounded-full cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={cloneStampSettings.aligned}
              onChange={(e) => setCloneStampSettings({ aligned: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            {t("Aligned")}
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={cloneStampSettings.sampleAllLayers}
              onChange={(e) => setCloneStampSettings({ sampleAllLayers: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-border"
            />
            {t("Sample All Layers")}
          </label>
        </div>
      </div>
    </div>
  );
}
