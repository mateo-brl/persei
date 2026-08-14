/** Formatage des valeurs affichées. Séparé de l'écran : testable et stable. */

export function formatZoomFactor(factor: number): string {
  if (!Number.isFinite(factor)) return '—';
  return `${(Math.round(factor * 10) / 10).toString().replace('.', ',')}×`;
}

export function formatShutter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 0.4) return `${seconds.toFixed(1)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

export function formatFocus(position: number): string {
  if (!Number.isFinite(position)) return '—';
  return position >= 0.99 ? '∞' : position.toFixed(2);
}

/** Durée d'enregistrement : mm:ss, et hh:mm:ss au-delà de l'heure. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Espace disque et poids de fichiers, en unités lisibles. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Message d'erreur montré à l'utilisateur. Le code Pxx du natif est conservé
 * tel quel : c'est lui qui permet de retrouver le point de défaillance exact.
 */
export function formatError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.message) return err.code ? `${err.code} ${err.message}` : err.message;
  return String(e);
}

/** Étiquette d'un fichier produit, pour la visionneuse. */
export function describeCapture(uri: string): string {
  if (uri.includes('-lueur')) return 'Lueur (moyenne)';
  if (uri.includes('-etoiles')) return 'Étoiles (fusion max)';
  if (uri.endsWith('.dng')) return 'RAW';
  if (uri.includes('persei-video')) return 'Vidéo';
  if (uri.endsWith('.mov')) return 'Live Photo (vidéo)';
  return 'Photo';
}
