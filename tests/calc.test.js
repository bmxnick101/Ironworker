import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../js/calc.js';

const j = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const materials = j('../data/materials.json');
const tooling = j('../data/tooling.json');
const fx = j('./fixtures.json');
const machines = j('../data/machines.json');
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("matches cached values in Nick's sheet (row 3)", () => {
  const c = fx.cachedFromNicksFile;
  close(C.clearanceMultiplier(c.material, c.thickness, materials), c.multiplier);          // stainless: unchanged in app
  close(C.clearanceMultiplier(c.material, c.thickness, materials, 'sheet'), c.multiplier);
  close(C.dieSize(c.punch, c.thickness, c.material, materials).die, c.die);
  close(C.tonnage({ shape: 'round', dims: { d: c.punch }, thickness: c.thickness, material: c.material }, materials).tons, c.tons, 1e-6);
});

test(`matches his O3/P3/Q3 formulas recalculated over ${fx.recalculatedWithHisFormulas.length} input combos`, () => {
  for (const r of fx.recalculatedWithHisFormulas) {
    // 'sheet' table reproduces his O3/P3 exactly for every material
    close(C.clearanceMultiplier(r.material, r.thickness, materials, 'sheet'), r.multiplier);
    close(C.dieSize(r.punch, r.thickness, r.material, materials, 'sheet').die, r.die);
    // in-app (active) table is identical for Steel and Stainless
    if (r.material !== 'Aluminum') {
      close(C.clearanceMultiplier(r.material, r.thickness, materials), r.multiplier);
      close(C.dieSize(r.punch, r.thickness, r.material, materials).die, r.die);
    }
    close(C.tonnage({ shape: 'round', dims: { d: r.punch }, thickness: r.thickness, material: r.material }, materials).tons, r.tons, 1e-9);
  }
});

test('unknown material falls into Steel (else) branch like the sheet', () => {
  assert.equal(C.getMaterial(materials, 'Brass').name, 'Steel');
});

test('mround behaves like Excel', () => {
  close(C.mround(0.7625, 1 / 32), 0.75);
  close(C.mround(0.765625, 1 / 32), 0.78125); // exact half rounds up
});

test('industry perimeters for non-round shapes', () => {
  close(C.perimeter('square', { s: 1 }), 4);
  close(C.perimeter('rect', { l: 2, w: 1 }), 6);
  close(C.perimeter('oblong', { l: 1.5, w: 0.5 }), 2 + Math.PI * 0.5);
  close(C.perimeter('oblong', { l: 0.5, w: 0.5 }), Math.PI * 0.5); // slot == round when l == w
});

test('rule-of-thumb: mild steel round ≈ dia*thk*80 (sheet uses 60 ksi -> dia*thk*94.25)', () => {
  const t = C.tonnage({ shape: 'round', dims: { d: 1 }, thickness: 1, material: 'Steel' }, materials).tons;
  close(t, 30 * Math.PI, 1e-9);
});

test('capacity check', () => {
  assert.equal(C.capacityCheck(10, 50).status, 'PASS');
  assert.equal(C.capacityCheck(45, 50).status, 'WARN');
  assert.equal(C.capacityCheck(55, 50).status, 'FAIL');
  assert.equal(C.capacityCheck(55, null).status, 'UNKNOWN');
});

test('aluminum clearance: Nick-approved industry values (Mate) replace sheet O3; typo gone', () => {
  const al = t => C.clearanceMultiplier('Aluminum', t, materials);
  close(al(0.0625), 0.15); close(al(0.125), 0.20); close(al(0.25), 0.25); close(al(0.375), 0.25); close(al(0.5), 0.25); close(al(1), 0.25);
  close(C.clearanceMultiplier('Aluminum', 0.375, materials, 'sheet'), 0.12); // original typo still recorded
  const steps = materials.clearance.steps.map(s => s.aluminum).reverse();
  for (let k = 1; k < steps.length; k++) assert.ok(steps[k] >= steps[k - 1], 'aluminum non-decreasing with thickness');
  close(C.dieSize(0.5, 0.25, 'Aluminum', materials).die, 0.5625); // .25*.25+.5=.5625 -> 9/16
});

test('group kinds match sheet headers: F16/F26 punches, F55/F62 dies', () => {
  const k = g => [...new Set(tooling.items.filter(i => i.group === g).map(i => i.kind))];
  assert.deepEqual(k('F16'), ['punch']); assert.deepEqual(k('F26'), ['punch']);
  assert.deepEqual(k('F55'), ['die']); assert.deepEqual(k('F62'), ['die']);
  for (const g of tooling.groups) assert.equal(g.kind, g.headerSays, `${g.code} kind matches header`);
});

test('stock lookup uses sheet data with corrected groups', () => {
  const r = C.recommend({ hole: 0.6875, thickness: 0.25, material: 'Stainless Steel' }, materials, tooling);
  close(r.die, 0.75);
  assert.equal(r.punchStock[0].group, 'F16');      // B23 X 11/16"
  assert.equal(r.dieStock[0].group, 'F62');        // H25 X 3/4"
  const d = C.findStock(tooling, 'die', 1.09375);    // F36 "X (2)" = F55 die
  assert.equal(d[0].group, 'F55'); assert.equal(d[0].qty, 2);
  assert.equal(C.findStock(tooling, 'punch', 1.09375).length, 0);
  assert.equal(C.findStock(tooling, 'punch', 1.125)[0].group, 'F26'); // D37 1-1/8" = F26 punch
  assert.equal(C.findStock(tooling, 'die', 1.125).length, 0);
  assert.equal(C.findStock(tooling, 'die', 0.21875)[0].group, 'F55'); // F8 7/32" die
  assert.equal(C.findStock(tooling, 'punch', 0.21875).length, 0);
  const r2 = C.recommend({ hole: 0.1875, thickness: 0.125, material: 'Steel' }, materials, tooling); // 3/16 punch in 1/8 steel
  close(r2.die, 0.21875); assert.equal(r2.punchStock[0].group, 'F16'); assert.equal(r2.dieStock[0].group, 'F55');
});

test('hexagon + custom perimeter', () => {
  close(C.perimeter('hex', { af: 1 }), 6 / Math.sqrt(3));
  close(C.perimeter('custom', { p: 3.5 }), 3.5);
  const t = C.tonnage({ shape: 'hex', dims: { af: 0.75 }, thickness: 0.25, material: 'Steel' }, materials).tons;
  close(t, 60000 * 0.25 * 2 * Math.sqrt(3) * 0.75 / 2000);
});

test('machines: Edwards 120T default + station limits', () => {
  const m = machines.machines.find(x => x.id === machines.defaultMachineId);
  assert.equal(m.name, 'Edwards 120T'); assert.equal(m.ratedTons, 120);
  assert.equal(C.capacityCheck(90, m.ratedTons).status, 'PASS');
  assert.equal(C.capacityCheck(100, m.ratedTons).status, 'WARN');
  assert.equal(C.capacityCheck(121, m.ratedTons).status, 'FAIL');
  assert.equal(C.machineLimitWarnings(m, { shape: 'round', dims: { d: 1.5 }, thickness: 1 }).length, 0);
  assert.equal(C.machineLimitWarnings(m, { shape: 'round', dims: { d: 1.5625 }, thickness: 1.125 }).length, 2);
  assert.ok(m.sources.length >= 1 && m.sources.every(s => /^https?:/.test(s.url)));
});

test('fraction parse/format', () => {
  close(C.parseInches('1-3/32'), 1.09375);
  close(C.parseInches('11/16"'), 0.6875);
  close(C.parseInches('.25'), 0.25);
  assert.ok(Number.isNaN(C.parseInches('abc')));
  assert.equal(C.toFraction(1.09375), '1-3/32"');
  assert.equal(C.toFraction(0.75), '3/4"');
});
