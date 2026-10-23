import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('gauge thickness follows the chart for the selected metal', () => {
  close(C.parseThickness('10 ga', 'steel'), 0.1345);
  close(C.parseThickness('10ga', 'steel'), 0.1345);
  close(C.parseThickness('10 gauge', 'steel'), 0.1345);
  close(C.parseThickness('10', 'steel'), 0.1345);
  close(C.parseThickness('10 ga', 'stainless'), 0.1406);
  close(C.parseThickness('10 ga', 'aluminum'), 0.1019);
  close(C.parseThickness('16 ga', 'steel'), 0.0598);
  close(C.parseThickness('16 ga', 'aluminum'), 0.0508);
  close(C.parseThickness('1/4', 'aluminum'), 0.25);
  close(C.parseThickness('1', 'steel'), 1);
  close(C.parseThickness('.25', 'steel'), 0.25);
  assert.ok(Number.isNaN(C.parseThickness('99 ga', 'steel')));
  assert.ok(Number.isNaN(C.parseThickness('abc', 'steel')));
});

test('thickness menu offers common gauges and plate, and filters as you type', () => {
  const common = C.filterThickness('', 'steel').map(i => i.label);
  for (const label of ['1"', '1/4"', '1/8"', '10 ga', '12 ga', '16 ga']) assert.ok(common.includes(label), label);
  assert.ok(!common.includes('24 ga'));
  assert.equal(common[0], '10 ga');
  assert.ok(common.indexOf('10 ga') < common.indexOf('1/4"'));
  assert.ok(common.indexOf('1/4"') < common.indexOf('1"'));

  const ten = C.filterThickness('10', 'steel');
  assert.equal(ten[0].label, '10 ga');
  assert.equal(ten[0].inches, 0.1345);
  assert.ok(!ten.some(i => i.label === '1/4"'));

  assert.ok(C.filterThickness('.1345', 'steel').some(i => i.label === '10 ga'));
  assert.ok(C.filterThickness('3/16', 'steel').some(i => i.label === '3/16"'));
  assert.ok(C.filterThickness('ga', 'aluminum').every(i => i.kind === 'gauge'));
  assert.equal(C.filterThickness('10 ga', 'aluminum')[0].inches, 0.1019);

  const odd = C.filterThickness('24', 'steel');
  assert.equal(odd[0].label, '24 ga');
  assert.equal(odd[0].inches, 0.0239);
});

test('describeThickness names the gauge for a bare decimal', () => {
  assert.match(C.describeThickness('.1345', 'steel'), /10 ga/);
  assert.match(C.describeThickness('.1345', 'steel'), /steel gauge/);
  assert.match(C.describeThickness('10 ga', 'aluminum'), /\.1019"/);
  assert.match(C.describeThickness('10 ga', 'aluminum'), /aluminum gauge/);
  assert.match(C.describeThickness('11 ga', 'stainless'), /1\/8"/);
  assert.match(C.describeThickness('1/4', 'steel'), /1\/4"/);
  assert.equal(C.describeThickness('nope', 'steel'), '');
});
