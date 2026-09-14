/**
 * Hebrew / Telegram text normalization.
 *
 * WhatsApp and Telegram messages arrive full of invisible bidi control
 * characters, non-breaking spaces, four different dash characters and
 * Telegram's own `*bold*` markers. Every later stage assumes text that has
 * already been through `normalizeText`.
 */

// Bidi controls, zero-width chars, BOM. Invisible, but they break every regex.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

// Hebrew maqaf, figure/en/em dashes, minus sign, fullwidth hyphen -> plain "-".
const DASHES = /[־‐‑‒–—―−﹘﹣－]/g;

// Spaces that are not U+0020.
const SPACES = /[\t   -    　]/g;

// Telegram / WhatsApp inline formatting markers.
const MARKDOWN = /[*_`~]/g;

// Hebrew geresh / gershayim and every flavour of typographic quote.
const QUOTES = /[׳״'"‘’“”′″`´]/g;

/**
 * Full normalization of an incoming message.
 * Keeps line structure (blank lines are meaningful section breaks).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(DASHES, '-')
    .replace(SPACES, ' ')
    .replace(MARKDOWN, '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Aggressive key used for keyword and alias matching only - never for display.
 * Drops quotes/geresh entirely (so `ר"ה` and `רה` match) and reduces every
 * other punctuation run to a single space.
 * @param {string} s
 * @returns {string}
 */
export function matchKey(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(QUOTES, '')
    .replace(/[^֐-׿a-zA-Z0-9]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Tidy a fragment for display: trim stray separators from both ends.
 * @param {string} s
 * @returns {string}
 */
export function cleanFragment(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\s\-:,.;|()\[\]]+$/g, '')
    .replace(/^[\s\-:,.;|]+/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Number of whitespace-separated words. */
export function wordCount(s) {
  const t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}
