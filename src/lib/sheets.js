/** Google Sheet fijo de canchas (pestañas Fecha 1, Fecha 2…). */
export const DEFAULT_COURTS_SHEET_ID = "1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg";
export const DEFAULT_COURTS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1OHnpx9ganzFR805yv8f5mmyYH_-o-2bNsOn9agmJcvg/edit";

/** Sheet donde el admin pega el fixture armado (sin pendientes). */
export const DEFAULT_FIXTURE_DRIVE_SHEET_ID = "1OI6ogfmdOAQ5mz3JqP482cDPT_xp-PjWdE07k54AAiQ";
export const DEFAULT_FIXTURE_DRIVE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1OI6ogfmdOAQ5mz3JqP482cDPT_xp-PjWdE07k54AAiQ/edit";

/** Sheet donde se pegan solo las parejas pendientes, con el horario en que pueden. */
export const DEFAULT_PENDING_DRIVE_SHEET_ID = "1-iy8HSNkDDUJg4do08aydAK1MMtfhqrWmO4PGebkxe4";
export const DEFAULT_PENDING_DRIVE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1-iy8HSNkDDUJg4do08aydAK1MMtfhqrWmO4PGebkxe4/edit";

/** Sheet donde se pegan las parejas que recuperan fecha (W.O. / partido faltante). */
export const DEFAULT_RECOVER_DRIVE_SHEET_ID = "1M4OMDttW86SdOixs-uCbXyZLoPSbf-YLylZO7qwkYrQ";
export const DEFAULT_RECOVER_DRIVE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1M4OMDttW86SdOixs-uCbXyZLoPSbf-YLylZO7qwkYrQ/edit";

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
