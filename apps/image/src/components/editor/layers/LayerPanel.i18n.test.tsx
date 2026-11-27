import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initLanguage, LANGUAGE_STORAGE_KEY, languageStore } from '@openreel/i18n';
import { useProjectStore } from '../../../stores/project-store';
import { LayerPanel } from './LayerPanel';

beforeEach(() => {
  initLanguage({ storage: localStorage, systemLanguages: ['en-US'] });
  languageStore.setPreference('zh-CN');
  useProjectStore.getState().createProject('Test', { width: 800, height: 600 });
});

afterEach(() => {
  cleanup();
  useProjectStore.getState().closeProject();
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  initLanguage({ storage: localStorage, systemLanguages: ['en-US'] });
});

it('renders every layer context-menu label in Chinese', async () => {
  const state = useProjectStore.getState();
  const first = state.addTextLayer('Hello');
  const second = state.addTextLayer('World');
  state.selectLayers([first, second]);

  render(<LayerPanel />);
  fireEvent.contextMenu(screen.getByText('Hello'));

  for (const label of [
    '复制',
    '剪切',
    '粘贴',
    '创建副本',
    '编组所选',
    '复制样式',
    '粘贴样式',
    '置于顶层',
    '上移一层',
    '下移一层',
    '置于底层',
    '可见',
    '锁定',
    '删除',
  ]) {
    expect(await screen.findByText(label)).toBeInTheDocument();
  }

  expect(screen.queryByText('Group Selection')).not.toBeInTheDocument();
  expect(screen.queryByText('Visible')).not.toBeInTheDocument();
  expect(screen.queryByText('Locked')).not.toBeInTheDocument();
});
