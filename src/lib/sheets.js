/** Google Sheet fijo de canchas (pestañas Fecha 1, Fecha 2…). */
export const DEFAULT_COURTS_SHEET_ID = "1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg";
export const DEFAULT_COURTS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg/edit";

/** Extrae el ID de un Google Sheet desde URL o ID suelto. */
export function parseGoogleSheetId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return "";
}

/** Siempre el mismo Sheet de canchas; siteData solo como override opcional. */
export function courtsSheetIdForSeason(siteData = {}, temp = "") {
  const season = String(temp || siteData.currentSeason || "").toUpperCase();
  const bySeason = siteData.courtsSheets && typeof siteData.courtsSheets === "object" ? siteData.courtsSheets : {};
  const raw = bySeason[season] || bySeason[temp] || siteData.courtsSheetId || DEFAULT_COURTS_SHEET_ID;
  return parseGoogleSheetId(raw) || DEFAULT_COURTS_SHEET_ID;
}
