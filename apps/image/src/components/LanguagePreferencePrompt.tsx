import { useEffect, useState } from 'react';
import { Languages, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  IMAGE_LANGUAGE_CHOICE_STORAGE_KEY,
  IMAGE_LANGUAGE_PROMPT_STORAGE_PREFIX,
  IMAGE_LANGUAGE_STORAGE_KEY,
  LANGUAGE_LABELS,
  getPreferredSupportedLanguage,
  hasExplicitLanguageChoice,
  markLanguageChoiceMade,
  type SupportedLanguage,
} from '../i18n';

export function LanguagePreferencePrompt() {
  const { t, i18n } = useTranslation();
  const [suggestedLanguage, setSuggestedLanguage] = useState<SupportedLanguage | null>(null);

  useEffect(() => {
    const preferred = getPreferredSupportedLanguage();
    const current = i18n.language === 'zh-CN' ? 'zh-CN' : 'en';
    if (!preferred || preferred === current) return;

    const dismissedKey = `${IMAGE_LANGUAGE_PROMPT_STORAGE_PREFIX}:${preferred}`;
    if (!hasExplicitLanguageChoice()) {
      window.localStorage.setItem(IMAGE_LANGUAGE_STORAGE_KEY, preferred);
      window.localStorage.setItem(IMAGE_LANGUAGE_CHOICE_STORAGE_KEY, 'true');
      void i18n.changeLanguage(preferred);
      return;
    }

    if (window.localStorage.getItem(dismissedKey) === 'true') return;
    setSuggestedLanguage(preferred);
  }, [i18n]);

  if (!suggestedLanguage) return null;

  const dismiss = () => {
    window.localStorage.setItem(`${IMAGE_LANGUAGE_PROMPT_STORAGE_PREFIX}:${suggestedLanguage}`, 'true');
    setSuggestedLanguage(null);
  };

  const accept = () => {
    window.localStorage.setItem(IMAGE_LANGUAGE_STORAGE_KEY, suggestedLanguage);
    markLanguageChoiceMade();
    void i18n.changeLanguage(suggestedLanguage);
    setSuggestedLanguage(null);
  };

  return (
    <div className="fixed left-1/2 top-4 z-[10000] -translate-x-1/2 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <Languages size={18} className="text-primary" />
        <p className="text-sm text-foreground">
          {t('common:languagePrompt.message', {
            language: LANGUAGE_LABELS[suggestedLanguage],
          })}
        </p>
        <button
          onClick={accept}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('common:languagePrompt.switch')}
        </button>
        <button
          onClick={dismiss}
          className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t('common:languagePrompt.dismiss')}
        </button>
        <button
          onClick={dismiss}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t('common:buttons.close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
