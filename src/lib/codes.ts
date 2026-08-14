/** Lecture des codes QR et codes-barres repérés dans la préview. */

/** Vrai si le code peut être ouvert par le système (page web, plan, wifi non). */
export function isOpenableUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^(https?|mailto|tel|sms|geo|maps):/i.test(trimmed);
}

/** Texte du bandeau : lisible d'un coup d'œil, jamais tronqué au milieu. */
export function describeCode(value: string, type: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('WIFI:')) return 'Réseau wifi';
  if (trimmed.startsWith('BEGIN:VCARD')) return 'Contact';
  if (isOpenableUrl(trimmed)) {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
  // Les identifiants d'Apple gardent la casse d'origine (org.gs1.EAN-13).
  const kind = type.toLowerCase();
  if (kind.includes('ean') || kind.includes('upc')) return `Code-barres ${trimmed}`;
  return trimmed;
}
