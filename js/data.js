// Loads reusable JSON data (data/*.json). Swap this loader when embedding in the larger planner app.
const files = ['materials', 'tooling', 'sizes', 'machines'];
export async function loadData(base = './data/') {
  const out = {};
  await Promise.all(files.map(async f => { out[f] = await (await fetch(`${base}${f}.json`)).json(); }));
  return out;
}
