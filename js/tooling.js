// Pure tooling-inventory logic: merge spreadsheet data with on-device edits, validate, CSV/JSON import & export.
// No DOM or localStorage here, so it can be reused in the larger planner app.

export const GROUPS = { punch: ['F16', 'F26'], die: ['F55', 'F62'] }; // matches sheet headers; anything else = custom group
export const TOOL_SHAPES = ['round', 'square', 'oblong', 'other'];
export const CSV_COLUMNS = ['id', 'kind', 'group', 'shape', 'size', 'length', 'qty', 'location', 'notes', 'inStock', 'source'];

export const emptyOverrides = () => ({ version: 1, upserts: {}, removed: [] });

/** Generic: base list + {upserts:{id:obj}, removed:[id]} -> merged list. Used for tooling and machines. */
export function mergeById(base, ov = emptyOverrides()) {
  const removed = new Set(ov.removed || []);
  const ups = ov.upserts || {};
  const out = base.filter(b => !removed.has(b.id)).map(b => (ups[b.id] ? { ...b, ...ups[b.id], id: b.id, edited: true } : b));
  const baseIds = new Set(base.map(b => b.id));
  for (const [id, o] of Object.entries(ups)) if (!baseIds.has(id) && !removed.has(id)) out.push({ ...o, id });
  return out;
}

export const mergeTooling = (baseItems, ov) => mergeById(baseItems, ov).map(normalizeItem);

export function normalizeItem(i) {
  const num = v => (v === '' || v == null || Number.isNaN(+v) ? null : +v);
  const qty = num(i.qty);
  return {
    ...i,
    kind: String(i.kind || '').toLowerCase().trim(),
    group: String(i.group || '').trim(),
    shape: TOOL_SHAPES.includes(String(i.shape || 'round').toLowerCase()) ? String(i.shape || 'round').toLowerCase() : 'other',
    size: num(i.size), length: num(i.length), qty,
    location: i.location || '', notes: i.notes || '',
    inStock: i.inStock === false || i.inStock === 'false' || i.inStock === 'FALSE' || i.inStock === 0 ? false : qty === 0 ? false : true,
    source: i.source || 'device',
  };
}

export function validateItem(raw) {
  const i = normalizeItem(raw), e = [];
  if (!['punch', 'die'].includes(i.kind)) e.push('Type must be punch or die');
  if (!i.group) e.push('Group is required');
  const other = i.kind === 'punch' ? GROUPS.die : GROUPS.punch;
  if (other.includes(i.group.toUpperCase())) e.push(`${i.group} is a ${i.kind === 'punch' ? 'die' : 'punch'} group. ${i.kind === 'punch' ? 'Punches' : 'Dies'} must use ${GROUPS[i.kind].join(' or ')} or a custom group`);
  if (i.shape !== 'other' && !(i.size > 0)) e.push('Size must be a positive number (inches)');
  if (i.shape === 'oblong' && !(i.length >= i.size)) e.push('Oblong needs length >= width (size)');
  if (i.qty != null && (i.qty < 0 || !Number.isInteger(i.qty))) e.push('Quantity must be a whole number >= 0');
  return e;
}

let seq = 0;
export const newId = (prefix = 'dev') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Add or edit. Returns new overrides (immutable). Throws on invalid. */
export function upsertItem(ov, item) {
  const errs = validateItem(item);
  if (errs.length) throw new Error(errs.join('; '));
  const id = item.id || newId();
  const n = { ...normalizeItem({ ...item, id }) };
  delete n.edited;
  return { ...ov, upserts: { ...ov.upserts, [id]: n }, removed: (ov.removed || []).filter(r => r !== id) };
}

export function removeItem(ov, id, baseItems) {
  const ups = { ...ov.upserts }; delete ups[id];
  const isBase = baseItems.some(b => b.id === id);
  return { ...ov, upserts: ups, removed: isBase ? [...new Set([...(ov.removed || []), id])] : (ov.removed || []) };
}

/** Undo device edits/removal for one spreadsheet item. */
export function revertItem(ov, id) {
  const ups = { ...ov.upserts }; delete ups[id];
  return { ...ov, upserts: ups, removed: (ov.removed || []).filter(r => r !== id) };
}

/** Import items. replace=true makes the imported list the whole inventory. Invalid rows are skipped and reported. */
export function importItems(ov, baseItems, imported, { replace = false } = {}) {
  let next = replace ? { ...emptyOverrides(), removed: baseItems.map(b => b.id) } : { ...ov };
  const errors = [];
  imported.forEach((it, idx) => {
    try {
      const base = baseItems.find(b => b.id === it.id);
      next = upsertItem(next, base ? { ...it, source: base.source } : { ...it, source: it.source && it.source !== 'sheet' ? it.source : 'import' });
    } catch (e) { errors.push(`Row ${idx + 1}: ${e.message}`); }
  });
  return { overrides: next, errors, count: imported.length - errors.length };
}

// ---------- CSV / JSON
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = list => [CSV_COLUMNS.join(','), ...list.map(i => CSV_COLUMNS.map(c => esc(i[c])).join(','))].join('\r\n') + '\r\n';

export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (q) { if (c === '"') { if (text[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[k + 1] === '\n') k++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [hdr, ...body] = rows.filter(r => r.some(x => x.trim() !== ''));
  if (!hdr) return [];
  const h = hdr.map(x => x.trim());
  return body.map(r => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ''])));
}

export const toJSON = (list, extra = {}) => JSON.stringify({ format: 'empro-tooling', version: 1, exportedAt: new Date().toISOString(), ...extra, items: list }, null, 1);
export function parseJSON(text) {
  const d = JSON.parse(text);
  return Array.isArray(d) ? d : d.items || [];
}
export const parseAny = (text, name = '') => (/\.csv$/i.test(name) || !/^\s*[[{]/.test(text) ? parseCSV(text) : parseJSON(text));
