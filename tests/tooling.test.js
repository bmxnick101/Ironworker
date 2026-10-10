import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../js/tooling.js';
import * as C from '../js/calc.js';

const base = JSON.parse(readFileSync(new URL('../data/tooling.json', import.meta.url))).items;
const materials = JSON.parse(readFileSync(new URL('../data/materials.json', import.meta.url)));

test('merge with no overrides = spreadsheet list', () => {
  assert.equal(T.mergeTooling(base, T.emptyOverrides()).length, 28);
});

test('add / edit / remove / revert', () => {
  let ov = T.emptyOverrides();
  ov = T.upsertItem(ov, { id: 'n1', kind: 'punch', group: 'F16', shape: 'round', size: 1, qty: 3, location: 'Drawer 2', notes: 'new' });
  let m = T.mergeTooling(base, ov);
  assert.equal(m.length, 29);
  assert.equal(C.findStock(m, 'punch', 1)[0].location, 'Drawer 2');           // stock check sees the addition
  ov = T.upsertItem(ov, { ...base.find(b => b.id === 'F16-23'), qty: 0 });     // 11/16 punch set to qty 0
  m = T.mergeTooling(base, ov);
  assert.equal(C.findStock(m, 'punch', 0.6875).length, 0);
  assert.equal(m.find(i => i.id === 'F16-23').edited, true);
  ov = T.removeItem(ov, 'F62-25', base);                                        // remove 3/4 die
  m = T.mergeTooling(base, ov);
  assert.equal(m.length, 28);
  const r = C.recommend({ hole: 0.6875, thickness: 0.25, material: 'Stainless Steel' }, materials, m);
  assert.equal(r.dieStock.length, 0); assert.equal(r.punchStock.length, 0);
  ov = T.revertItem(T.revertItem(ov, 'F62-25'), 'F16-23');
  m = T.mergeTooling(base, ov);
  const r2 = C.recommend({ hole: 0.6875, thickness: 0.25, material: 'Stainless Steel' }, materials, m);
  assert.equal(r2.dieStock.length, 1); assert.equal(r2.punchStock.length, 1);
  ov = T.removeItem(ov, 'n1', base);                                            // device item fully deleted
  assert.equal(T.mergeTooling(base, ov).length, 28); assert.equal(ov.removed.includes('n1'), false);
});

test('validation: punch groups F16/F26, die groups F55/F62, custom allowed', () => {
  assert.deepEqual(T.GROUPS, { punch: ['F16', 'F26'], die: ['F55', 'F62'] });
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'punch', group: 'F55', size: 0.5 }), /die group/);
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'punch', group: 'f62', size: 0.5 }), /die group/);
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'F26', size: 0.5 }), /punch group/);
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'F16', size: 0.5 }), /punch group/);
  assert.doesNotThrow(() => T.upsertItem(T.emptyOverrides(), { kind: 'punch', group: 'F26', size: 0.5 }));
  assert.doesNotThrow(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'F55', size: 0.5 }));
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'F62', size: 0 }), /Size/);
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'F62', shape: 'oblong', size: 0.5, length: 0.25 }), /length/);
  assert.throws(() => T.upsertItem(T.emptyOverrides(), { kind: 'tool', group: 'X', size: 1 }), /punch or die/);
  assert.doesNotThrow(() => T.upsertItem(T.emptyOverrides(), { kind: 'die', group: 'Oversize 28XX', size: 2 }));
  assert.doesNotThrow(() => T.upsertItem(T.emptyOverrides(), { kind: 'punch', group: 'F26', shape: 'other', notes: 'teardrop' }));
});

test('non-round stock check by shape', () => {
  const ov = T.upsertItem(T.emptyOverrides(), { kind: 'punch', group: 'F16', shape: 'square', size: 0.5 });
  const m = T.mergeTooling(base, ov);
  assert.equal(C.findStock(m, 'punch', 0.5, 'square').length, 1);
  assert.equal(C.findStock(m, 'punch', 0.5).filter(i => i.shape === 'square').length, 0); // round lookup ignores squares
});

test('CSV export -> import round trip (quotes, commas, newlines)', () => {
  let ov = T.upsertItem(T.emptyOverrides(), { id: 'n2', kind: 'die', group: 'F62', shape: 'oblong', size: 0.5, length: 1, qty: 1, location: 'Rack "A", shelf 2', notes: 'line1\nline2' });
  const list = T.mergeTooling(base, ov);
  const csv = T.toCSV(list);
  const rows = T.parseCSV(csv);
  assert.equal(rows.length, 29);
  const n2 = rows.find(r => r.id === 'n2');
  assert.equal(n2.location, 'Rack "A", shelf 2'); assert.equal(n2.notes, 'line1\nline2');
  const r = T.importItems(T.emptyOverrides(), base, rows, { replace: true });
  assert.equal(r.errors.length, 0);
  const merged = T.mergeTooling(base, r.overrides);
  assert.equal(merged.length, 29);
  const back = merged.find(i => i.id === 'n2');
  assert.equal(back.length, 1); assert.equal(back.shape, 'oblong'); assert.equal(back.qty, 1);
  assert.equal(merged.find(i => i.id === 'F55-36').qty, 2);
});

test('JSON export/import; replace mode drops items not imported; bad rows reported', () => {
  const json = T.toJSON([{ id: 'x1', kind: 'punch', group: 'F16', size: 0.25 }, { kind: 'punch', group: 'F55', size: 0.3 }]);
  const items = T.parseAny(json, 'backup.json');
  const r = T.importItems(T.emptyOverrides(), base, items, { replace: true });
  assert.equal(r.count, 1); assert.equal(r.errors.length, 1);
  const m = T.mergeTooling(base, r.overrides);
  assert.equal(m.length, 1); assert.equal(m[0].source, 'import');
  const r2 = T.importItems(T.emptyOverrides(), base, items, { replace: false });            // merge mode keeps sheet
  assert.equal(T.mergeTooling(base, r2.overrides).length, 29);
  assert.equal(T.parseAny('id,kind,group,shape,size\na,die,F55,round,1-1/8', 'x.csv')[0].size, '1-1/8');
});

test('machines use the same merge (add/edit/remove)', () => {
  const baseM = JSON.parse(readFileSync(new URL('../data/machines.json', import.meta.url))).machines;
  let ov = { version: 1, upserts: { p50: { id: 'p50', name: 'Piranha P-50', ratedTons: 50 }, 'edwards-120t': { ratedTons: 110 } }, removed: [] };
  let m = T.mergeById(baseM, ov);
  assert.equal(m.length, 2); assert.equal(m[0].ratedTons, 110); assert.equal(m[0].name, 'Edwards 120T');
  m = T.mergeById(baseM, T.removeItem(ov, 'edwards-120t', baseM));
  assert.deepEqual(m.map(x => x.id), ['p50']);
});
