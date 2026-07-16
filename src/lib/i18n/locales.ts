/**
 * Single source of truth for the app-language catalog.
 *
 * Mirrors the shape of `src/lib/themes.ts` (mode/theme catalog): a
 * const tuple of ids, a metadata table the UI reads from, and a
 * type guard. Unlike mode/theme — which are pure client-side
 * localStorage state — the active locale has to be readable during
 * SSR (next-intl resolves `messages` server-side before hydration in
 * `src/i18n/request.ts`), so it's persisted as a plain cookie instead
 * of localStorage. `setLocaleCookie` below writes it directly from
 * the browser; no API route needed, the same "single attribute
 * swap, no save button" pattern the appearance panel already uses.
 */

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = isLocale(process.env.NEXT_PUBLIC_APP_LOCALE)
  ? (process.env.NEXT_PUBLIC_APP_LOCALE as Locale)
  : "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export interface LocaleMeta {
  id: Locale;
  /** Language's own name for itself — never translated (e.g. "Español" stays "Español" even when viewed in English). */
  nativeName: string;
}

export const LOCALES_META: ReadonlyArray<LocaleMeta> = [
  { id: "en", nativeName: "English" },
  { id: "es", nativeName: "Español" },
];

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** Client-only: persists the chosen locale so the next request (and `router.refresh()`) picks it up server-side. */
export function setLocaleCookie(locale: Locale) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; SameSite=Lax`;
}
