/* UI texts (German). All guest-facing copy lives here so it is easy to adjust. */
(function () {
  const STRINGS = {
    de: {
      'home.eyebrow': 'Willkommen in unserer',
      'home.title': 'FotoBox',
      'home.subtitle': 'Haltet einen Moment für das Brautpaar fest',
      'home.photo': 'Foto',
      'home.photoHint': 'Vier Bilder – der Countdown startet sofort',
      'home.video': 'Video',
      'home.videoHint': 'Eine 15-Sekunden-Botschaft ans Brautpaar',
      'home.tapToStart': 'Zum Auswählen tippen',
      'common.back': 'Zurück',
      'common.start': "Los geht's",
      'common.startingCamera': 'Kamera wird gestartet…',
      'photo.getReady': 'Stellt euch auf – gleich geht’s los!',
      'photo.oneMore': 'Wunderschön! Noch eins…',
      'photo.smile': 'Lächeln!',
      'photo.shotOf': 'Foto {n} von {total}',
      'review.title': 'Welche möchtet ihr behalten?',
      'review.hint': 'Tippt auf ein Foto, um es aus- oder abzuwählen',
      'review.retake': 'Nochmal',
      'review.saveNone': 'Keines speichern',
      'review.saveBoth': 'Beide speichern',
      'review.saveAll': 'Alle speichern',
      'review.saveOne': 'Dieses speichern',
      'review.saveSelected': '{n} Fotos speichern',
      'review.selectOne': 'Foto auswählen',
      'review.photoAlt': 'Foto {n}',
      'strip.brand': 'FotoBox',
      'video.ready': 'Nehmt eine {s}-Sekunden-Botschaft auf',
      'video.getReady': 'Stellt euch auf – die Aufnahme startet gleich!',
      'video.record': 'Aufnehmen',
      'video.recording': 'Aufnahme',
      'video.stop': 'Stopp',
      'video.reviewTitle': "Wie war's?",
      'video.reviewHint': 'Anschauen, dann speichern oder nochmal',
      'video.save': 'Video speichern',
      'video.retake': 'Nochmal',
      'video.discard': 'Verwerfen',
      'video.processing': 'Video wird vorbereitet…',
      'saving': 'Wird gespeichert…',
      'saved.thanks': 'Gespeichert! Danke',
      'saved.downloaded': 'Auf diesem Gerät heruntergeladen',
      'saved.fallback': 'Server nicht erreichbar – auf diesem Gerät heruntergeladen',
      'discarded': 'Nichts gespeichert – kommt gerne wieder!',
      'error.camera': 'Die Kamera ist nicht verfügbar. Bitte Berechtigungen prüfen und neu laden.',
      'error.recorder': 'Videoaufnahme wird in diesem Browser nicht unterstützt.',
      'error.save': 'Speichern fehlgeschlagen. Bitte sagt den Gastgebern Bescheid.',
      'fullscreen': 'Vollbild',
    },
  };

  let current = 'de';

  function t(key, vars) {
    const table = STRINGS[current] || STRINGS.de;
    let text = table[key] != null ? table[key] : STRINGS.de[key] != null ? STRINGS.de[key] : key;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), vars[name]);
      });
    }
    return text;
  }

  function applyTranslations(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.documentElement.lang = current;
  }

  function setLang(lang) {
    current = STRINGS[lang] ? lang : 'de';
    applyTranslations();
    document.dispatchEvent(new CustomEvent('fotobox:langchange', { detail: { lang: current } }));
  }

  function getLang() {
    return current;
  }

  function available() {
    return Object.keys(STRINGS);
  }

  window.I18N = { t, setLang, getLang, applyTranslations, available };
})();
