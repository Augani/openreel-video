import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { Slider } from '@openreel/ui';
import { useProjectStore } from '../../../stores/project-store';
import type { ImageLayer } from '../../../types/project';
import {
  getBackgroundRemovalService,
  BackgroundMode,
  DEFAULT_OPTIONS,
} from '../../../services/background-removal-service';

interface Props {
  layer: ImageLayer;
}

export function BackgroundRemovalSection({ layer }: Props) {
  const { project, addAsset, updateLayer } = useProjectStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<BackgroundMode>('transparent');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_OPTIONS.backgroundColor!);
  const [blurAmount, setBlurAmount] = useState(DEFAULT_OPTIONS.blurAmount!);

  const asset = project?.assets[layer.sourceId];

  const handleRemoveBackground = async () => {
    if (!asset?.dataUrl && !asset?.thumbnailUrl) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const service = getBackgroundRemovalService();
      const imageUrl = asset.dataUrl || asset.thumbnailUrl;

      const resultDataUrl = await service.removeBackground(
        imageUrl,
        {
          mode,
          backgroundColor,
          blurAmount,
        },
        setProgress
      );

      const newAssetId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      addAsset({
        id: newAssetId,
        name: `${asset.name} (no bg)`,
        type: 'image',
        mimeType: 'image/png',
        size: 0,
        width: asset.width,
        height: asset.height,
        thumbnailUrl: resultDataUrl,
        dataUrl: resultDataUrl,
      });

      updateLayer<ImageLayer>(layer.id, { sourceId: newAssetId });
    } catch (error) {
      console.error('Background removal failed:', error);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Background Removal
      </h4>

      <div className="p-3 space-y-4 bg-secondary/50 rounded-lg">
        <div className="space-y-2">
          <label className="text-[10px] text-muted-foreground">Mode</label>
          <div className="grid grid-cols-3 gap-1">
            {(['transparent', 'color', 'blur'] as BackgroundMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1.5 text-[10px] font-medium rounded transition-colors ${
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {mode === 'color' && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground">Background</label>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className="w-8 h-8 rounded border border-input cursor-pointer"
            />
            <input
              type="text"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-background border border-input rounded-md font-mono"
            />
          </div>
        )}

        {mode === 'blur' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] text-muted-foreground">Blur Amount</label>
              <span className="text-[10px] text-muted-foreground">{blurAmount}px</span>
            </div>
            <Slider
              value={[blurAmount]}
              onValueChange={([v]) => setBlurAmount(v)}
              min={5}
              max={30}
              step={1}
            />
          </div>
        )}

        {isProcessing && (
          <div className="space-y-1.5">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              {progress < 15 ? 'Loading AI model...' :
               progress < 90 ? 'Analyzing image...' :
               'Finalizing...'}
              {' '}{Math.round(progress)}%
            </p>
          </div>
        )}

        <button
          onClick={handleRemoveBackground}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Wand2 size={16} />
              Remove Background
            </>
          )}
        </button>

        <p className="text-[9px] text-muted-foreground text-center">
          AI-powered background removal for any image
        </p>
      </div>
    </div>
  );
}
