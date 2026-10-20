// Motion Audio / Central brand: the mark, the app glyphs and the icon tile, as SVG. Used by make-brand.mjs (which
// renders every icon and splash size) and by the website (inline SVG).
// Colours: graphite tile, brass glyph.
export const C = { tileTop: "#2B3038", tileBot: "#15181D", bg: "#15181D", brassHi: "#EBD39C", brassLo: "#B4873C", ink: "#ECE7DD" };

// each glyph is drawn in a 100 x 100 box; "s" = the brass paint, "dim" = brass at low strength
const S = 'stroke="url(#brass)" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="url(#brass)"';
const bell = (x0, x1, top, base) => { const m = (x0 + x1) / 2, w = (x1 - x0); return `M${x0},${base} C${x0 + w * 0.3},${base} ${m - w * 0.23},${top} ${m},${top} C${m + w * 0.23},${top} ${x1 - w * 0.3},${base} ${x1},${base}`; };

export const GLYPHS = {
  // Motion Audio: an M made of two overlapping pad swells
  mark: `<path ${S} d="${bell(6, 66, 20, 80)}"/><path ${S} d="${bell(34, 94, 20, 80)}"/>`,
  // Central Pedal: the stompbox - a swell above the footswitch
  pedal: `<rect ${S} x="21" y="7" width="58" height="86" rx="11"/><path ${S.replace('stroke-width="7"', 'stroke-width="6"')} d="${bell(30, 70, 25, 52)}"/><circle ${F} cx="50" cy="73" r="8.5"/>`,
  // Central Pedal Control: a swell being edited - its peak node and the handle through it
  pedalControl: `<path ${S} d="${bell(8, 92, 26, 76)}"/><path stroke="url(#brass)" stroke-width="3.5" stroke-linecap="round" d="M31,26 H69"/><circle ${F} cx="31" cy="26" r="4.5"/><circle ${F} cx="69" cy="26" r="4.5"/><circle fill="#1E2228" stroke="url(#brass)" stroke-width="5" cx="50" cy="26" r="8"/>`,
  // Central Control: the desk - three faders
  control: `<g stroke="url(#brass)" stroke-width="3.5" stroke-linecap="round" opacity=".5"><path d="M27,12 V88"/><path d="M50,12 V88"/><path d="M73,12 V88"/></g><rect ${F} x="17" y="56" width="20" height="12" rx="3.5"/><rect ${F} x="40" y="26" width="20" height="12" rx="3.5"/><rect ${F} x="63" y="44" width="20" height="12" rx="3.5"/>`,
  // Central Usage: the musician's in-ears
  usage: `<path ${S} d="M20,60 V52 A30,30 0 0 1 80,52 V60"/><rect ${F} x="12" y="54" width="18" height="32" rx="8"/><rect ${F} x="70" y="54" width="18" height="32" rx="8"/>`,
  // Central Services: the schedule
  services: `<rect ${S} x="14" y="20" width="72" height="68" rx="11"/><path ${S} d="M14,40 H86"/><path ${S} d="M33,11 V27 M67,11 V27"/><path ${S} d="M36,64 L46,73 L65,54"/>`,
};

const defs = `<defs><linearGradient id="brass" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="${C.brassHi}"/><stop offset="1" stop-color="${C.brassLo}"/></linearGradient>
<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.tileTop}"/><stop offset="1" stop-color="${C.tileBot}"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
<filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="DY" stdDeviation="SD" flood-color="#000" flood-opacity=".32"/></filter></defs>`;
// brass gradient in userSpace for the glyph box, so strokes and fills share one light
const glyphDefs = (x, y, s) => `<linearGradient id="brass" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${y + s}"><stop offset="0" stop-color="${C.brassHi}"/><stop offset="1" stop-color="${C.brassLo}"/></linearGradient>`;
const place = (name, x, y, s) => `<g transform="translate(${x},${y}) scale(${s / 100})">${GLYPHS[name]}</g>`;

// shape: "mac" (rounded body with margin and shadow, transparent around), "square" (full bleed, iOS), "round"
// (Android round), "fg" (Android adaptive foreground: glyph only, transparent), "plain" (glyph on nothing)
export function icon(name, size = 1024, shape = "mac", id = "") {
  const n = size;
  let body = "", gx, gy, gs;
  if (shape === "mac") {
    const m = n * 100 / 1024, w = n - 2 * m, r = w * 0.2245;
    body = `<rect x="${m}" y="${m * 0.9}" width="${w}" height="${w}" rx="${r}" fill="url(#tile)" filter="url(#drop)"/><rect x="${m + 1.5}" y="${m * 0.9 + 1.5}" width="${w - 3}" height="${w - 3}" rx="${r - 1.5}" fill="none" stroke="url(#rim)" stroke-width="${Math.max(2, n / 340)}"/>`;
    gs = w * 0.54; gx = (n - gs) / 2; gy = m * 0.9 + (w - gs) / 2;
  } else if (shape === "square") {
    body = `<rect width="${n}" height="${n}" fill="url(#tile)"/>`; gs = n * 0.5; gx = gy = (n - gs) / 2;
  } else if (shape === "round") {
    body = `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="url(#tile)"/><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2 - n / 120}" fill="none" stroke="url(#rim)" stroke-width="${Math.max(1, n / 60)}"/>`; gs = n * 0.5; gx = gy = (n - gs) / 2;
  } else if (shape === "legacy") {   // Android pre-8 square-ish icon
    const m = n * 0.06, w = n - 2 * m;
    body = `<rect x="${m}" y="${m}" width="${w}" height="${w}" rx="${w * 0.2}" fill="url(#tile)"/>`; gs = w * 0.56; gx = gy = (n - gs) / 2;
  } else if (shape === "fg") { gs = n * 0.40; gx = gy = (n - gs) / 2; }
  else { gs = n; gx = gy = 0; }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">${defs.replace(/<linearGradient id="brass"[\s\S]*?<\/linearGradient>/, glyphDefs(gx, gy, gs)).replace("DY", (n * 10 / 1024).toFixed(2)).replace("SD", (n * 16 / 1024).toFixed(2))}${body}${place(name, gx, gy, gs)}</svg>`;
  if (id) svg = svg.replace(/id="(\w+)"/g, 'id="' + id + '$1"').replace(/url\(#(\w+)\)/g, 'url(#' + id + '$1)');
  return svg;
}
export const APPS = [
  { glyph: "pedal", name: "Central Pedal", slug: "central-pedal" },
  { glyph: "pedalControl", name: "Central Pedal Control", slug: "central-pedal-control" },
  { glyph: "control", name: "Central Control", slug: "central-control" },
  { glyph: "usage", name: "Central Usage", slug: "central-usage" },
  { glyph: "services", name: "Central Services", slug: "central-services" },
];
