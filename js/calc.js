// Pure calculation module: no DOM, no fetch. Pass in data loaded from data/*.json.
// Source of truth: Nick's sheet (Sheet1 O3/P3/Q3). Items marked INDUSTRY are gap-fills.

export const SHAPES = {
  round:  { name: 'Round',          dims: ['d'],      source: 'sheet' },
  square: { name: 'Square',         dims: ['s'],      source: 'industry' },
  rect:   { name: 'Rectangle',      dims: ['l', 'w'], source: 'industry' },
  oblong: { name: 'Oblong / Slot',  dims: ['l', 'w'], source: 'industry' },
  hex:    { name: 'Hexagon',        dims: ['af'],     source: 'industry' },
  custom: { name: 'Custom perimeter', dims: ['p'],    source: 'industry' },
};

/** Excel MROUND for positive numbers (rounds half away from zero). */
export function mround(x, m) {
  if (m === 0) return 0;
  const q = Number((x / m).toPrecision(15));
  return Math.sign(q) * Math.round(Math.abs(q)) * m;
}

export function getMaterial(materials, id) {
  const list = materials.materials || materials;
  // Matches the sheet: anything not Stainless or Aluminum falls into the Steel (else) branch.
  return list.find(m => m.id === id || m.name === id) || list.find(m => m.id === 'steel');
}

/** Cut perimeter (in). Round = pi*D (sheet). Others = INDUSTRY geometry.
 *  oblong: l = overall slot length, w = slot width (end radii = w/2).
 *  hex: af = across flats (side = af/sqrt3, perimeter = 2*sqrt3*af). custom: p = perimeter entered directly. */
export function perimeter(shape, dims) {
  const { d, s, l, w, af, p } = dims;
  switch (shape) {
    case 'round':  return Math.PI * d;
    case 'square': return 4 * s;
    case 'rect':   return 2 * (l + w);
    case 'oblong': if (l < w) throw new Error('Slot length must be >= width'); return 2 * (l - w) + Math.PI * w;
    case 'hex':    return 2 * Math.sqrt(3) * af;
    case 'custom': return p;
    default: throw new Error('Unknown shape ' + shape);
  }
}

/** Sheet Q3: tons = shearPsi * thk * perimeter / 2000 */
export function tonnage({ shape = 'round', dims, thickness, material }, materials) {
  const mat = getMaterial(materials, material);
  const p = perimeter(shape, dims);
  return { tons: (mat.shearPsi * thickness * p) / 2000, perimeter: p, shearPsi: mat.shearPsi, material: mat.name };
}

/** PASS / WARN / FAIL vs rated capacity. warnAt default 0.8 (assumption, not in sheet). */
export function capacityCheck(tons, ratedTons, warnAt = 0.8) {
  if (!(ratedTons > 0)) return { status: 'UNKNOWN', pct: null };
  const pct = tons / ratedTons;
  return { status: pct > 1 ? 'FAIL' : pct > warnAt ? 'WARN' : 'PASS', pct };
}

/** Clearance multiplier (fraction of thickness, total). table 'active' = in-app values
 *  (sheet O3 with Nick-approved aluminum fix); table 'sheet' = Nick's original O3 exactly. */
export function clearanceMultiplier(material, thickness, materials, table = 'active') {
  const mat = getMaterial(materials, material);
  const step = materials.clearance.steps.find(s => thickness >= s.minThk);
  return table === 'sheet' ? step.sheet[mat.id] : step[mat.id];
}

/** Sheet P3: die = MROUND(thk*mult + punch, 1/32) */
export function dieSize(punch, thickness, material, materials, table = 'active') {
  const mult = clearanceMultiplier(material, thickness, materials, table);
  const step = materials.clearance.roundTo || 1 / 32;
  return { die: mround(thickness * mult + punch, step), multiplier: mult, rawDie: thickness * mult + punch };
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

const items = t => (Array.isArray(t) ? t : t.items);
export const available = i => i.inStock !== false && i.qty !== 0;

/** Exact-size, in-stock tooling of a kind. Accepts {items} or a merged array. shape defaults to round. */
export function findStock(tooling, kind, sizeIn, shape = 'round', length) {
  return items(tooling).filter(i => i.kind === kind && (i.shape || 'round') === shape && available(i) &&
    near(i.size, sizeIn) && (length == null || near(i.length, length)));
}

/** Nearest in-stock round sizes of a kind below/above a target (excluding exact). */
export function nearestStock(tooling, kind, sizeIn, n = 2) {
  const sizes = [...new Map(items(tooling).filter(i => i.kind === kind && (i.shape || 'round') === 'round' && available(i)).map(i => [i.size, i])).values()];
  const below = sizes.filter(i => i.size < sizeIn - 1e-6).sort((a, b) => b.size - a.size).slice(0, n);
  const above = sizes.filter(i => i.size > sizeIn + 1e-6).sort((a, b) => a.size - b.size).slice(0, n);
  return { below, above };
}

/** Punch & die recommendation for a round hole. Punch = hole size (as in the sheet, N3). */
export function recommend({ hole, thickness, material }, materials, tooling) { // tooling: merged list or {items}
  const punch = hole;
  const { die, multiplier, rawDie } = dieSize(punch, thickness, material, materials);
  const punchStock = findStock(tooling, 'punch', punch);
  const dieStock = findStock(tooling, 'die', die);
  const altDies = nearestStock(tooling, 'die', die).above.concat(nearestStock(tooling, 'die', die).below)
    .map(i => ({ ...i, clearancePct: (i.size - punch) / thickness }))
    .filter(i => i.size > punch && Math.abs(i.size - die) <= 1 / 16 + 1e-9); // only near-equivalent dies (±1/16")
  return {
    punch, die, rawDie, multiplier,
    clearanceTotal: die - punch,
    punchStock, dieStock,
    punchAlternatives: nearestStock(tooling, 'punch', punch),
    dieAlternatives: altDies,
    // INDUSTRY rule of thumb: punch dia should be >= material thickness.
    punchSmallerThanThk: punch < thickness,
  };
}

/** Format decimal inches as nearest 1/32 fraction (e.g. 1.09375 -> 1-3/32"). */
export function toFraction(x, den = 32) {
  let n = Math.round(x * den), whole = Math.floor(n / den), r = n % den, d = den;
  while (r && r % 2 === 0) { r /= 2; d /= 2; }
  const exact = near(n / den, x);
  const s = r ? (whole ? `${whole}-${r}/${d}"` : `${r}/${d}"`) : `${whole}"`;
  return exact ? s : `≈${s}`;
}

/** Parse 0.5, .5, 1/2, 1-1/2, 1 1/2, with or without ". */
export function parseInches(str) {
  if (typeof str === 'number') return str;
  const s = String(str).replace(/["in\s]+$/g, '').trim();
  let m = s.match(/^(\d+)[-\s]+(\d+)\/(\d+)$/);
  if (m) return +m[1] + m[2] / m[3];
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return m[1] / m[2];
  const v = parseFloat(s);
  return Number.isFinite(v) && /^\d*\.?\d+$/.test(s) ? v : NaN;
}

// Nominal sheet gauge, inches. A gauge number is not the same thickness in every metal.
// Steel: Manufacturers' Standard Gauge. Stainless: US Standard gauge. Aluminum: Brown & Sharpe.
// 10 ga steel is 0.1345", the value the old thickness list used.
const GAUGE_IN = {
  steel: [0.1793, 0.1644, 0.1495, 0.1345, 0.1196, 0.1046, 0.0897, 0.0747, 0.0673, 0.0598, 0.0538, 0.0478, 0.0418, 0.0359, 0.0329, 0.0299, 0.0269, 0.0239],
  stainless: [0.1875, 0.1719, 0.1563, 0.1406, 0.1250, 0.1094, 0.0938, 0.0781, 0.0703, 0.0625, 0.0563, 0.0500, 0.0438, 0.0375, 0.0344, 0.0313, 0.0281, 0.0250],
  aluminum: [0.1443, 0.1285, 0.1144, 0.1019, 0.0907, 0.0808, 0.0720, 0.0641, 0.0571, 0.0508, 0.0453, 0.0403, 0.0359, 0.0320, 0.0285, 0.0253, 0.0226, 0.0201],
};
const GAUGE_FROM = 7;
const COMMON_GA = new Set([7, 8, 10, 11, 12, 14, 16, 18, 20]);
const PLATE = [['1/8', 0.125], ['3/16', 0.1875], ['1/4', 0.25], ['5/16', 0.3125], ['3/8', 0.375], ['1/2', 0.5], ['5/8', 0.625], ['3/4', 0.75], ['1', 1]];

function gaugeRows(materialId) {
  const inches = GAUGE_IN[materialId] || GAUGE_IN.steel;
  return inches.map((inches, i) => ({ ga: GAUGE_FROM + i, inches }));
}

/** Decimal inches for display: 0.1345 -> .1345" , 0.25 -> .25" , 1 -> 1". */
export function formatInches(n) {
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n - Math.round(n)) < 1e-9) return `${Math.round(n)}"`;
  let s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (s.startsWith('0')) s = s.slice(1);
  return `${s}"`;
}

/** Common plate fractions plus the gauge chart for this material, thickest first. */
export function thicknessOptions(materialId = 'steel', { common = false } = {}) {
  const family = GAUGE_IN[materialId] ? materialId : 'steel';
  const gauges = gaugeRows(materialId)
    .filter(r => !common || COMMON_GA.has(r.ga))
    .map(r => ({ kind: 'gauge', gauge: r.ga, label: `${r.ga} ga`, value: `${r.ga} ga`, inches: r.inches, detail: formatInches(r.inches), family }));
  const plate = PLATE.map(([frac, inches]) => ({ kind: 'plate', label: `${frac}"`, value: frac, inches, detail: formatInches(inches), family: 'plate' }));
  const items = [...gauges, ...plate];
  if (!common) return items.sort((a, b) => b.inches - a.inches || a.label.localeCompare(b.label));
  // Shop order: the gauges people ask for, then plate. Thickest-first hid 10 ga under the fold.
  const order = ['10 ga', '11 ga', '12 ga', '14 ga', '16 ga', '18 ga', '20 ga', '7 ga', '8 ga', '1/8"', '3/16"', '1/4"', '5/16"', '3/8"', '1/2"', '5/8"', '3/4"', '1"'];
  return items.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

/** Suggestions for the thickness field. Blank query returns the common list. */
export function filterThickness(query, materialId = 'steel') {
  const q = String(query ?? '').trim().toLowerCase();
  const compact = q.replace(/["\s]/g, '');
  const all = thicknessOptions(materialId);
  if (!compact) return thicknessOptions(materialId, { common: true });
  if (compact === 'ga' || compact === 'gauge') return all.filter(i => i.kind === 'gauge');
  const hits = all.filter(item => {
    const label = item.label.toLowerCase().replace(/["\s]/g, '');
    const value = item.value.toLowerCase().replace(/\s/g, '');
    if (label.startsWith(compact) || value.startsWith(compact)) return true;
    if (item.kind === 'gauge' && (compact === String(item.gauge) || compact === `${item.gauge}ga` || compact === `${item.gauge}gauge`)) return true;
    const dec = item.inches.toFixed(4);
    const dot = dec.replace(/^0/, '');
    return dec.startsWith(q) || dot.startsWith(q) || String(item.inches).startsWith(q) || item.detail.replace(/"/g, '').startsWith(q);
  });
  const rank = item => {
    if (item.kind === 'gauge' && compact === String(item.gauge)) return 0;
    if (item.value.toLowerCase().replace(/\s/g, '') === compact) return 1;
    return 2;
  };
  return hits.sort((a, b) => rank(a) - rank(b) || b.inches - a.inches);
}

/** Inches from a fraction, a decimal, or a gauge ("10", "10 ga", "10 gauge").
 *  A whole number that is on the gauge chart is that gauge, not that many inches:
 *  this press tops out at 1" plate, and "10" in the shop means 10 gauge. */
export function parseThickness(str, materialId = 'steel') {
  const text = String(str ?? '').trim();
  let m = text.match(/^(\d{1,2})\s*(ga|gauge)$/i);
  if (!m) m = text.match(/^(\d{1,2})$/);
  if (m) {
    const row = gaugeRows(materialId).find(r => r.ga === +m[1]);
    if (row) return row.inches;
    if (/ga/i.test(text)) return NaN;
  }
  return parseInches(text);
}

/** Readable line for the current thickness, naming a gauge when the decimal matches one. */
export function describeThickness(str, materialId = 'steel') {
  const inches = parseThickness(str, materialId);
  if (!(inches > 0)) return '';
  const family = GAUGE_IN[materialId] ? materialId : 'steel';
  const typed = String(str ?? '').trim().toLowerCase().replace(/"/g, '');
  const names = [];
  for (const item of thicknessOptions(materialId)) {
    if (Math.abs(item.inches - inches) > 0.00015) continue;
    if (!names.includes(item.label)) names.push(item.label);
  }
  names.sort((a, b) => {
    const am = a.toLowerCase().replace(/"/g, '') === typed;
    const bm = b.toLowerCase().replace(/"/g, '') === typed;
    return (bm ? 1 : 0) - (am ? 1 : 0);
  });
  const dec = formatInches(inches);
  const gauge = names.some(n => /ga/.test(n));
  const head = names.length ? `${names.join(' · ')} · ` : '';
  return `${head}${dec}${gauge ? ` · ${family} gauge` : ''}`;
}

/** Station-limit checks against optional machine fields (e.g. Edwards spec sheet). Returns warning strings. */
export function machineLimitWarnings(machine, { shape, dims, thickness }) {
  const w = [];
  if (!machine) return w;
  if (machine.punchMaxThk && thickness > machine.punchMaxThk + 1e-9)
    w.push(`Thickness ${thickness}" is over the ${machine.name} punch max of ${machine.punchMaxThk}" (${machine.punchMaxNote || 'spec'})`);
  if (machine.punchMaxDia && shape === 'round' && dims.d > machine.punchMaxDia + 1e-9)
    w.push(`Diameter ${dims.d}" is over the ${machine.name} punch max of ${machine.punchMaxDia}" (${machine.punchMaxNote || 'spec'})`);
  return w;
}
