export const translations = {
  de: {
    editor: {
      placeholder: 'Beginne hier zu schreiben…',
      guest: 'Gast',
      uploadError: 'Fehler beim Hochladen des Bildes: ',
      toolbar: {
        bold: 'Fett (Ctrl+B)',
        italic: 'Kursiv (Ctrl+I)',
        strike: 'Durchgestrichen (Ctrl+Shift+X)',
        code: 'Code (Ctrl+E)',
        h1: 'Überschrift 1 (Ctrl+Alt+1)',
        h2: 'Überschrift 2 (Ctrl+Alt+2)',
        h3: 'Überschrift 3 (Ctrl+Alt+3)',
        bulletList: 'Aufzählung (Ctrl+Shift+8)',
        orderedList: 'Nummerierung (Ctrl+Shift+7)',
        taskList: 'Aufgabenliste (Ctrl+Shift+9)',
        blockquote: 'Zitat (Ctrl+Shift+B)',
        codeBlock: 'Code-Block (Ctrl+Alt+C)',
        horizontalRule: 'Trennlinie (Ctrl+Enter)',
        link: 'Link (Ctrl+K)',
        image: 'Bild',
        voice: 'Spracheingabe (Diktat)',
        comment: 'Kommentar hinzufügen'
      }
    }
  }
};

let currentLang = 'de';

export function t(key) {
  return key.split('.').reduce((obj, k) => (obj || {})[k], translations[currentLang]) || key;
}
