/**
 * Converts an email prefix to a capitalized default name.
 * e.g. "max.muster" -> "Max Muster"
 */
export function formatDefaultName(email) {
  if (!email || email === 'Gast') return 'Gast';
  
  const prefix = email.split('@')[0];
  
  // Split by dot, hyphen, or underscore
  const parts = prefix.split(/[._-]/);
  
  const capitalizedParts = parts.map(part => {
    if (!part) return '';
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
  
  return capitalizedParts.join(' ').trim();
}

/**
 * Convert title to URL-safe slug
 */
export function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/(?<![a-zA-Z0-9])\d{4}[-._/]?\d{2}[-._/]?\d{2}(?![a-zA-Z0-9])/g, '')
    .replace(/(?<![a-zA-Z0-9])\d{2}[-._/]?\d{2}[-._/]?\d{4}(?![a-zA-Z0-9])/g, '')
    .replace(/(?<![a-zA-Z0-9])\d{8}(?![a-zA-Z0-9])/g, '') // Also catch pure YYYYMMDD
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w-]+/g, '')   // Remove all non-word chars
    .replace(/^-+|-+$/g, '')   // Remove leading/trailing dashes
    .replace(/--+/g, '-');     // Replace multiple - with single -
}
