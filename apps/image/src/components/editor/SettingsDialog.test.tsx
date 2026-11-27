import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { initLanguage, languageStore } from '@openreel/i18n';
import { SettingsDialog } from './SettingsDialog';

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ['en-US'] });
});

it('offers the three language choices and switches to Chinese', async () => {
  initLanguage({ storage: localStorage, systemLanguages: ['en-US'] });
  render(<SettingsDialog isOpen onClose={() => {}} />);
  fireEvent.click(screen.getByText('Language'));
  fireEvent.click(screen.getByText('简体中文'));
  expect(languageStore.getPreference()).toBe('zh-CN');
});
