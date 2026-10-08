/**
 * Numeros de telephone. Format Congo-Brazzaville : +242 0X XXX XX XX, le 0 initial fait partie du
 * numero (necessaire a WhatsApp) et n'est JAMAIS retire. Stockage : chiffres seuls (242 + 9 chiffres).
 * Autres pays : le prefixe international est conserve tel quel (chiffres seuls).
 */
export function normalizePhone(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('242')) {
    const rest = digits.slice(3);
    // ancien format sans le 0 initial (242 + 8 chiffres) : on retablit le 0
    return rest.length === 8 ? `2420${rest}` : digits;
  }
  // numero local congolais : 0X XXX XX XX (9 chiffres commencant par 0)
  if (digits.length === 9 && digits.startsWith('0')) return `242${digits}`;
  return digits;
}
