// Tiny localStorage wrapper (device-only persistence). Replace with server storage in the larger app.
const P = 'empro-ironworker:';
export const load = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const save = (k, v) => localStorage.setItem(P + k, JSON.stringify(v));
