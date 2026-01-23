import { useState, useMemo, useEffect } from 'react';
import { Download, FileImage, Loader2, Link2, Link2Off, Printer, Instagram, Youtube, Twitter, Linkedin, Facebook, Image } from 'lucide-react';
import { Dialog, DialogFooter } from '../ui/Dialog';
import { useProjectStore } from '../../stores/project-store';
import { useUIStore } from '../../stores/ui-store';
import {
  exportProject,
  downloadBlob,
  getExportFilename,
  type ExportFormat,
  type ExportQuality,
  type ExportOptions,
} from '../../services/export-service';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type FormatInfo = {
  id: ExportFormat;
  name: string;
  description: string;
  supportsTransparency: boolean;
  supportsQuality: boolean;
};

const FORMATS: FormatInfo[] = [
  { id: 'png', name: 'PNG', description: 'Lossless, best for graphics', supportsTransparency: true, supportsQuality: false },
  { id: 'jpg', name: 'JPG', description: 'Smaller size, photos', supportsTransparency: false, supportsQuality: true },
  { id: 'webp', name: 'WebP', description: 'Modern, best compression', supportsTransparency: true, supportsQuality: true },
];

const QUALITY_PRESETS: { id: ExportQuality; name: string; value: number }[] = [
  { id: 'low', name: 'Low', value: 60 },
  { id: 'medium', name: 'Medium', value: 80 },
  { id: 'high', name: 'High', value: 92 },
  { id: 'max', name: 'Maximum', value: 100 },
];

const SCALE_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
  { value: 4, label: '4x' },
];

const DPI_OPTIONS = [
  { value: 72, label: '72 DPI', description: 'Screen' },
  { value: 150, label: '150 DPI', description: 'Web print' },
  { value: 300, label: '300 DPI', description: 'Print' },
  { value: 600, label: '600 DPI', description: 'High quality' },
];

type PlatformPreset = {
  id: string;
  name: string;
  icon: React.ElementType;
  format: ExportFormat;
  quality: ExportQuality;
  maxFileSize?: string;
  recommendedSize?: { width: number; height: number };
  description: string;
};

const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'instagram-post',
    name: 'Instagram Post',
    icon: Instagram,
    format: 'jpg',
    quality: 'high',
    recommendedSize: { width: 1080, height: 1080 },
    description: 'Square post, max 30MB',
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    icon: Instagram,
    format: 'jpg',
    quality: 'high',
    recommendedSize: { width: 1080, height: 1920 },
    description: '9:16 vertical',
  },
  {
    id: 'youtube-thumbnail',
    name: 'YouTube Thumbnail',
    icon: Youtube,
    format: 'jpg',
    quality: 'high',
    maxFileSize: '2MB',
    recommendedSize: { width: 1280, height: 720 },
    description: '16:9, under 2MB',
  },
  {
    id: 'twitter-post',
    name: 'Twitter/X Post',
    icon: Twitter,
    format: 'png',
    quality: 'high',
    recommendedSize: { width: 1200, height: 675 },
    description: '16:9 landscape',
  },
  {
    id: 'facebook-post',
    name: 'Facebook Post',
    icon: Facebook,
    format: 'jpg',
    quality: 'high',
    recommendedSize: { width: 1200, height: 630 },
    description: '1.91:1 ratio',
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    icon: Linkedin,
    format: 'png',
    quality: 'high',
    recommendedSize: { width: 1200, height: 627 },
    description: 'Professional feed',
  },
  {
    id: 'web-optimized',
    name: 'Web Optimized',
    icon: Image,
    format: 'webp',
    quality: 'medium',
    description: 'Smallest file size',
  },
  {
    id: 'print-ready',
    name: 'Print Ready',
    icon: Printer,
    format: 'png',
    quality: 'max',
    description: 'Highest quality PNG',
  },
];

type SizeMode = 'scale' | 'custom' | 'dpi';

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { project, selectedArtboardId } = useProjectStore();
  const { showNotification } = useUIStore();

  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [scale, setScale] = useState(1);
  const [sizeMode, setSizeMode] = useState<SizeMode>('scale');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customWidth, setCustomWidth] = useState(0);
  const [customHeight, setCustomHeight] = useState(0);
  const [dpi, setDpi] = useState(72);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [background, setBackground] = useState<'include' | 'transparent'>('include');
  const [exportAll, setExportAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const currentFormat = FORMATS.find((f) => f.id === format)!;
  const artboard = project?.artboards.find((a) => a.id === selectedArtboardId);

  const effectiveScale = useMemo(() => {
    if (!artboard) return 1;
    if (sizeMode === 'scale') return scale;
    if (sizeMode === 'custom' && customWidth > 0) {
      return customWidth / artboard.size.width;
    }
    if (sizeMode === 'dpi') {
      return dpi / 72;
    }
    return 1;
  }, [artboard, sizeMode, scale, customWidth, dpi]);

  const dimensions = useMemo(() => {
    if (!artboard) return null;
    if (sizeMode === 'custom') {
      return { width: customWidth || artboard.size.width, height: customHeight || artboard.size.height };
    }
    return {
      width: Math.round(artboard.size.width * effectiveScale),
      height: Math.round(artboard.size.height * effectiveScale),
    };
  }, [artboard, sizeMode, effectiveScale, customWidth, customHeight]);

  useEffect(() => {
    if (artboard) {
      setCustomWidth(artboard.size.width);
      setCustomHeight(artboard.size.height);
    }
  }, [artboard?.id]);

  const handleCustomWidthChange = (newWidth: number) => {
    setCustomWidth(newWidth);
    if (lockAspectRatio && artboard && newWidth > 0) {
      const aspectRatio = artboard.size.width / artboard.size.height;
      setCustomHeight(Math.round(newWidth / aspectRatio));
    }
  };

  const handleCustomHeightChange = (newHeight: number) => {
    setCustomHeight(newHeight);
    if (lockAspectRatio && artboard && newHeight > 0) {
      const aspectRatio = artboard.size.width / artboard.size.height;
      setCustomWidth(Math.round(newHeight * aspectRatio));
    }
  };

  const handlePresetSelect = (preset: PlatformPreset) => {
    setSelectedPreset(preset.id);
    setFormat(preset.format);
    setQuality(preset.quality);

    if (preset.recommendedSize && artboard) {
      const artboardRatio = artboard.size.width / artboard.size.height;
      const presetRatio = preset.recommendedSize.width / preset.recommendedSize.height;
      const ratioMatch = Math.abs(artboardRatio - presetRatio) < 0.1;

      if (ratioMatch) {
        const targetScale = preset.recommendedSize.width / artboard.size.width;
        if (targetScale <= 4 && targetScale >= 0.5) {
          setScale(targetScale);
          setSizeMode('scale');
        } else {
          setSizeMode('custom');
          setCustomWidth(preset.recommendedSize.width);
          setCustomHeight(preset.recommendedSize.height);
          setLockAspectRatio(false);
        }
      }
    }
  };

  const clearPreset = () => {
    setSelectedPreset(null);
  };

  const printDimensions = useMemo(() => {
    if (!dimensions) return null;
    const inches = {
      width: (dimensions.width / dpi).toFixed(2),
      height: (dimensions.height / dpi).toFixed(2),
    };
    const cm = {
      width: ((dimensions.width / dpi) * 2.54).toFixed(2),
      height: ((dimensions.height / dpi) * 2.54).toFixed(2),
    };
    return { inches, cm };
  }, [dimensions, dpi]);

  const estimatedSize = useMemo(() => {
    if (!dimensions) return null;
    const pixels = dimensions.width * dimensions.height;
    const bytesPerPixel = format === 'png' ? 3 : format === 'jpg' ? 0.5 : 0.4;
    const qualityMultiplier = QUALITY_PRESETS.find((q) => q.id === quality)?.value ?? 80;
    const estimated = pixels * bytesPerPixel * (qualityMultiplier / 100);

    if (estimated > 1024 * 1024) {
      return `~${(estimated / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `~${Math.round(estimated / 1024)} KB`;
  }, [dimensions, format, quality]);

  const handleExport = async () => {
    if (!project) return;

    setIsExporting(true);
    setProgress(0);

    try {
      const options: ExportOptions = {
        format,
        quality,
        scale: effectiveScale,
        background: currentFormat.supportsTransparency ? background : 'include',
        artboardIds: exportAll ? undefined : selectedArtboardId ? [selectedArtboardId] : undefined,
      };

      const blobs = await exportProject(project, options, (p, msg) => {
        setProgress(p);
        setProgressMessage(msg);
      });

      const artboards = exportAll
        ? project.artboards
        : project.artboards.filter((a) => a.id === selectedArtboardId);

      blobs.forEach((blob, index) => {
        const artboardName = artboards[index]?.name ?? `artboard-${index + 1}`;
        const filename = getExportFilename(project.name, artboardName, format);
        downloadBlob(blob, filename);
      });

      showNotification('success', `Exported ${blobs.length} artboard${blobs.length > 1 ? 's' : ''}`);
      onClose();
    } catch (error) {
      showNotification('error', 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  if (!project || !artboard) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export Image"
      description="Choose format and quality settings"
      maxWidth="md"
    >
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Quick Presets
            </label>
            {selectedPreset && (
              <button
                onClick={clearPreset}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PLATFORM_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const isSelected = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset)}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                  }`}
                >
                  <Icon size={16} className={`mx-auto mb-1 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="block text-[10px] font-medium truncate">{preset.name}</span>
                  <span className="block text-[8px] text-muted-foreground truncate">{preset.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Format
          </label>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  format === f.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileImage size={16} className={format === f.id ? 'text-primary' : 'text-muted-foreground'} />
                  <span className="font-medium text-sm">{f.name}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{f.description}</p>
              </button>
            ))}
          </div>
        </div>

        {currentFormat.supportsQuality && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Quality
            </label>
            <div className="grid grid-cols-4 gap-2">
              {QUALITY_PRESETS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setQuality(q.id)}
                  className={`px-3 py-2 rounded-lg border text-center transition-all ${
                    quality === q.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                  }`}
                >
                  <span className="text-sm font-medium">{q.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{q.value}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Size
          </label>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setSizeMode('scale')}
              className={`flex-1 px-3 py-2 rounded-lg border text-center text-sm font-medium transition-all ${
                sizeMode === 'scale'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
              }`}
            >
              Scale
            </button>
            <button
              onClick={() => setSizeMode('custom')}
              className={`flex-1 px-3 py-2 rounded-lg border text-center text-sm font-medium transition-all ${
                sizeMode === 'custom'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
              }`}
            >
              Custom
            </button>
            <button
              onClick={() => setSizeMode('dpi')}
              className={`flex-1 px-3 py-2 rounded-lg border text-center text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                sizeMode === 'dpi'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
              }`}
            >
              <Printer size={14} />
              Print
            </button>
          </div>

          {sizeMode === 'scale' && (
            <div className="flex gap-2">
              {SCALE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScale(s.value)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-center text-sm font-medium transition-all ${
                    scale === s.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {sizeMode === 'custom' && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] text-muted-foreground mb-1">Width (px)</label>
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => handleCustomWidthChange(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  min={1}
                  max={16384}
                />
              </div>
              <button
                onClick={() => setLockAspectRatio(!lockAspectRatio)}
                className={`mt-5 p-2 rounded-lg transition-colors ${
                  lockAspectRatio ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
                title={lockAspectRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {lockAspectRatio ? <Link2 size={16} /> : <Link2Off size={16} />}
              </button>
              <div className="flex-1">
                <label className="block text-[10px] text-muted-foreground mb-1">Height (px)</label>
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => handleCustomHeightChange(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  min={1}
                  max={16384}
                />
              </div>
            </div>
          )}

          {sizeMode === 'dpi' && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {DPI_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDpi(d.value)}
                    className={`px-2 py-2 rounded-lg border text-center transition-all ${
                      dpi === d.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                    }`}
                  >
                    <span className="block text-sm font-medium">{d.value}</span>
                    <span className="block text-[9px] text-muted-foreground">{d.description}</span>
                  </button>
                ))}
              </div>
              {printDimensions && (
                <div className="p-3 bg-secondary/30 rounded-lg text-xs text-muted-foreground">
                  <p>Print size at {dpi} DPI:</p>
                  <p className="font-medium text-foreground mt-1">
                    {printDimensions.inches.width}" × {printDimensions.inches.height}" ({printDimensions.cm.width} × {printDimensions.cm.height} cm)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {currentFormat.supportsTransparency && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Background
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setBackground('include')}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  background === 'include'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                }`}
              >
                Include Background
              </button>
              <button
                onClick={() => setBackground('transparent')}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  background === 'transparent'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/50'
                }`}
              >
                Transparent
              </button>
            </div>
          </div>
        )}

        {project.artboards.length > 1 && (
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={exportAll}
                onChange={(e) => setExportAll(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary/50"
              />
              <span className="text-sm">Export all artboards ({project.artboards.length})</span>
            </label>
          </div>
        )}

        <div className="p-4 bg-secondary/50 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Dimensions</span>
            <span className="font-medium">
              {dimensions?.width} × {dimensions?.height} px
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Estimated size</span>
            <span className="font-medium">{estimatedSize}</span>
          </div>
        </div>

        {isExporting && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{progressMessage}</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <button
          onClick={onClose}
          disabled={isExporting}
          className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isExporting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download size={16} />
              Export
            </>
          )}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
