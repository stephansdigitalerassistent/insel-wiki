/**
 * Converts an email prefix to a capitalized default name.
 * e.g. "max.muster" -> "Max Muster"
 *
 * @param {string} email - The email address to format.
 * @returns {string} The capitalized name, or "Gast".
 *
 * @example Usage
 * import { formatDefaultName } from './utils/string.js';
 * const name = formatDefaultName('max.muster@insel.ch');
 * console.log(name); // "Max Muster"
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
 *
 * @param {string} text - The input text to convert.
 * @returns {string} The URL-safe slug.
 *
 * @example Usage
 * import { slugify } from './utils/string.js';
 * const slug = slugify('Über uns & mehr!');
 * console.log(slug); // "ber-uns-mehr"
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

/**
 * Deterministically generate initials from email or name.
 */
export function getInitials(nameOrEmail) {
  if (!nameOrEmail || nameOrEmail === 'Gast') return 'G';
  
  // If it's an email, get prefix
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  const parts = base.split(/[._-]/);
  
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return base.substring(0, 2).toUpperCase();
}

/**
 * Deterministically generate a color based on email.
 */
export function getColorForEmail(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#f87171', '#fb923c', '#fbbf24', '#34d399',
    '#38bdf8', '#818cf8', '#c084fc', '#f472b6'
  ];
  return colors[Math.abs(hash) % colors.length];
}
