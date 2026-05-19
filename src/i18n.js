import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import de from './locales/de.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import it from './locales/it.json';

i18next
  .use(LanguageDetector)
  .init({
    fallbackLng: 'de',
    debug: false,
    resources: {
      de: { translation: de },
      en: { translation: en },
      fr: { translation: fr },
      it: { translation: it }
    },
    interpolation: {
      escapeValue: false // not needed for react as it escapes by default
    }
  });

/**
 * Utility to translate all elements with data-i18n attribute
 */
export function translatePage() {
  const elements = document.querySelectorAll('[data-i18n], [data-i18n-html]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    const htmlKey = el.getAttribute('data-i18n-html');
    const options = el.getAttribute('data-i18n-options');
    const parsedOptions = options ? JSON.parse(options) : {};
    
    if (htmlKey) {
      el.innerHTML = i18next.t(htmlKey, parsedOptions);
    } else if (key) {
      // Handle attributes (e.g. data-i18n="[placeholder]navigation.searchPlaceholder")
      if (key.startsWith('[')) {
        const match = key.match(/^\[(.+?)\](.+)$/);
        if (match) {
          const attr = match[1];
          const translationKey = match[2];
          el.setAttribute(attr, i18next.t(translationKey, parsedOptions));
        }
      } else {
        el.textContent = i18next.t(key, parsedOptions);
      }
    }
  });
}

export default i18next;
