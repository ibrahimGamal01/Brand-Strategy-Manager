/**
 * Extract csrftoken from a cookie string (semicolon-delimited).
 */
export function extractCsrf(cookie: string | null | undefined): string | null {
  if (!cookie) return null;
  const parts = cookie.split(';').map(p => p.trim());
  for (const p of parts) {
    if (p.toLowerCase().startsWith('csrftoken=')) {
      return p.split('=')[1] || null;
    }
  }
  return null;
}
