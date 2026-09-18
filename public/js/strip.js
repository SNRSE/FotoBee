/* Photo strip composite: lays the selected photos out on a print-ready 2x6" strip or 4x6" postcard. */
(function () {
  'use strict';

  const COLORS = {
    cream: '#F4ECDF',
    white: '#FFFFFF',
    gold: '#C9A24E',
    goldDeep: '#A8862F',
    goldLight: '#E9D5A0',
    brownSoft: '#8A6F5A',
    taupe: '#B9A28A',
  };
  const FONT_DISPLAY = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
  const FONT_BODY = 'Jost, "Helvetica Neue", Arial, sans-serif';
  // Every face the canvas code uses: names (italic 600), date (Jost 400), brand line + photo captions (italic 500).
  const FONT_SPECS = ['italic 600 84px "Cormorant Garamond"', '400 34px Jost', 'italic 500 40px "Cormorant Garamond"'];
  const FONT_TIMEOUT_MS = 2500;

  /** Resolve once the bundled fonts are usable on a canvas (or after a short timeout – never block saving). */
  function ensureFonts() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve(false);
    const loads = FONT_SPECS.map((spec) => document.fonts.load(spec).catch(() => []));
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), FONT_TIMEOUT_MS));
    return Promise.race([Promise.all(loads).then(() => true), timeout]);
  }

  /** Paper size for the number of photos: 3–4 → 2x6" strip, 1–2 → 4x6" postcard. */
  function sizeFor(count, dpi) {
    const d = Math.max(72, Number(dpi) || 300);
    const strip = count >= 3;
    return { width: Math.round((strip ? 2 : 4) * d), height: Math.round(6 * d), kind: strip ? 'strip' : 'postcard' };
  }

  /* ------------------------------------------------------------------ */
  /* Image loading                                                       */
  /* ------------------------------------------------------------------ */
  function loadViaElement(shot) {
    return new Promise((resolve, reject) => {
      const own = !shot.url;
      const url = shot.url || URL.createObjectURL(shot.blob);
      const img = new Image();
      img.onload = () => {
        if (own) URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        if (own) URL.revokeObjectURL(url);
        reject(new Error('Photo could not be decoded'));
      };
      img.src = url;
    });
  }

  /** Decode a shot ({ blob, url }) into something drawImage() accepts. */
  function loadImage(shot) {
    if (shot.blob && typeof createImageBitmap === 'function') {
      return createImageBitmap(shot.blob).catch(() => loadViaElement(shot));
    }
    return loadViaElement(shot);
  }

  function releaseImage(img) {
    if (img && typeof img.close === 'function') img.close();
  }

  function imageSize(img) {
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }

  /* ------------------------------------------------------------------ */
  /* Drawing helpers                                                     */
  /* ------------------------------------------------------------------ */
  /** Draw an image with CSS "object-fit: cover" semantics into the box. */
  function drawCover(ctx, img, x, y, w, h) {
    const size = imageSize(img);
    const scale = Math.max(w / size.width, h / size.height);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh, x, y, w, h);
  }

  /** Faint linen texture: brown grain and white specks from a tiny tiled noise canvas. */
  function linenPattern(ctx) {
    const size = 96;
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext('2d');
    const image = tctx.createImageData(size, size);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const light = Math.random() < 0.5;
      px[i] = light ? 255 : 92;
      px[i + 1] = light ? 255 : 68;
      px[i + 2] = light ? 255 : 51;
      px[i + 3] = Math.floor(Math.random() * 18); // 0–7 % opacity
    }
    tctx.putImageData(image, 0, 0);
    return ctx.createPattern(tile, 'repeat');
  }

  function drawBackground(ctx, W, H, background) {
    ctx.fillStyle = background || COLORS.cream;
    ctx.fillRect(0, 0, W, H);
    try {
      const pattern = linenPattern(ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, W, H);
      }
    } catch (err) {
      /* texture is decoration only */
    }
  }

  /** Double gold border: 3px gold inset ~3 % of the width, 1px light gold a little further in. */
  function drawBorders(ctx, W, H, m) {
    ctx.lineWidth = m.outerLine;
    ctx.strokeStyle = COLORS.gold;
    ctx.strokeRect(m.outerInset + m.outerLine / 2, m.outerInset + m.outerLine / 2, W - 2 * m.outerInset - m.outerLine, H - 2 * m.outerInset - m.outerLine);
    ctx.lineWidth = m.innerLine;
    ctx.strokeStyle = COLORS.goldLight;
    ctx.strokeRect(m.innerInset + m.innerLine / 2, m.innerInset + m.innerLine / 2, W - 2 * m.innerInset - m.innerLine, H - 2 * m.innerInset - m.innerLine);
  }

  /** White matte with a soft shadow and a 1px gold hairline, photo cover-cropped inside. */
  function drawFramedPhoto(ctx, img, x, y, matteW, matteH, pad, hairline) {
    ctx.save();
    ctx.shadowColor = 'rgba(92, 68, 51, 0.16)';
    ctx.shadowBlur = pad * 1.2;
    ctx.shadowOffsetY = pad * 0.4;
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(x, y, matteW, matteH);
    ctx.restore();
    ctx.lineWidth = hairline;
    ctx.strokeStyle = COLORS.gold;
    ctx.strokeRect(x + hairline / 2, y + hairline / 2, matteW - hairline, matteH - hairline);
    drawCover(ctx, img, x + pad, y + pad, matteW - 2 * pad, matteH - 2 * pad);
  }

  /** The knot ornament from the start screen (.knot-divider): two crossing curves, centre dot, flanking lines. */
  function drawKnot(ctx, cx, cy, knotW, dividerW) {
    const s = knotW / 48; // the SVG is drawn in a 48x24 box
    const x0 = cx - knotW / 2;
    const y0 = cy - knotW / 4;
    const p = (x, y) => [x0 + x * s, y0 + y * s];
    ctx.save();
    ctx.strokeStyle = COLORS.gold;
    ctx.fillStyle = COLORS.gold;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.beginPath();
    ctx.moveTo(...p(2, 12));
    ctx.bezierCurveTo(...p(10, 2), ...p(18, 2), ...p(24, 12));
    ctx.bezierCurveTo(...p(30, 22), ...p(38, 22), ...p(46, 12));
    ctx.moveTo(...p(2, 12));
    ctx.bezierCurveTo(...p(10, 22), ...p(18, 22), ...p(24, 12));
    ctx.bezierCurveTo(...p(30, 2), ...p(38, 2), ...p(46, 12));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // Flanking hairlines fading out towards the edges.
    const gap = knotW * 0.3;
    const lineW = (dividerW - knotW) / 2 - gap;
    if (lineW > 0) {
      ctx.lineWidth = Math.max(1, s);
      [[cx - knotW / 2 - gap - lineW, cx - knotW / 2 - gap], [cx + knotW / 2 + gap, cx + knotW / 2 + gap + lineW]].forEach(([xa, xb], i) => {
        const grad = ctx.createLinearGradient(xa, 0, xb, 0);
        grad.addColorStop(i === 0 ? 0 : 1, 'rgba(201, 162, 78, 0)');
        grad.addColorStop(i === 0 ? 1 : 0, COLORS.gold);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(xa, cy);
        ctx.lineTo(xb, cy);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  /** Centred text with manual letter spacing (ctx.letterSpacing is not available everywhere). */
  function drawSpacedText(ctx, text, cx, y, spacing) {
    const chars = Array.from(text);
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cx - total / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      ctx.fillText(c, x, y);
      x += widths[i] + spacing;
    });
  }

  /** Shrink a font size until the text fits into maxWidth. */
  function fitFont(ctx, text, size, family, style, maxWidth) {
    let px = size;
    for (let i = 0; i < 12; i += 1) {
      ctx.font = `${style} ${px}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth || px <= 8) break;
      px = Math.floor(px * 0.92);
    }
    return px;
  }

  /* ------------------------------------------------------------------ */
  /* Layout                                                              */
  /* ------------------------------------------------------------------ */
  function metrics(W, kind, dpi) {
    const scale = Math.max(1, (Number(dpi) || 300) / 300); // keep the hairlines printable at higher dpi
    const outerInset = Math.round(W * 0.03);
    const innerInset = outerInset + Math.round(W * 0.015);
    return {
      outerInset,
      innerInset,
      outerLine: Math.round(3 * scale),
      innerLine: Math.max(1, Math.round(scale)),
      hairline: Math.max(1, Math.round(scale)),
      margin: innerInset + Math.round(W * 0.04), // where the content starts
      mattePad: Math.round(W * 0.02),
      minGap: Math.round(W * 0.04),
      maxGap: Math.round(W * 0.12),
      knotW: Math.round(W * 0.09),
      namesSize: Math.round(W * (kind === 'strip' ? 0.07 : 0.06)),
      dateSize: Math.round(W * 0.026),
      brandSize: Math.round(W * 0.03),
      captionGap: Math.round(W * 0.018),
    };
  }

  /** Lines of the caption block (bottom of the strip) with their heights. */
  function captionLines(m, opts) {
    const lines = [{ kind: 'knot', height: Math.round(m.knotW / 2) }];
    if (opts.coupleNames) lines.push({ kind: 'names', height: m.namesSize, text: opts.coupleNames });
    if (opts.eventDate) lines.push({ kind: 'date', height: m.dateSize, text: String(opts.eventDate).toUpperCase() });
    if (opts.brand) lines.push({ kind: 'brand', height: m.brandSize, text: opts.brand });
    const height = lines.reduce((sum, line) => sum + line.height, 0) + m.captionGap * (lines.length - 1);
    return { lines, height };
  }

  function drawCaption(ctx, W, top, caption, m) {
    const cx = W / 2;
    const maxWidth = W - 2 * m.margin;
    let y = top;
    ctx.textBaseline = 'middle';
    caption.lines.forEach((line) => {
      const mid = y + line.height / 2;
      if (line.kind === 'knot') {
        drawKnot(ctx, cx, mid, m.knotW, W * 0.5);
      } else if (line.kind === 'names') {
        fitFont(ctx, line.text, m.namesSize, FONT_DISPLAY, 'italic 600', maxWidth);
        ctx.fillStyle = COLORS.goldDeep;
        ctx.textAlign = 'center';
        ctx.fillText(line.text, cx, mid);
      } else if (line.kind === 'date') {
        ctx.font = `400 ${m.dateSize}px ${FONT_BODY}`;
        ctx.fillStyle = COLORS.brownSoft;
        drawSpacedText(ctx, line.text, cx, mid, m.dateSize * 0.3);
      } else if (line.kind === 'brand') {
        ctx.font = `italic 500 ${m.brandSize}px ${FONT_DISPLAY}`;
        ctx.fillStyle = COLORS.taupe;
        drawSpacedText(ctx, line.text, cx, mid, m.brandSize * 0.08);
      }
      y += line.height + m.captionGap;
    });
  }

  /** Photo boxes: 3:2 landscape mattes spanning the inner width, shrunk only if they would not fit. */
  function layoutPhotos(count, W, top, bottom, m) {
    const avail = bottom - top;
    let matteW = W - 2 * m.margin;
    let photoW = matteW - 2 * m.mattePad;
    let photoH = Math.round((photoW * 2) / 3);
    let matteH = photoH + 2 * m.mattePad;
    if (count * matteH + (count - 1) * m.minGap > avail) {
      matteH = Math.floor((avail - (count - 1) * m.minGap) / count);
      photoH = matteH - 2 * m.mattePad;
      photoW = Math.round((photoH * 3) / 2);
      matteW = photoW + 2 * m.mattePad;
    }
    let gap = Math.min(Math.max((avail - count * matteH) / (count + 1), m.minGap), m.maxGap);
    if (count > 1 && count * matteH + (count - 1) * gap > avail) gap = (avail - count * matteH) / (count - 1);
    const total = count * matteH + (count - 1) * gap;
    const startY = top + (avail - total) / 2;
    const x = Math.round((W - matteW) / 2);
    const boxes = [];
    for (let i = 0; i < count; i += 1) {
      boxes.push({ x, y: Math.round(startY + i * (matteH + gap)), w: matteW, h: matteH });
    }
    return boxes;
  }

  function render(images, opts) {
    const size = sizeFor(images.length, opts.dpi);
    const W = size.width;
    const H = size.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const m = metrics(W, size.kind, opts.dpi);

    drawBackground(ctx, W, H, opts.background);
    drawBorders(ctx, W, H, m);

    const caption = captionLines(m, opts);
    const captionTop = H - m.margin - caption.height;
    const boxes = layoutPhotos(images.length, W, m.margin, captionTop - Math.round(W * 0.02), m);
    images.forEach((img, i) => {
      const b = boxes[i];
      drawFramedPhoto(ctx, img, b.x, b.y, b.w, b.h, m.mattePad, m.hairline);
    });
    drawCaption(ctx, W, captionTop, caption, m);
    return canvas;
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
    });
  }

  /**
   * Compose the strip.
   * @param shots   [{ blob, url }] – the selected photos in order (1–4)
   * @param options { coupleNames, eventDate, brand, dpi = 300, quality = 0.92, background }
   * @returns Promise<Blob> JPEG
   */
  function compose(shots, options) {
    const opts = Object.assign({ dpi: 300, quality: 0.92, coupleNames: '', eventDate: '', brand: '' }, options);
    const list = (shots || []).filter((s) => s && (s.blob || s.url));
    if (list.length > 4) console.warn(`[strip] ${list.length} photos on one strip – boxes get small, photoCount 4 is the intended maximum`);
    if (!list.length) return Promise.reject(new Error('No photos for the strip'));
    let images = [];
    return Promise.all([ensureFonts(), Promise.all(list.map(loadImage))])
      .then((loaded) => {
        images = loaded[1];
        return toBlob(render(images, opts), opts.quality);
      })
      .finally(() => images.forEach(releaseImage));
  }

  window.Strip = { compose, sizeFor, ensureFonts };
})();
