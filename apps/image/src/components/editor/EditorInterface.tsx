import { useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Toolbar } from './toolbar/Toolbar';
import { LeftPanel } from './panels/LeftPanel';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { LayerPanel } from './layers/LayerPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { GuidePanel } from './panels/GuidePanel';
import { PagesBar } from './pages/PagesBar';
import { useUIStore } from '../../stores/ui-store';
import { useProjectStore } from '../../stores/project-store';
import { Layers, History, Ruler } from 'lucide-react';

const ExportDialog = lazy(() => import('./ExportDialog').then(m => ({ default: m.ExportDialog })));

type BottomTab = 'layers' | 'history' | 'guides';

export function EditorInterface() {
  const { t } = useTranslation('editor');
  const { isPanelCollapsed, isInspectorCollapsed, isExportDialogOpen, closeExportDialog } = useUIStore();
  const { project } = useProjectStore();
  const [bottomTab, setBottomTab] = useState<BottomTab>('layers');

  if (!project) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <p className="text-muted-foreground">{t('editorInterface.noProjectLoaded')}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        {!isPanelCollapsed && (
          <div className="w-72 border-r border-border flex flex-col bg-card">
            <LeftPanel />
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            <Canvas />
          </div>
          <PagesBar />
        </div>

        {!isInspectorCollapsed && (
          <div className="w-72 border-l border-border flex flex-col bg-card">
            <div className="flex-1 overflow-y-auto">
              <Inspector />
            </div>
            <div className="h-64 border-t border-border flex flex-col">
              <div className="flex border-b border-border">
                <button
                  onClick={() => setBottomTab('layers')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    bottomTab === 'layers'
                      ? 'text-foreground bg-background border-b-2 border-primary -mb-px'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Layers size={14} />
                  {t('editorInterface.tabs.layers')}
                </button>
                <button
                  onClick={() => setBottomTab('guides')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    bottomTab === 'guides'
                      ? 'text-foreground bg-background border-b-2 border-primary -mb-px'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Ruler size={14} />
                  {t('editorInterface.tabs.guides')}
                </button>
                <button
                  onClick={() => setBottomTab('history')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    bottomTab === 'history'
                      ? 'text-foreground bg-background border-b-2 border-primary -mb-px'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <History size={14} />
                  {t('editorInterface.tabs.history')}
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {bottomTab === 'layers' && <LayerPanel />}
                {bottomTab === 'guides' && <GuidePanel />}
                {bottomTab === 'history' && <HistoryPanel />}
              </div>
            </div>
          </div>
        )}
      </div>

      {isExportDialogOpen && (
        <Suspense fallback={null}>
          <ExportDialog open={isExportDialogOpen} onClose={closeExportDialog} />
        </Suspense>
      )}
    </div>
  );
}
