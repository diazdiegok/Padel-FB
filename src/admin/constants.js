export const AUTH_KEY = "liga-fb-admin-ok";
export const HIDDEN_CATS = new Set(["S Masculina"]);
export const RANK_PATH = "src/data/ranking.json";
export const SITE_PATH = "src/data/site.json";
export const FIXTURE_PATH = "src/data/fixture.json";
export const RESULTS_PATH = "src/data/results.json";
export const RANK_COLS = ["name", "cat", "pts", "pj", "dif", "pos", "temp"];
export const FX_COLS = ["categoria", "partido", "complejo", "cancha", "dia", "horario"];
export const CATS = [
  "A Masculina",
  "B Masculina",
  "C Masculina",
  "A Femenino",
  "B Femenino",
  "C Femenino",
];
export const CAT_MAP = {
  "A MASC": "A Masculina",
  "A MASCULINA": "A Masculina",
  "B MASC": "B Masculina",
  "B MASCULINA": "B Masculina",
  "C MASC": "C Masculina",
  "C MASCULINA": "C Masculina",
  "A FEM": "A Femenino",
  "A FEMENINO": "A Femenino",
  "B FEM": "B Femenino",
  "B FEMENINO": "B Femenino",
  "C FEM": "C Femenino",
  "C FEMENINO": "C Femenino",
};
export const VENUE_MAP = {
  OPEN: "Open Padel",
  "OPEN PADEL": "Open Padel",
  AMERICAS: "Americas Padel",
  AMÉRICAS: "Americas Padel",
  "AMERICAS PADEL": "Americas Padel",
  PALERMO: "Palermo Padel",
  "PALERMO PÁDEL": "Palermo Padel",
  "PALERMO PADEL": "Palermo Padel",
  TERRAZAS: "Terrazas Padel",
  "TERRAZAS PADEL": "Terrazas Padel",
  BENGURION: "Bengurion Padel",
  "BEN GURION": "Bengurion Padel",
};

export const SECTIONS = {
  temporadas: { group: "Liga", title: "Temporadas", help: "Creá una temporada y dejala en juego. Ranking, fixture y fecha pasan a usar esa." },
  ranking: { group: "Liga", title: "Ranking", help: "Editá posiciones, importá CSV y publicá la tabla." },
  fixture: { group: "Liga", title: "Fixture", help: "Cargá la fecha, revisá partidos y publicá. Los resultados se cargan en Resultados." },
  resultados: { group: "Liga", title: "Resultados", help: "Cargá el score de cada partido. Al publicar se actualiza el ranking." },
  fecha: { group: "Liga", title: "Fecha", help: "Abrí o cerrá la carga de disponibilidad de las parejas." },
  sedes: { group: "Liga", title: "Sedes", help: "Complejos de la liga y la academia. Marcá dónde se muestra cada uno." },
  academia: { group: "Academia", title: "Adultos", help: "Profes, programas y textos de las clases de adultos." },
  infantiles: { group: "Academia", title: "Infantiles", help: "Textos, sedes y horarios de las clases infantiles." },
  sitio: { group: "Sitio", title: "Datos del sitio", help: "Contacto, ciudad y texto de inicio." },
  torneos: { group: "Torneos", title: "Torneos", help: "Listado de torneos. Si está vacío, la web muestra el aviso." },
};
