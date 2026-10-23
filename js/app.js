import * as C from './calc.js';
import * as T from './tooling.js';
import { loadData } from './data.js';
import * as S from './store.js';

const $ = s => document.querySelector(s);
const D = await loadData();
const params = new URLSearchParams(location.search);
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fr = x => C.toFraction(x);
const num = (x, d = 4) => (+x).toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
const srcLinks = list => list.map(s => s.url ? `<a href="${h(s.url)}" target="_blank" rel="noopener">${h(s.label)}</a>` : h(s.label)).join(' · ');

// ---------- state (device overrides merged over spreadsheet / default data)
let toolOv = S.load('toolingOverrides', T.emptyOverrides());
let machOv = S.load('machineOverrides', T.emptyOverrides());
const tooling = () => T.mergeTooling(D.tooling.items, toolOv);
const machines = () => T.mergeById(D.machines.machines, machOv);
let machineId = S.load('machineId', D.machines.defaultMachineId);
const machine = () => machines().find(m => m.id === machineId) || machines()[0];
const saveTools = ov => { toolOv = ov; S.save('toolingOverrides', ov); refreshAll(); };
const saveMachs = ov => { machOv = ov; S.save('machineOverrides', ov); refreshAll(); };
function refreshAll() { renderMachineSelect(); calcJob(); renderQ(); footer(); }
function footer() { $('#foot').textContent = `Data: ${D.tooling.items.length} tooling items from Nick's sheet, ${Object.keys(toolOv.upserts).length} added/edited and ${toolOv.removed.length} removed on this device. Works offline after the first load.`; }

// ---------- tabs
document.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === b.dataset.tab));
  S.save('tab', b.dataset.tab);
});
const legacyTab = t => (t === 'tonnage' || t === 'punchdie' ? 'punch' : t);
document.querySelector(`[data-tab=${legacyTab(params.get('tab') || S.load('tab', 'punch'))}]`)?.click();

for (const sel of ['#jMat']) $(sel).innerHTML = D.materials.materials.map(m => `<option value="${m.id}">${m.name} (${m.shearPsi / 1000} ksi)</option>`).join('');
$('#sizeList').innerHTML = D.sizes.sizes.map(s => `<option value="${s.label.replace('"', '')}">${s.in}</option>`).join('');

function seg(el, cb) {
  el.querySelectorAll('button').forEach(b => b.onclick = () => { setSeg(el, b.dataset.v); cb?.(b.dataset.v); });
  return () => el.querySelector('.on').dataset.v;
}
const setSeg = (el, v) => el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
const label = i => i.shape === 'oblong' ? `${fr(i.size)} × ${fr(i.length)}` : i.size ? fr(i.size) : '—';
const stockBadge = list => list.length
  ? `<span class="badge ok">IN STOCK</span> ${list.map(i => `<b>${h(i.group)}</b>${i.qty ? ` ×${i.qty}` : ''}${i.location ? ` @ ${h(i.location)}` : ''}`).join(', ')}`
  : `<span class="badge no">NOT IN STOCK</span>`;

// ---------- machines
function renderMachineSelect() {
  const ms = machines();
  if (!ms.find(m => m.id === machineId)) machineId = ms[0]?.id;
  $('#jMachine').innerHTML = ms.map(m => `<option value="${m.id}" ${m.id === machineId ? 'selected' : ''}>${h(m.name)}: ${m.ratedTons} tons</option>`).join('');
}
$('#jMachine').onchange = e => { machineId = e.target.value; S.save('machineId', machineId); calcJob(); };
let mEditing = null;
function renderMachList() {
  $('#mList').innerHTML = machines().map(m => `<div class="mrow"><div><b>${h(m.name)}</b>: ${m.ratedTons} t${m.punchMaxDia ? ` · punch ≤ ${fr(m.punchMaxDia)} dia` : ''}${m.punchMaxThk ? ` · ≤ ${fr(m.punchMaxThk)} thk` : ''}
    ${m.angleShear ? `<div class="sources">Flat bar shear ${h(m.flatBarShear)} · Round/square bar ${fr(m.roundBarShearMax)}/${fr(m.squareBarShearMax)} · Angle shear ${h(m.angleShear)} · Coper notcher ${h(m.coperNotcher)} · Throat ${m.throatDepth}"</div>` : ''}
    ${m.sources ? `<div class="sources">Specs: ${srcLinks(m.sources)}</div>` : ''}</div>
    <div class="row"><button type="button" class="btn" data-edit="${m.id}">Edit</button><button type="button" class="btn danger" data-del="${m.id}">Remove</button></div></div>`).join('') || '<p class="muted">No machines. Add one below.</p>';
  $('#mList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editMach(b.dataset.edit));
  $('#mList').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (machines().length <= 1) { $('#mErr').textContent = 'Keep at least one machine.'; return; }
    if (confirm('Remove this machine from this device?')) { saveMachs(T.removeItem(machOv, b.dataset.del, D.machines.machines)); renderMachList(); }
  });
}
function editMach(id) {
  const m = machines().find(x => x.id === id); mEditing = m?.id || null;
  $('#mEditTitle').textContent = m ? `Edit ${m.name}` : 'Add machine';
  $('#mName').value = m?.name || ''; $('#mTons').value = m?.ratedTons ?? '';
  $('#mDia').value = m?.punchMaxDia ?? ''; $('#mThk').value = m?.punchMaxThk ?? ''; $('#mErr').textContent = '';
}
$('#mManage').onclick = () => { renderMachList(); editMach(null); $('#machDlg').showModal(); };
$('#mNew').onclick = () => editMach(null);
$('#mClose').onclick = () => $('#machDlg').close();
$('#mSave').onclick = () => {
  const name = $('#mName').value.trim(), tons = parseFloat($('#mTons').value);
  const dia = C.parseInches($('#mDia').value), thk = C.parseInches($('#mThk').value);
  if (!name || !(tons > 0)) { $('#mErr').textContent = 'Name and rated tons (> 0) are required.'; return; }
  const id = mEditing || T.newId('mach');
  const prev = machines().find(m => m.id === id) || {};
  const m = { ...prev, id, name, ratedTons: tons, punchMaxDia: dia > 0 ? dia : null, punchMaxThk: thk > 0 ? thk : null };
  delete m.edited;
  saveMachs({ ...machOv, upserts: { ...machOv.upserts, [id]: m }, removed: machOv.removed.filter(r => r !== id) });
  machineId = id; S.save('machineId', id); renderMachineSelect(); renderMachList(); editMach(id);
};

// ---------- Punch (combined tonnage + punch & die)
const dimFields = {
  round: [['d', 'Hole diameter (in)', '11/16']],
  square: [['s', 'Side length (in)', '1/2']],
  oblong: [['w', 'Slot width (in)', '1/2'], ['l', 'Slot overall length (in)', '1']],
  rect: [['w', 'Width (in)', '1/2'], ['l', 'Length (in)', '1']],
  hex: [['af', 'Across flats (in)', '3/4']],
  custom: [['p', 'Cut perimeter (in)', '3']],
};
const shape = seg($('#jShape'), s => { renderDims(s); calcJob(); });
function renderDims(s) {
  $('#jDims').className = 'dims' + (dimFields[s].length > 1 ? ' two' : '');
  $('#jDims').innerHTML = dimFields[s].map(([k, l, v]) => `<label>${l}<input data-k="${k}" inputmode="decimal" value="${v}" ${k !== 'p' ? 'list="sizeList"' : ''}></label>`).join('');
  $('#jDims').querySelectorAll('input').forEach(i => i.oninput = calcJob);
}
let thkRefresh = () => {};
function bindThicknessCombo() {
  const input = $('#jThk'), menu = $('#thkMenu'), btn = $('#thkOpen');
  if (!input || !menu) return;
  let items = [], active = -1;
  const materialId = () => $('#jMat').value || 'steel';
  const norm = s => String(s ?? '').trim().toLowerCase().replaceAll('"', '');
  const same = (a, b) => norm(a) === norm(b);
  function setOpen(on) {
    menu.hidden = !on;
    const expanded = on ? 'true' : 'false';
    input.setAttribute('aria-expanded', expanded);
    btn?.setAttribute('aria-expanded', expanded);
  }
  function render(list, activeIndex, scroll) {
    items = list;
    active = activeIndex;
    menu.innerHTML = list.map((it, i) => `<li role="option" id="thkOpt${i}" data-i="${i}" ${i === active ? 'aria-selected="true"' : ''}><span>${h(it.label)}</span>${it.detail === it.label ? '' : `<span class="dec">${h(it.detail)}</span>`}</li>`).join('');
    setOpen(list.length > 0);
    if (active >= 0 && menu.children[active]) {
      input.setAttribute('aria-activedescendant', menu.children[active].id);
      if (scroll) menu.children[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function open(filtering) {
    const list = filtering ? C.filterThickness(input.value, materialId()) : C.thicknessOptions(materialId(), { common: true });
    let idx = -1;
    if (filtering) idx = list.length ? 0 : -1;
    else {
      const inches = C.parseThickness(input.value, materialId());
      idx = list.findIndex(it => same(it.value, input.value) || same(it.label, input.value) || (inches > 0 && Math.abs(it.inches - inches) < 0.00015));
    }
    render(list, idx);
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.value;
    input.dataset.dirty = '0';
    setOpen(false);
    calcJob();
  }
  function move(d) {
    const wasHidden = menu.hidden;
    if (wasHidden) open(input.dataset.dirty === '1');
    if (!items.length || (wasHidden && active >= 0)) return;
    const next = active < 0 ? (d > 0 ? 0 : items.length - 1) : (active + d + items.length) % items.length;
    render(items, next, true);
  }
  input.addEventListener('focus', () => { input.dataset.dirty = '0'; open(false); });
  input.addEventListener('input', () => { input.dataset.dirty = '1'; open(true); calcJob(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && !menu.hidden && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('blur', () => setOpen(false));
  menu.addEventListener('pointerdown', e => {
    const li = e.target.closest('[role=option]');
    if (!li) return;
    e.preventDefault();
    pick(+li.dataset.i);
  });
  btn?.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!menu.hidden) { setOpen(false); return; }
    input.dataset.dirty = '0';
    input.focus();
    open(false);
  });
  thkRefresh = () => { if (!menu.hidden) open(input.dataset.dirty === '1'); };
}
bindThicknessCombo();
$('#jMat').oninput = () => { calcJob(); thkRefresh(); };
const openState = S.load('openSections', {});
const details = (key, title, body) => `<details class="card fold" data-key="${key}" ${openState[key] ? 'open' : ''}><summary>${title}</summary>${body}</details>`;

const dimTxt = (s, d) => s === 'oblong' || s === 'rect' ? `${fr(d.w)} × ${fr(d.l)}` : s === 'hex' ? `${fr(d.af)} AF` : fr(d.d ?? d.s);
function toolBox(lbl, sizeTxt, decTxt, stockHtml, extra = '') {
  return `<div><span class="lbl">${lbl}</span><div class="big">${sizeTxt}</div><div class="muted">${decTxt}</div><div>${stockHtml}</div>${extra}</div>`;
}

function punchDieBlock(s, dims, thk, mat, list) {
  const alts = a => a.length ? a.map(i => `${fr(i.size)} (${h(i.group)})`).join(', ') : 'none';
  if (s === 'round') {
    const r = C.recommend({ hole: dims.d, thickness: thk, material: mat }, D.materials, list);
    return { r, html: `<div class="pair">
      ${toolBox('Punch', fr(r.punch), num(r.punch) + '"', stockBadge(r.punchStock), r.punchStock.length ? '' : `<p class="muted">Nearest punches in stock: below ${alts(r.punchAlternatives.below)}; above ${alts(r.punchAlternatives.above)}</p>`)}
      ${toolBox('Die', fr(r.die), num(r.die) + '"', stockBadge(r.dieStock), r.dieStock.length ? '' : `<p class="muted">Nearest dies in stock: ${r.dieAlternatives.length ? r.dieAlternatives.map(i => `${fr(i.size)} ${h(i.group)} (${(i.clearancePct * 100).toFixed(0)}% clr)`).join(', ') : 'none within ±1/16"'}</p>`)}
    </div>` };
  }
  if (s === 'custom') return { html: '<p class="muted">Punch and die sizing needs a standard shape. Custom-perimeter tooling isn\'t tracked.</p>' };
  // Non-round: INDUSTRY assumption, same total clearance added to each dimension.
  const keys = s === 'square' ? ['s'] : s === 'hex' ? ['af'] : ['w', 'l'];
  const die = {}; let r;
  for (const k of keys) { r = C.dieSize(dims[k], thk, mat, D.materials); die[k] = r.die; }
  const tracked = (s === 'square' || s === 'oblong') && list.some(i => i.shape === s);
  let pS = [], dS = [];
  if (tracked) {
    pS = C.findStock(list, 'punch', s === 'square' ? dims.s : dims.w, s, s === 'oblong' ? dims.l : undefined);
    dS = C.findStock(list, 'die', s === 'square' ? die.s : die.w, s, s === 'oblong' ? die.l : undefined);
  }
  const nt = '<span class="badge na">NOT TRACKED</span>';
  return { r: { ...r, punch: dims[keys[0]], clearanceTotal: die[keys[0]] - dims[keys[0]] }, html: `<div class="pair">
    ${toolBox('Punch', dimTxt(s, dims), C.SHAPES[s].name, tracked ? stockBadge(pS) : nt)}
    ${toolBox('Die', dimTxt(s, die), `${C.SHAPES[s].name} <span class="tag">INDUSTRY</span>`, tracked ? stockBadge(dS) : nt)}
  </div>
  <p class="hint">${tracked ? `${C.SHAPES[s].name} stock comes from tooling added on this device.` : `${C.SHAPES[s].name} tooling isn't in the sheet. Add it on the Tooling tab to track it${s === 'square' || s === 'oblong' ? '' : ' (only round, square, oblong and other shapes can be added)'}.`} Die = each dimension plus the same total clearance (industry practice, not from the sheet).</p>` };
}

function calcJob() {
  const s = shape(), dims = {};
  $('#jDims').querySelectorAll('input').forEach(i => dims[i.dataset.k] = C.parseInches(i.value));
  const mat = $('#jMat').value, thk = C.parseThickness($('#jThk').value, mat), m = machine(), out = $('#jResult');
  const thkNow = $('#thkNow'); if (thkNow) thkNow.textContent = C.describeThickness($('#jThk').value, mat);
  if (Object.values(dims).some(v => !(v > 0)) || !(thk > 0)) { out.innerHTML = '<div class="card"><p class="muted">Enter the hole size and material thickness.</p></div>'; return; }
  let t; try { t = C.tonnage({ shape: s, dims, thickness: thk, material: mat }, D.materials); }
  catch (e) { out.innerHTML = `<div class="card"><p class="badge no">${h(e.message)}</p></div>`; return; }
  const chk = C.capacityCheck(t.tons, m?.ratedTons, D.machines.warnAtFraction);
  const lim = C.machineLimitWarnings(m, { shape: s, dims, thickness: thk });
  const pct = chk.pct == null ? 0 : Math.min(chk.pct, 1.2) / 1.2 * 100;
  const pd = punchDieBlock(s, dims, thk, mat, tooling());
  const r = pd.r;
  const sheetMult = C.clearanceMultiplier(mat, thk, D.materials, 'sheet');
  const station = m && (m.punchMaxDia || m.punchMaxThk) ? `${h(m.name)} punch station: ${m.punchMaxDia ? `max ${fr(m.punchMaxDia)} dia` : ''}${m.punchMaxThk ? ` in max ${fr(m.punchMaxThk)} plate` : ''}${m.punchMaxNote ? ` (${h(m.punchMaxNote)})` : ''}` : '';
  out.innerHTML = `
  <div class="card">
    <div class="tonrow"><div class="big">${t.tons.toFixed(1)} <small>tons required</small></div>
      <div class="status ${chk.status}">${chk.status === 'UNKNOWN' ? 'Pick a machine' : `${chk.status} · ${(chk.pct * 100).toFixed(0)}% of ${m.ratedTons} t`}</div></div>
    ${chk.pct != null ? `<div class="bar"><i style="width:${pct}%" class="${chk.status}"></i><em style="left:${D.machines.warnAtFraction / 1.2 * 100}%"></em><em style="left:${100 / 1.2}%"></em></div>` : ''}
    ${lim.length ? lim.map(w => `<p class="warnline bad">⚠ ${h(w)}</p>`).join('') : station ? `<p class="hint ok">✓ Within ${station}</p>` : ''}
    ${s === 'round' && dims.d < thk ? '<p class="warnline"><span class="tag">INDUSTRY</span> Hole is smaller than the material thickness. The punch could break.</p>' : ''}
  </div>
  <div class="card">${pd.html}
    ${r && r.clearanceTotal <= 1e-9 ? '<p class="warnline">Rounding to 1/32" leaves zero clearance at this thickness. The die equals the punch. Check before punching.</p>' : ''}
  </div>
  ${details('rule', `Clearance rule &amp; formulas <span class="muted">· ${r ? (r.multiplier * 100).toFixed(0) + '% of thickness' : 'tonnage only'}</span>`, `<dl>
      ${r ? `<dt>Clearance rule</dt><dd>${(r.multiplier * 100).toFixed(0)}% of thickness, total ${Math.abs(sheetMult - r.multiplier) > 1e-9 ? `<span class="tag">INDUSTRY</span> (sheet had ${(sheetMult * 100).toFixed(0)}%, typo confirmed by Nick)` : '(sheet O3)'}</dd>
      <dt>Die calc</dt><dd>MROUND(${num(thk)} × ${r.multiplier} + ${num(r.punch)}, 1/32) = ${num(r.punch + r.clearanceTotal, 5)}" (sheet P3)</dd>
      <dt>Actual clearance</dt><dd>${num(r.clearanceTotal, 4)}" total (${num(r.clearanceTotal / 2, 4)}" per side)</dd>` : ''}
      <dt>Tonnage</dt><dd>${t.shearPsi.toLocaleString()} psi × ${num(thk)}" × ${num(t.perimeter)}" perimeter ÷ 2000 · ${t.material}</dd>
      <dt>Tonnage source</dt><dd>${C.SHAPES[s].source === 'sheet' ? 'Your sheet (Q3: shear × thk × π × D ÷ 2000)' : `<span class="tag">INDUSTRY</span> Sheet Q3 using the shape's perimeter${s === 'hex' ? ' (hex = 2√3 × across flats)' : s === 'oblong' ? ' (slot = 2(L−W) + πW)' : ''}`}</dd>
      <dt>Stock rule</dt><dd>Punches from ${T.GROUPS.punch.join('/')}, dies from ${T.GROUPS.die.join('/')} (or custom groups). Includes edits made on this device.</dd>
    </dl>`)}
  ${details('sources', 'Sources &amp; notes', `<p class="sources">${h(D.machines.warnNote)}</p>
    <p class="sources">Clearance: ${srcLinks(D.materials.clearance.sources)}</p>
    <p class="sources">Tonnage: ${srcLinks(D.materials.tonnageSources)}</p>
    ${m?.sources ? `<p class="sources">${h(m.name)} specs: ${srcLinks(m.sources)}${m.specNotes ? `<br>${h(m.specNotes)}` : ''}</p>` : ''}
    ${(D.materials.clearance.review || []).map(x => `<p class="sources">• ${h(x)}</p>`).join('')}`)}`;
  out.querySelectorAll('details').forEach(d => d.ontoggle = () => { openState[d.dataset.key] = d.open; S.save('openSections', openState); });
}

// ---------- Tooling
const kind = seg($('#qKind'), renderQ);
$('#qSearch').oninput = renderQ;
$('#qNote').textContent = D.tooling.note;
function renderQ() {
  const q = $('#qSearch').value.trim().toLowerCase(), k = kind(), qn = C.parseInches(q);
  const rows = tooling().filter(i => (!k || i.kind === k) && (!q ||
    (qn > 0 ? Math.abs(i.size - qn) < 1e-6 || Math.abs((i.length ?? -1) - qn) < 1e-6 : false) ||
    `${i.sizeLabel || ''} ${i.group} ${i.kind} ${i.shape} ${i.location} ${i.notes}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.size ?? 99) - (b.size ?? 99) || a.kind.localeCompare(b.kind));
  $('#qBody').innerHTML = rows.map(i => `<tr class="tap" data-id="${h(i.id)}"><td><b>${label(i)}</b><div class="muted">${i.size ? num(i.size, 5) : ''}</div></td><td>${i.kind}</td><td>${h(i.group)}</td><td>${i.shape}</td>
    <td>${i.inStock ? '<span class="badge ok">Available</span>' : '<span class="badge no">Out</span>'}</td><td>${i.qty ?? '—'}</td><td>${h(i.location) || '—'}</td><td class="notes">${h(i.notes)}</td>
    <td><span class="src ${i.edited ? 'edited' : i.source}">${i.edited ? 'edited' : i.source}</span></td></tr>`).join('')
    || '<tr><td colspan="9" class="muted">No tooling matches.</td></tr>';
  $('#qBody').querySelectorAll('tr.tap').forEach(tr => tr.onclick = () => openTool(tr.dataset.id));
}

// tooling editor
let editingId = null;
const fKind = seg($('#fKind'), () => fillGroups());
function fillGroups(sel) {
  const g = T.GROUPS[fKind()];
  $('#fGroup').innerHTML = g.map(x => `<option>${x}</option>`).join('') + '<option value="__custom">Custom…</option>';
  if (sel) { if (g.includes(sel)) $('#fGroup').value = sel; else { $('#fGroup').value = '__custom'; $('#fCustom').value = sel; } }
  $('#fCustomWrap').hidden = $('#fGroup').value !== '__custom';
}
$('#fGroup').onchange = () => { $('#fCustomWrap').hidden = $('#fGroup').value !== '__custom'; };
function shapeUI() {
  const s = $('#fShape').value;
  $('#fSizeLbl').textContent = { round: 'Diameter (in)', square: 'Side (in)', oblong: 'Width (in)', other: 'Size (in, optional)' }[s];
  $('#fLenWrap').hidden = s !== 'oblong';
}
$('#fShape').onchange = shapeUI;
function openTool(id) {
  const i = id ? tooling().find(x => x.id === id) : null; editingId = i?.id || null;
  $('#toolTitle').textContent = i ? `Edit ${i.kind} ${label(i)} (${i.group})` : 'Add tooling';
  setSeg($('#fKind'), i?.kind || 'punch'); fillGroups(i?.group || T.GROUPS[i?.kind || 'punch'][0]);
  $('#fShape').value = i?.shape || 'round'; shapeUI();
  $('#fSize').value = i?.size ? fr(i.size).replace(/["≈]/g, '') : ''; $('#fLen').value = i?.length ? fr(i.length).replace(/["≈]/g, '') : '';
  $('#fQty').value = i?.qty ?? ''; $('#fLoc').value = i?.location || ''; $('#fNotes').value = i?.notes || '';
  $('#fErr').textContent = '';
  $('#fDelete').hidden = !i; $('#fRevert').hidden = !(i && i.source === 'sheet' && i.edited);
  $('#toolDlg').showModal();
}
$('#qAdd').onclick = () => openTool(null);
$('#fCancel').onclick = () => $('#toolDlg').close();
$('#fSave').onclick = () => {
  const prev = editingId ? tooling().find(x => x.id === editingId) : {};
  const group = $('#fGroup').value === '__custom' ? $('#fCustom').value.trim() : $('#fGroup').value;
  const size = C.parseInches($('#fSize').value), len = C.parseInches($('#fLen').value), qtyS = $('#fQty').value.trim();
  const item = { ...prev, id: editingId || undefined, kind: fKind(), group, shape: $('#fShape').value,
    size: size > 0 ? size : null, length: $('#fShape').value === 'oblong' && len > 0 ? len : null,
    qty: qtyS === '' ? null : Number(qtyS), location: $('#fLoc').value.trim(), notes: $('#fNotes').value.trim(),
    inStock: qtyS === '' ? true : Number(qtyS) > 0, source: prev?.source || 'device' };
  if (item.size) item.sizeLabel = fr(item.size);
  try { saveTools(T.upsertItem(toolOv, item)); $('#toolDlg').close(); msg('Saved on this device.'); }
  catch (e) { $('#fErr').textContent = e.message; }
};
$('#fDelete').onclick = () => { if (confirm('Remove this item from the list on this device?')) { saveTools(T.removeItem(toolOv, editingId, D.tooling.items)); $('#toolDlg').close(); msg('Removed (on this device).'); } };
$('#fRevert').onclick = () => { saveTools(T.revertItem(toolOv, editingId)); $('#toolDlg').close(); msg('Reverted to the spreadsheet value.'); };
const msg = t => { $('#qMsg').textContent = t; };

// export / import
function download(name, text, type) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const stamp = () => new Date().toISOString().slice(0, 10);
$('#qExpJson').onclick = () => download(`empro-tooling-${stamp()}.json`, T.toJSON(tooling(), { overrides: toolOv }), 'application/json');
$('#qExpCsv').onclick = () => download(`empro-tooling-${stamp()}.csv`, T.toCSV(tooling()), 'text/csv');
$('#qImport').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const list = T.parseAny(await f.text(), f.name);
    const replace = $('#qReplace').checked;
    if (replace && !confirm(`Replace the whole tooling list on this device with ${list.length} imported items?`)) return;
    const r = T.importItems(toolOv, D.tooling.items, list, { replace });
    saveTools(r.overrides);
    msg(`Imported ${r.count} item(s)${r.errors.length ? `; skipped ${r.errors.length}: ${r.errors.slice(0, 3).join(' | ')}` : ''}.`);
  } catch (err) { msg('Import failed: ' + err.message); }
  e.target.value = '';
};

renderDims('round'); refreshAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' });
