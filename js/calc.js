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
