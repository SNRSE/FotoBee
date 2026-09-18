/* Translations – English and German. Add more languages by extending this object. */
(function () {
  const STRINGS = {
    en: {
      'home.eyebrow': 'Welcome to our',
      'home.title': 'FotoBox',
      'home.subtitle': 'Capture a moment for the newlyweds',
      'home.photo': 'Photo',
      'home.photoHint': 'Two pictures with a 3-2-1 countdown',
      'home.video': 'Video',
      'home.videoHint': 'A 15 second message for the couple',
      'home.tapToStart': 'Tap to choose',
      'common.back': 'Back',
      'common.start': 'Start',
      'common.startingCamera': 'Starting the camera…',
      'photo.getReady': 'Get in position and smile!',
      'photo.oneMore': 'Beautiful! One more…',
      'photo.smile': 'Smile!',
      'photo.shotOf': 'Photo {n} of {total}',
      'review.title': 'Which ones would you like to keep?',
      'review.hint': 'Tap a photo to select or deselect it',
      'review.retake': 'Retake',
      'review.saveNone': 'Save none',
      'review.saveBoth': 'Save both',
      'review.saveAll': 'Save all',
      'review.saveOne': 'Save this one',
      'review.saveSelected': 'Save {n} photos',
      'review.selectOne': 'Select a photo',
      'video.ready': 'Record a {s} second message',
      'video.record': 'Record',
      'video.recording': 'Recording',
      'video.stop': 'Stop',
      'video.reviewTitle': 'How was that?',
      'video.reviewHint': 'Watch it back, then save or retake',
      'video.save': 'Save video',
      'video.retake': 'Retake',
      'video.discard': 'Discard',
      'video.processing': 'Preparing your video…',
      'saving': 'Saving…',
      'saved.thanks': 'Saved! Thank you',
      'saved.downloaded': 'Downloaded to this device',
      'discarded': 'Nothing saved – come back anytime!',
      'error.camera': 'The camera is not available. Please check permissions and reload.',
      'error.recorder': 'Video recording is not supported in this browser.',
      'error.save': 'Saving failed. Please tell the hosts.',
      'lang.switch': 'Deutsch',
      'fullscreen': 'Fullscreen',
    },
    de: {
      'home.eyebrow': 'Willkommen in unserer',
      'home.title': 'FotoBox',
      'home.subtitle': 'Haltet einen Moment für das Brautpaar fest',
      'home.photo': 'Foto',
      'home.photoHint': 'Zwei Bilder mit 3-2-1 Countdown',
      'home.video': 'Video',
      'home.videoHint': 'Eine 15-Sekunden-Botschaft ans Brautpaar',
      'home.tapToStart': 'Zum Auswählen tippen',
      'common.back': 'Zurück',
      'common.start': "Los geht's",
      'common.startingCamera': 'Kamera wird gestartet…',
      'photo.getReady': 'In Position bringen und lächeln!',
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
      'video.ready': 'Nehmt eine {s}-Sekunden-Botschaft auf',
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
      'discarded': 'Nichts gespeichert – kommt gerne wieder!',
      'error.camera': 'Die Kamera ist nicht verfügbar. Bitte Berechtigungen prüfen und neu laden.',
      'error.recorder': 'Videoaufnahme wird in diesem Browser nicht unterstützt.',
      'error.save': 'Speichern fehlgeschlagen. Bitte sagt den Gastgebern Bescheid.',
      'lang.switch': 'English',
      'fullscreen': 'Vollbild',
    },
  };

  let current = 'en';

  function t(key, vars) {
    const table = STRINGS[current] || STRINGS.en;
    let text = table[key] != null ? table[key] : STRINGS.en[key] != null ? STRINGS.en[key] : key;
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
    current = STRINGS[lang] ? lang : 'en';
    try {
      localStorage.setItem('fotobox.lang', current);
    } catch (err) {
      /* storage may be unavailable in kiosk/private mode – ignore */
    }
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
