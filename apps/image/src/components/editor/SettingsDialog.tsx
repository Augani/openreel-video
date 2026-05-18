import { useState, type ReactNode } from 'react';
import { X, Settings, Grid3X3, MousePointer, Save, Palette, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/ui-store';
import { Slider } from '@openreel/ui';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'canvas' | 'snapping' | 'appearance';

export function SettingsDialog({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('canvas');
  const { t } = useTranslation();

  const {
    showGrid,
    showGuides,
    showRulers,
    snapToGrid,
    snapToGuides,
    snapToObjects,
    gridSize,
    toggleGrid,
    toggleGuides,
    toggleRulers,
    toggleSnapToGrid,
    toggleSnapToGuides,
    toggleSnapToObjects,
    setGridSize,
  } = useUIStore();

  if (!isOpen) return null;

  const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
    { id: 'canvas', label: t('settings:tabs.canvas'), icon: <Grid3X3 size={16} /> },
    { id: 'snapping', label: t('settings:tabs.snapping'), icon: <MousePointer size={16} /> },
    { id: 'appearance', label: t('settings:tabs.appearance'), icon: <Palette size={16} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Settings size={20} className="text-primary" />
            <h2 className="text-lg font-semibold">{t('settings:dialog.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex">
          <div className="w-40 border-r border-border p-2 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/20 text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 p-6 min-h-[300px]">
            {activeTab === 'canvas' && (
              <div className="space-y-6">
                <h3 className="text-sm font-medium text-foreground mb-4">{t('settings:canvas.title')}</h3>

                <div className="space-y-4">
                  <ToggleOption
                    label={t('settings:canvas.showGrid')}
                    description={t('settings:canvas.showGridDescription')}
                    checked={showGrid}
                    onChange={toggleGrid}
                  />

                  <ToggleOption
                    label={t('settings:canvas.showGuides')}
                    description={t('settings:canvas.showGuidesDescription')}
                    checked={showGuides}
                    onChange={toggleGuides}
                  />

                  <ToggleOption
                    label={t('settings:canvas.showRulers')}
                    description={t('settings:canvas.showRulersDescription')}
                    checked={showRulers}
                    onChange={toggleRulers}
                  />

                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm text-foreground">{t('settings:canvas.gridSize')}</label>
                      <span className="text-sm text-muted-foreground">{gridSize}px</span>
                    </div>
                    <Slider
                      value={[gridSize]}
                      onValueChange={([value]) => setGridSize(value)}
                      min={5}
                      max={50}
                      step={5}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'snapping' && (
              <div className="space-y-6">
                <h3 className="text-sm font-medium text-foreground mb-4">{t('settings:snapping.title')}</h3>

                <div className="space-y-4">
                  <ToggleOption
                    label={t('settings:snapping.snapToGrid')}
                    description={t('settings:snapping.snapToGridDescription')}
                    checked={snapToGrid}
                    onChange={toggleSnapToGrid}
                  />

                  <ToggleOption
                    label={t('settings:snapping.snapToGuides')}
                    description={t('settings:snapping.snapToGuidesDescription')}
                    checked={snapToGuides}
                    onChange={toggleSnapToGuides}
                  />

                  <ToggleOption
                    label={t('settings:snapping.snapToObjects')}
                    description={t('settings:snapping.snapToObjectsDescription')}
                    checked={snapToObjects}
                    onChange={toggleSnapToObjects}
                  />
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <h3 className="text-sm font-medium text-foreground mb-4">{t('settings:appearance.title')}</h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Monitor size={18} className="text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t('settings:appearance.theme')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings:appearance.themeDescription')}</p>
                      </div>
                    </div>
                    <div className="px-3 py-1.5 text-xs bg-primary/20 text-primary rounded-md">
                      {t('settings:appearance.themeValue')}
                    </div>
                  </div>

                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-3 mb-3">
                      <Save size={18} className="text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t('settings:appearance.autoSave')}</p>
                        <p className="text-xs text-muted-foreground">{t('settings:appearance.autoSaveDescription')}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('settings:appearance.autoSaveSummary')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToggleOptionProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleOption({ label, description, checked, onChange }: ToggleOptionProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-secondary'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
