/**
 * Guest emails never appear in full in logs (spec section 8). The first
 * character and the domain are usually enough to match a support request to a
 * log line without exposing the address.
 *
 *   maskEmail('jane.doe@example.com') -> 'j***@example.com'
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return '***';
  return `${trimmed[0]}***${trimmed.slice(at)}`;
}
