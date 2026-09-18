const paths: Record<string, string> = {
  camera: '<path d="M14.5 4h-5L7.7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.7z"/><circle cx="12" cy="13" r="4"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6 6-6-6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  gallery: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m4 15 5-5 5 5 3-3 3 3"/><circle cx="15.5" cy="8.5" r=".7"/>',
  full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  redo: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  mute: '<path d="m2 2 20 20M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 5m2-5v-2m-7 9v3m-4 0h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
};
export const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.heart}</svg>`;
export const flower = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.4"><ellipse cx="24" cy="24" rx="7" ry="19"/><ellipse cx="24" cy="24" rx="7" ry="19" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="7" ry="19" transform="rotate(120 24 24)"/></g><circle cx="24" cy="24" r="3" fill="currentColor"/></svg>`;
export const weave = `<svg class="weave" viewBox="0 0 280 190" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1"><path d="M8 0v54l132 100L272 54V0M24 0v48l116 88L256 48V0M40 0v42l100 76L240 42V0M56 0v36l84 64L224 36V0M72 0v30l68 52L208 30V0M88 0v24l52 40L192 24V0M104 0v18l36 28L176 18V0M120 0v12l20 16 20-16V0"/><path d="M8 54v24m16-18v31m16-19v32m16-20v33m16-21v35m16-23v37m16-25v39m16-27v41m20-28v46m20-46v30m16-42v28m16-40v28m16-40v27m16-39v26m16-38v26m16-38v25m16-37v24"/></g></svg>`;

