import { useEffect } from 'react';
import { useUIStore } from './stores/ui-store';
import { WelcomeScreen } from './components/welcome/WelcomeScreen';
import { EditorInterface } from './components/editor/EditorInterface';
import { KeyboardShortcutsPanel } from './components/editor/KeyboardShortcutsPanel';
import { SettingsDialog } from './components/editor/SettingsDialog';
import { useKeyboardShortcuts } from './services/keyboard-service';
import { useAutoSave } from './hooks/useAutoSave';

export default function App() {
  const { currentView, setCurrentView, showShortcutsPanel, toggleShortcutsPanel, showSettingsDialog, closeSettingsDialog } = useUIStore();

  useKeyboardShortcuts();
  useAutoSave();

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentView === 'editor') {
        setCurrentView('welcome');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentView, setCurrentView]);

  return (
    <div className="h-full w-full bg-background">
      {currentView === 'welcome' && <WelcomeScreen />}
      {currentView === 'editor' && <EditorInterface />}
      <KeyboardShortcutsPanel isOpen={showShortcutsPanel} onClose={toggleShortcutsPanel} />
      <SettingsDialog isOpen={showSettingsDialog} onClose={closeSettingsDialog} />
    </div>
  );
}
