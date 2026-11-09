// Language names in the viewer's own language, from the browser.

const names = (() => {
  try { return new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' }) } catch { return null }
})()

export function langName (code: string): string {
  try { return names?.of(code) ?? code } catch { return code }
}

/** The browser's language if the room can use it, else English. */
export function defaultLang (available: string[]): string {
  const mine = navigator.language.slice(0, 2).toLowerCase()
  return available.includes(mine) ? mine : available.includes('en') ? 'en' : available[0] ?? 'en'
}

export function sortedLangs (codes: string[]) {
  return [...codes].sort((a, b) => langName(a).localeCompare(langName(b)))
}
