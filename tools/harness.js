/*
 * Runs src/plugin.js against a fake DOM and a fake `tintero` bridge, so the
 * data collection, graph building, force layout and live-refresh path can be
 * exercised without installing the plugin.
 *
 *   node tools/harness.js          a small project
 *   EMPTY=1 node tools/harness.js  a project with nothing in it
 *   BIG=1   node tools/harness.js  ~1000 nodes, for layout timing
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── fake canvas context ──────────────────────────────────────────────────────
const ctxCalls = { fill: 0, stroke: 0, fillText: 0, arc: 0 };
// Node radii are not visible in the DOM, so capture them as they are drawn.
// Only the first arc per node is the node body; the rest are selection rings.
let arcRadii = [];
// Where each node body was drawn, in screen pixels and draw order. A body is an
// arc that gets filled; the rings around selected and pinned nodes are stroked.
let bodies = [];
let lastArc = null;
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'arc') return (x, y, r) => { ctxCalls.arc++; arcRadii.push(r); lastArc = { x, y, r }; };
    if (k === 'fill') return () => { ctxCalls.fill++; if (lastArc) bodies.push(lastArc); lastArc = null; };
    if (k in ctxCalls) return () => { ctxCalls[k]++; };
    if (k === 'measureText') return () => ({ width: 40 });
    if (typeof t[k] === 'undefined') return () => {};
    return t[k];
  },
  set(t, k, v) { t[k] = v; return true; }
});

// ── fake DOM ─────────────────────────────────────────────────────────────────
function makeEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(),
    children: [], style: { setProperty(k, v) { this[k] = String(v); } },
    className: '', _text: '', title: '', type: '', value: '',
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    addEventListener(type, fn) { (this._ev || (this._ev = {}))[type] = fn; },
    removeEventListener() {},
    setAttribute(k, v) { (this._attr || (this._attr = {}))[k] = v; },
    getAttribute(k) { return (this._attr || {})[k] ?? null; },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { width: viewport.w, height: viewport.h, left: 0, top: 0 }; },
    focus() {}, select() {}, blur() {}
  };
  Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set() { this.children = []; } });
  Object.defineProperty(e, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); } });
  if (String(tag).toLowerCase() === 'canvas') e.getContext = () => ctxStub;
  return e;
}

const body = makeEl('div');
const document = {
  body,
  activeElement: null,
  createElement: makeEl,
  createTextNode: (t) => ({ _text: String(t), textContent: String(t) }),
  getElementById: (id) => findBy(body, n => n.id === id),
  addEventListener() {}, removeEventListener() {}
};

function findBy(node, pred) {
  if (pred(node)) return node;
  for (const c of node.children || []) { const r = findBy(c, pred); if (r) return r; }
  return null;
}
function collectText(node, out = []) {
  if (node._text) out.push(node._text);
  for (const c of node.children || []) collectText(c, out);
  return out;
}

// The size every fake element reports. Change it and fire the window's resize
// handlers to simulate the reader resizing the window.
const viewport = { w: 1280, h: 800 };

const rafQueue = [];
const sandboxWindow = {
  devicePixelRatio: 1,
  _ev: {},
  addEventListener(t, f) { (this._ev[t] || (this._ev[t] = [])).push(f); },
  removeEventListener(t, f) { this._ev[t] = (this._ev[t] || []).filter(x => x !== f); }
};

// ── fake project data ────────────────────────────────────────────────────────
const characters = [
  { id: 'c1', name: 'Mira Solvane', firstName: 'Mira', lastName: 'Solvane', createdAt: 1, tags: ['pov', 'protagonist'],
    birthplace: 'w-loc1',
    relationships: [{ characterId: 'c2', type: 'sister', isBidirectional: true, inverseType: 'brother' },
                    { characterId: 'c3', type: 'rival' }],
    color: '#c98a48',
    worldbuilding: { factions: ['w-fac1'], locations: ['w-loc1'], itemOwner: ['w-item1'], eventParticipant: ['w-ev1'],
      factionLeader: ['w-fac1'], locationRuler: ['w-loc1'] } },
  { id: 'c2', name: 'Deren Solvane', createdAt: 1, tags: ['pov'],
    relationships: [{ characterId: 'c1', type: 'brother' }],
    worldbuilding: { factions: ['w-fac1'], groupMember: ['w-grp1'] } },
  // Heavily written-up: drives "size by length" for a non-file node.
  { id: 'c3', name: 'The Warden', aka: ['Warden of Ash'], createdAt: 1,
    backstory: 'The Warden kept the gate for forty years and never once opened it, ' +
      'not for the Ember Court, not for the dying, not for the child who came at dawn ' +
      'asking after a father who had already gone through. '.repeat(6),
    psychologicalDescription: 'Patient past the point of cruelty.',
    goals: ['Hold the gate', 'Outlive the oath'],
    worldbuilding: { deityFollower: ['w-dei1'] } },
  { id: 'c4', name: 'Unlinked Person', createdAt: 1 }
];

const world = [
  { id: 'w-loc1', name: 'Ashfall', type: 'location', createdAt: 1, tags: ['ruins'] },
  { id: 'w-fac1', name: 'The Ember Court', type: 'faction', createdAt: 1 },
  { id: 'w-grp1', name: 'Nightwatch', type: 'group', createdAt: 1 },
  { id: 'w-item1', name: 'Cinder Key', type: 'item', createdAt: 1,
    extraFields: [{ key: 'kept at', value: 'Ashfall' }] },
  { id: 'w-ev1', name: 'The Long Burning', type: 'event', createdAt: 1 },
  { id: 'w-dei1', name: 'Saint Ember', type: 'deity', createdAt: 1 },
  { id: 'w-x1', name: 'Ledger of Debts', type: 'tpl-custom', createdAt: 1 }
];

const files = [
  { id: 'f1', name: 'chapter-one.md', title: 'Chapter One', location: 'Manuscript/Act I/chapter-one.md',
    treePath: 'Manuscript/Act I/chapter-one', createdAt: 1, lastModified: 2, wordNumber: 2400,
    links: ['Chapter Two', '[[Ashfall|the ruins]]'], keywords: ['draft'] },
  { id: 'f2', name: 'chapter-two.md', title: 'Chapter Two', location: 'Manuscript/Act I/chapter-two.md',
    treePath: 'Manuscript/Act I/chapter-two', createdAt: 1, lastModified: 2, wordNumber: 1800,
    links: ['chapter-one.md'], customMetadata: { pov: 'Mira Solvane' } },
  { id: 'f3', name: 'chapter-three.md', title: 'Chapter Three', location: 'Manuscript/Act II/chapter-three.md',
    treePath: 'Manuscript/Act II/chapter-three', createdAt: 1, lastModified: 2 }
];

const folders = [
  { id: 'fo1', title: 'Manuscript', treePath: 'Manuscript' },
  { id: 'fo2', title: 'Act I', treePath: 'Manuscript/Act I' },
  { id: 'fo3', title: 'Act II', treePath: 'Manuscript/Act II' }
];

const docs = [
  { id: 'd1', name: 'research', title: 'Ember lore', location: 'Notes/research', treePath: 'Notes/research',
    createdAt: 1, lastModified: 2, links: ['Saint Ember'], keywords: ['lore'] },
  // A document attached to a character. The host files these under a virtual
  // root with the owner's id as the next segment, exactly as observed in Tintero.
  { id: 'd2', name: 'Test document 1', title: 'Test document 1', location: 'd2',
    treePath: '*characters*/c1/new file', createdAt: 1, lastModified: 2, links: [] },
  // Same shape for a worldbuilding element, to prove the rule generalises.
  { id: 'd3', name: 'Ashfall notes', title: 'Ashfall notes', location: 'd3',
    treePath: '*worldbuilding*/w-loc1/notes', createdAt: 1, lastModified: 2, links: [] },
  // A real folder that happens to share a character's name must NOT link.
  { id: 'd4', name: 'decoy', title: 'Decoy', location: 'x',
    treePath: 'The Warden/decoy', createdAt: 1, lastModified: 2, links: [] }
];

const scenes = {
  f1: [{ id: 's1', povCharacterId: 'c1', charactersInScene: ['c2', 'c3'], objectsInScene: ['w-item1'],
         type: 'main_continuity', locationId: 'w-loc1', createdAt: 1, updatedAt: 1 }],
  f2: [{ id: 's2', povCharacterId: 'c2', charactersInScene: ['c1'], type: 'flashback',
         locationId: 'w-loc1', createdAt: 1, updatedAt: 1 }],
  f3: []
};

let extraRelationship = false;
let extraCharacter = false;
let slowRead = 0;    // ms the next getCharacters() takes
let slowWrite = 0;   // ms the next storage.set() takes

if (process.env.BIG) {
  const NC = 400, NF = 300, NW = 300;
  characters.length = 0; files.length = 0; world.length = 0; docs.length = 0;
  for (const k of Object.keys(scenes)) delete scenes[k];
  for (let i = 0; i < NW; i++) {
    world.push({ id: 'w' + i, name: 'Element ' + i, createdAt: 1,
      type: ['location','faction','item','event','creature','deity'][i % 6],
      tags: ['t' + (i % 20)] });
  }
  for (let i = 0; i < NC; i++) {
    characters.push({ id: 'c' + i, name: 'Character ' + i, createdAt: 1, tags: ['t' + (i % 20)],
      relationships: [{ characterId: 'c' + ((i + 1) % NC), type: 'ally' },
                      { characterId: 'c' + ((i + 7) % NC), type: 'rival' },
                      { characterId: 'c' + ((i * 3 + 11) % NC), type: 'knows' }],
      worldbuilding: { factions: ['w' + (i % NW)], locations: ['w' + ((i * 5) % NW)] } });
  }
  for (let i = 0; i < NF; i++) {
    files.push({ id: 'f' + i, name: 'file-' + i + '.md', title: 'Chapter ' + i,
      location: 'M/Act ' + (i % 5) + '/file-' + i + '.md', treePath: 'M/Act ' + (i % 5) + '/file-' + i,
      createdAt: 1, lastModified: 2, wordNumber: 1000, keywords: ['t' + (i % 20)],
      links: ['Chapter ' + ((i + 1) % NF)] });
    scenes['f' + i] = [{ id: 's' + i, povCharacterId: 'c' + (i % NC), type: 'main_continuity',
      charactersInScene: ['c' + ((i * 2) % NC), 'c' + ((i * 5 + 3) % NC)],
      locationId: 'w' + ((i * 7) % NW), createdAt: 1, updatedAt: 1 }];
  }
  folders.length = 0;
  for (let i = 0; i < 5; i++) folders.push({ id: 'fo' + i, title: 'Act ' + i, treePath: 'M/Act ' + i });
}
if (process.env.EMPTY) {
  characters.length = 0; world.length = 0; files.length = 0; folders.length = 0; docs.length = 0;
  for (const k of Object.keys(scenes)) delete scenes[k];
}
const EMPTY = !!process.env.EMPTY;
const maybe = (v) => EMPTY ? [] : v;
const calls = { getScenes: 0, getCharacters: 0, total: 0 };
function count(name) { calls.total++; if (calls[name] !== undefined) calls[name]++; }

const tintero = {
  surface: 'app',
  project: {
    async getMetadata() { count('m'); return { id: 'p1', name: 'Ashfall', description: null, createdAt: 1, lastModified: 2, path: '/p' }; },
    async getFiles() { count('f'); return files; },
    async getFolders() { count('fo'); return folders; },
    async getDocs() { count('d'); return docs; },
    async getCharacters() {
      count('getCharacters');
      const out = JSON.parse(JSON.stringify(characters));
      if (extraRelationship) out[3].relationships = [{ characterId: 'c1', type: 'mentor' }];
      if (extraCharacter) out.push({ id: 'c9', name: 'Queued Newcomer', createdAt: 1,
        relationships: [{ characterId: 'c1', type: 'friend' }] });
      // Lets a test hold one read open, to overlap it with another request. The
      // data was captured above, so a change made meanwhile is missed by this read.
      if (slowRead) { const ms = slowRead; slowRead = 0; await new Promise(r => setTimeout(r, ms)); }
      return out;
    },
    async getWorldbuilding() { count('w'); return world; },
    async getCustomWorldbuildingTemplates() {
      count('t');
      return [{ id: 'tpl-custom', name: 'Ledgers', icon: 'book', color: '#556677', fields: [], createdAt: 1, updatedAt: 1 }];
    },
    async getNotes() { count('n'); return maybe([{ id: 'n1', fileId: 'f1', type: 'comment', location: 'Manuscript/Act I/chapter-one.md', textAssociated: 'check the timeline here' },
      { id: 'n2', fileId: 'f1', type: 'note', location: 'x', textAssociated: null, content: '{"type":"doc","content":[]}' }]); },
    async getCollections() { count('col'); return maybe([{ id: 'col1', name: 'Act I read-through', items: [{ id: 'f1', type: 'file' }, { id: 'f2', type: 'file' }] }]); },
    async getTags() { count('tg'); return maybe(['pov', 'protagonist', 'draft', 'lore', 'ruins', 'unused-tag']); },
    async getTimelines() {
      count('tl'); if (EMPTY) return [];
      return [{ id: 't1', name: 'Main', createdAt: 1, lastModified: 2, unassignedNotes: [],
        lanes: [{ id: 'l1', name: 'Mira', collapsed: false, notes: [], milestones: [],
          blocks: [{ id: 'b1', fileId: 'f1', characterId: 'c1', startCol: 0, spanCols: 1 },
                   { id: 'b2', fileId: 'f2', worldbuildingId: 'w-loc1', startCol: 1, spanCols: 1 }] }] }];
    },
    async getFlowMaps() {
      count('fm'); if (EMPTY) return [];
      return [{ id: 'fm1', name: 'Act I beats', createdAt: 1, lastModified: 2,
        nodes: [{ id: 'a', label: 'Opening', x: 0, y: 0, type: 'circle', color: '#fff', linkedCharacterId: 'c1' },
                { id: 'b', label: 'Betrayal', x: 1, y: 1, type: 'circle', color: '#fff', linkedCharacterId: 'c3' }],
        connections: [{ id: 'k1', fromNodeId: 'a', toNodeId: 'b', arrowType: 'simple', label: 'turns on' }] }];
    },
    async getPlotGrids() {
      count('pg'); if (EMPTY) return [];
      return [{ id: 'pg1', name: 'Beats', rowCount: 1, createdAt: 1, lastModified: 2,
        columns: [{ id: 'cc1', name: 'Setup', position: 0 }],
        cells: [{ id: 'ce1', type: 'file', columnId: 'cc1', rowIndex: 0, referenceId: 'f1' }] }];
    },
    async getCardboards() {
      count('cb'); if (EMPTY) return [];
      return [{ id: 'cb1', name: 'Corkboard', rows: 1, cols: 1, createdAt: 1, lastModified: 2,
        cells: [{ id: 'x1', type: 'character', position: { row: 0, col: 0 }, referenceId: 'c1', title: 'lead' }] }];
    },
    async getScenes(id) { count('getScenes'); return scenes[id] || []; },
    async getImageData() { count('img'); return null; }
  },
  storage: {
    _v: {},
    async get(k) { count('sg'); return this._v[k] ?? null; },
    // With a delay, the value lands only when the write completes, as a slow
    // bridge would behave.
    async set(k, v) {
      count('ss');
      if (slowWrite) { const ms = slowWrite; slowWrite = 0; await new Promise(r => setTimeout(r, ms)); }
      this._v[k] = v;
    }
  },
  ui: { async showNotification(m, t) { count('note'); notifications.push([t, m]); } },
  events: {
    _h: {},
    on(name, fn) { (this._h[name] || (this._h[name] = [])).push(fn); },
    off(name, fn) { this._h[name] = (this._h[name] || []).filter(x => x !== fn); },
    emit(name) { (this._h[name] || []).forEach(f => f()); }
  }
};
const notifications = [];

// ── run ──────────────────────────────────────────────────────────────────────
let registered = null;
class TinteroPlugin {
  onActivate() {} onProjectChange() {} onDeactivate() {}
}

const sandbox = {
  tintero, TinteroPlugin,
  registerPlugin: (p) => { registered = p; },
  document, console, Math, Date, Map, Set, Promise, JSON, Object, Array, String, Number,
  setTimeout, clearTimeout, isNaN, parseFloat, parseInt, Infinity, NaN,
  window: sandboxWindow,
  getComputedStyle: () => ({ backgroundColor: 'rgb(22, 19, 15)', getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  ResizeObserver: undefined
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'plugin.js'), 'utf8');

// Runs up to n animation frames and returns how many actually ran. The plugin
// only schedules frames while something moves, so this stops early once the
// graph is still.
function pump(n) {
  let ran = 0;
  for (let i = 0; i < n; i++) {
    const q = rafQueue.splice(0, rafQueue.length);
    if (!q.length) break;
    q.forEach(fn => fn());
    ran++;
  }
  return ran;
}

// Draws one frame even when the graph is idle, the way the page would after a
// window resize (which reallocates the canvas and so must repaint it).
function redraw() {
  (sandboxWindow._ev.resize || []).forEach(f => f());
  pump(1);
}

(async () => {
  vm.runInContext(code, sandbox, { filename: 'plugin.js' });
  if (!registered) throw new Error('registerPlugin was never called');

  await registered.onActivate();
  await new Promise(r => setTimeout(r, process.env.BIG ? 12000 : 500));
  const t0 = process.hrtime.bigint();
  const timed = pump(120);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('---', timed, 'frames in', ms.toFixed(0) + 'ms =',
              (ms / Math.max(1, timed)).toFixed(2) + 'ms/frame');

  const root = findBy(body, n => n.id === 'plugin-root');
  const status = findBy(root, n => String(n.className).includes('tgv-status'));
  const statusText = collectText(status).join(' ');
  const overlay = findBy(root, n => String(n.className).includes('tgv-overlay'));
  console.log('--- overlay:', overlay.classList.contains('tgv-hidden') ? '(hidden)' : collectText(overlay).join(' / '));
  const side = findBy(root, n => String(n.className).includes('tgv-side-scroll'));
  const filterText = collectText(side).join(' | ');

  console.log('--- status:', statusText);
  console.log('--- filters:', filterText);
  console.log('--- api calls:', JSON.stringify(calls));
  console.log('--- draw ops:', JSON.stringify(ctxCalls));
  console.log('--- notifications:', JSON.stringify(notifications));
  console.log('--- stored prefs:', JSON.stringify(tintero.storage._v));

  // Live refresh: add a relationship, fire the event, and see the graph grow.
  extraRelationship = true;
  tintero.events.emit('character.updated');
  await new Promise(r => setTimeout(r, 1800));
  pump(60);
  const status2 = collectText(findBy(root, n => String(n.className).includes('tgv-status'))).join(' ');
  console.log('--- after live update:', status2);
  console.log('--- api calls after refresh:', JSON.stringify(calls), '(getScenes should not grow: cache)');

  // Search: type a query, check the ranked list, then press Enter and confirm
  // the node is selected and the camera is heading for it.
  let searchResults = '', searchJumped = '', searchNoMatch = '', searchFiltered = '';
  {
    // Exact match: 'tgv-search' is also a prefix of the wrapper's class.
    const input = findBy(root, n => n.className === 'tgv-search');
    const fire = (node, type, ev) => { if (node && node._ev && node._ev[type]) node._ev[type](ev || {}); };
    input.value = 'Warden';
    fire(input, 'input');
    const list = findBy(root, n => String(n.className).includes('tgv-results'));
    searchResults = collectText(list).join(' | ');
    console.log('--- search "Warden":', searchResults,
                list.classList.contains('tgv-hidden') ? '(list hidden)' : '(list shown)');

    fire(input, 'keydown', { key: 'Enter', preventDefault() {} });
    pump(2);
    const det = findBy(root, n => String(n.className).includes('tgv-details'));
    searchJumped = det.classList.contains('tgv-hidden') ? '' : collectText(det).join(' ');
    console.log('--- after Enter, details:', searchJumped.slice(0, 60));

    // Folders are hidden by default, so a folder name is the filtered case.
    input.value = 'Act';
    fire(input, 'input');
    searchFiltered = collectText(findBy(root, n => String(n.className).includes('tgv-results'))).join(' ');
    console.log('--- search "Act" (folders hidden):', searchFiltered);

    input.value = 'zzzz-no-such-node';
    fire(input, 'input');
    searchNoMatch = collectText(findBy(root, n => String(n.className).includes('tgv-results'))).join(' ');
    console.log('--- search miss:', searchNoMatch);

    input.value = '';
    fire(input, 'input');
  }

  // Recolour a whole node type through its legend swatch, and confirm the
  // choice reaches the drawn node, the details panel and storage.
  let colorApplied = '', colorStored = '', colorReset = '';
  {
    // The Characters row is the first filter row; its swatch is the colour input.
    // An empty project has no rows at all, so there is nothing to recolour.
    const swatch = findBy(root, n => String(n.className).includes('tgv-swatch-input'));
    if (swatch) {
    swatch.value = '#123456';
    swatch._ev.input({ stopPropagation() {} });
    await new Promise(r => setTimeout(r, 600));       // savePrefs debounce
    const det = findBy(root, n => String(n.className).includes('tgv-details'));
    const detSwatch = findBy(det, n => String(n.className).includes('tgv-swatch'));
    colorApplied = String(detSwatch && detSwatch.style.background || '');
    colorStored = JSON.stringify(tintero.storage._v.graphViewPrefs.kindColors || {});
    console.log('--- recoloured characters:', colorApplied, 'stored:', colorStored);

    const reset = findBy(root, n => String(n.className).includes('tgv-reset-colors'));
    reset._ev.click({});
    await new Promise(r => setTimeout(r, 600));
    colorReset = JSON.stringify(tintero.storage._v.graphViewPrefs.kindColors || {});
    console.log('--- after reset:', colorReset);
    }
  }

  // Touch: a pinch zooms about the fingers, lifting one finger does not pan,
  // a tap selects, the details panel's Pin holds a node still, and a double-tap
  // centres on it — while the dblclick a browser may send after it is ignored.
  let pinchRatio = 0, strayPan = -1, tapCleared = false, tapSelected = '', pinText = '',
    pinnedDrift = -1, centredOff = -1;
  let settledAfter = -1, idleQueued = -1, wheelQueued = -1, wheelFrames = -1;
  const staleOn = [];
  if (!EMPTY && !process.env.BIG) {
    const canvas = findBy(root, n => n.className === 'tgv-canvas');
    const touch = (type, id, x, y) => canvas._ev[type]({ type, pointerId: id, pointerType: 'touch',
      offsetX: x, offsetY: y, button: 0, shiftKey: false, preventDefault() {} });
    const frame = () => { bodies = []; redraw(); return bodies; };
    const near = (list, x, y) => list.reduce((best, b) => {
      const d = Math.hypot(b.x - x, b.y - y);
      return d < best.d ? { b, d } : best;
    }, { b: null, d: Infinity });
    const median = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

    // Battery: once the layout has settled, nothing is scheduled at all, and a
    // single scroll asks for exactly one frame rather than restarting a loop.
    settledAfter = pump(3000);
    idleQueued = rafQueue.length;
    // Two scrolls inside one frame must still share a single frame.
    canvas._ev.wheel({ deltaY: -60, deltaMode: 0, offsetX: 640, offsetY: 400, preventDefault() {} });
    canvas._ev.wheel({ deltaY: -60, deltaMode: 0, offsetX: 640, offsetY: 400, preventDefault() {} });
    wheelQueued = rafQueue.length;
    wheelFrames = pump(50);
    console.log('--- idle after', settledAfter, 'frames; queued while idle:', idleQueued,
                '| two scrolls queued', wheelQueued, 'and drew', wheelFrames, 'frame(s)');

    // Fit first. Off-screen nodes are not drawn, and the search test left the
    // camera zoomed in on one node; with every node on screen, zooming out
    // keeps them all there, so both frames measure the same set of nodes.
    findBy(root, n => n.title === 'Fit')._ev.click({});
    pump(3000);
    const before = frame();
    touch('pointerdown', 1, 240, 400);
    touch('pointerdown', 2, 1040, 400);
    touch('pointermove', 2, 640, 400); // fingers 800px apart, then 400: half the zoom
    const pinched = frame();
    pinchRatio = +(median(pinched.map(b => b.r)) / median(before.map(b => b.r))).toFixed(3);
    console.log('--- pinch to half the distance: radii x' + pinchRatio);

    touch('pointerup', 2, 640, 400);
    touch('pointermove', 1, 390, 400); // the remaining finger moves 150px
    const after = frame();
    strayPan = +(after.reduce((s, b, i) => s + Math.abs(b.x - pinched[i].x), 0) / after.length).toFixed(2);
    touch('pointerup', 1, 390, 400);
    console.log('--- one finger left after the pinch moved 150px; the view moved', strayPan + 'px');

    // The search test left a node selected. A tap on empty space must clear it,
    // or the next check could pass on the old selection.
    const det = findBy(root, n => String(n.className).includes('tgv-details'));
    touch('pointerdown', 6, 3, 3);
    touch('pointerup', 6, 3, 3);
    tapCleared = det.classList.contains('tgv-hidden');
    await new Promise(r => setTimeout(r, 400));   // not a double-tap with the next one

    const target = near(frame(), 640, 400).b;
    touch('pointerdown', 3, target.x, target.y);
    touch('pointerup', 3, target.x, target.y);
    tapSelected = det.classList.contains('tgv-hidden') ? '' : collectText(det).join(' ');
    console.log('--- tap selected:', tapSelected.slice(0, 40));

    const pin = findBy(det, n => n.className === 'tgv-det-pin');
    pin._ev.click({});
    pinText = pin.textContent;
    pump(30);                           // the tap reheated the layout; a pinned node must not move
    pinnedDrift = +near(frame(), target.x, target.y).d.toFixed(3);
    console.log('--- pinned via the details panel:', pinText, '— drifted', pinnedDrift + 'px in 30 frames');

    await new Promise(r => setTimeout(r, 400));   // so the earlier tap cannot pair up
    touch('pointerdown', 4, target.x, target.y);
    touch('pointerup', 4, target.x, target.y);
    touch('pointerdown', 5, target.x, target.y);
    touch('pointerup', 5, target.x, target.y);
    canvas._ev.dblclick({ offsetX: 5, offsetY: 5 });  // would fit the graph if not ignored
    pump(150);
    centredOff = +near(frame(), 640, 400).d.toFixed(2);
    console.log('--- double-tap: nearest node to the centre is', centredOff + 'px away');

    // Everything that changes the picture without moving the layout must ask
    // for a frame itself. A miss here is a screen that silently goes stale.
    const walk = (n, out) => { out.push(n); (n.children || []).forEach(k => walk(k, out)); return out; };
    const input = findBy(root, n => n.className === 'tgv-search');
    // Closing the details comes first: while a node is selected, recolouring
    // also refreshes its panel, which redraws anyway and would mask a miss.
    const triggers = [
      ['closing the details', () => {
        findBy(root, n => n.className === 'tgv-det-close')._ev.click({});
      }],
      ['search', () => { input.value = 'Mira'; input._ev.input({}); }],
      ['clearing the search', () => { input.value = ''; input._ev.input({}); }],
      ['recolouring a type', () => {
        const sw = findBy(root, n => String(n.className).includes('tgv-swatch-input'));
        sw.value = '#335577'; sw._ev.input({ stopPropagation() {} });
      }],
      ['the label fade slider', () => {
        const ranges = walk(root, []).filter(n => n.type === 'range');
        const label = ranges[ranges.length - 1];
        label.value = '2'; label._ev.input({});
      }],
      ['hovering a node', () => {
        const b = near(frame(), 640, 400).b;
        pump(3000);
        canvas._ev.pointermove({ pointerId: 9, pointerType: 'mouse', offsetX: b.x, offsetY: b.y });
      }]
    ];
    for (const [name, act] of triggers) {
      pump(3000);
      act();
      if (!rafQueue.length) staleOn.push(name);
    }
    pump(3000);
    console.log('--- redraws while idle:', triggers.length - staleOn.length + '/' + triggers.length,
                staleOn.length ? '(stale after: ' + staleOn.join(', ') + ')' : '');
  }

  // Radii are relative to the current zoom, so compare each run against its own
  // smallest node rather than across runs.
  const spread = () => {
    const r = arcRadii.filter(x => x > 0).sort((a, b) => a - b);
    if (!r.length) return { n: 0, distinct: 0, ratio: 1, shape: '' };
    const min = r[0];
    const norm = r.map(x => +(x / min).toFixed(3));
    return { n: r.length, distinct: new Set(norm).size,
             ratio: +(r[r.length - 1] / min).toFixed(2), shape: norm.join(',') };
  };

  arcRadii = [];
  redraw();
  const byLinks = spread();
  console.log('--- size by links:  ' + byLinks.distinct + ' distinct radii, largest ' +
              byLinks.ratio + 'x the smallest');

  // The filter panel: its own hide button closes it, Panel reopens it, and
  // both are remembered on a wide window. At 1100px or less it starts closed; a
  // choice made there holds while the window stays small but is not saved,
  // and crossing the limit hands control back to the automatic rule.
  const panelSteps = [];
  {
    const side = () => findBy(root, n => n.className === 'tgv-pane tgv-side');
    const open = () => !side().classList.contains('tgv-collapsed');
    const saved = async () => {
      await new Promise(r => setTimeout(r, 600));      // savePrefs debounce
      return tintero.storage._v.graphViewPrefs.sideOpen;
    };
    const resizeTo = (w) => { viewport.w = w; (sandboxWindow._ev.resize || []).forEach(f => f()); };
    const panelBtn = () => findBy(root, n => n.title === 'Panel');
    const step = (name, got, want) => panelSteps.push({ name, got, want });

    step('open on a wide window', open(), true);
    findBy(root, n => n.className === 'tgv-side-hide')._ev.click({});
    step('its own button hides it', open(), false);
    step('...and that is saved', await saved(), false);
    panelBtn()._ev.click({});
    step('Panel brings it back', open(), true);
    step('...and that is saved', await saved(), true);

    resizeTo(1000);
    step('closes itself at 1000px', open(), false);
    panelBtn()._ev.click({});
    step('opens by hand at 1000px', open(), true);
    resizeTo(1050);
    step('stays open while still small', open(), true);
    panelBtn()._ev.click({});
    step('closes by hand while small', open(), false);
    step('...without touching the saved choice', await saved(), true);

    resizeTo(1280);
    step('back on a wide window it follows the saved choice', open(), true);
    resizeTo(900);
    step('small again, closed again', open(), false);
    resizeTo(1280);

    const failed = panelSteps.filter(s => s.got !== s.want);
    console.log('--- filter panel:', panelSteps.length - failed.length + '/' + panelSteps.length,
                failed.length ? 'failed: ' + failed.map(s => s.name).join('; ') : 'steps as expected');
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // A refresh asked for while another is running must run once it finishes,
  // so a change made mid-read still reaches the graph.
  let queuedReads = -1, queuedFound = '';
  if (!EMPTY && !process.env.BIG) {
    const refresh = findBy(root, n => n.title === 'Refresh');
    const readsBefore = calls.getCharacters;
    slowRead = 300;
    refresh._ev.click({});               // read 1 starts and is held open
    await sleep(50);
    extraCharacter = true;               // the project changes while read 1 is out
    refresh._ev.click({});               // asked for mid-read
    await sleep(800);
    queuedReads = calls.getCharacters - readsBefore;
    const input = findBy(root, n => n.className === 'tgv-search');
    input.value = 'Queued Newcomer';
    input._ev.input({});
    queuedFound = collectText(findBy(root, n => String(n.className).includes('tgv-results'))).join(' ');
    input.value = '';
    input._ev.input({});
    console.log('--- refresh asked for mid-read: ' + queuedReads + ' reads; the mid-read change',
                queuedFound.includes('Queued Newcomer') ? 'arrived' : 'was LOST');
  }

  // A preference change made while an earlier save is still being written must
  // be saved once that write finishes, not skipped.
  let savedRepel = null;
  {
    const walkAll = (n, out) => { out.push(n); (n.children || []).forEach(k => walkAll(k, out)); return out; };
    const repel = walkAll(root, []).filter(n => n.type === 'range')[0];
    slowWrite = 1000;
    repel.value = '1.5'; repel._ev.input({});
    await sleep(600);                    // debounce fired: the 1.5 write is in flight
    repel.value = '2'; repel._ev.input({});
    await sleep(1300);                   // its debounce fired mid-write; both writes done
    savedRepel = tintero.storage._v.graphViewPrefs.repel;
    console.log('--- repel changed mid-save: stored', savedRepel, '(latest is 2)');
    repel.value = '1'; repel._ev.input({});
    await sleep(600);
  }

  const scenesBeforeModeSwitch = calls.getScenes;
  await registered.onDeactivate();
  tintero.storage._v.graphViewPrefs =
    Object.assign({}, tintero.storage._v.graphViewPrefs, { sizeBy: 'length' });
  await registered.onActivate();
  await new Promise(r => setTimeout(r, 500));
  arcRadii = [];
  redraw();
  const byLength = spread();
  console.log('--- size by length: ' + byLength.distinct + ' distinct radii, largest ' +
              byLength.ratio + 'x the smallest');

  // Turning Live off must stop every refresh path, including the SDK's own
  // onProjectChange hook — which used to call reload() directly, bypassing both
  // the toggle and the debounce.
  // Button labels live in innerHTML, which the fake DOM does not parse, so
  // identify the Live button by the title it sets.
  const liveBtn = findBy(root, n => String(n.title).includes('Refresh automatically'));
  liveBtn._ev.click({});
  // The status dot must follow the toggle immediately, not wait for some
  // unrelated repaint. renderStatus() rebuilds the bar, so re-find the dot.
  const dotAfterOff = findBy(root, n => n.className === 'tgv-dot');
  const dotWentDark = !!dotAfterOff && !dotAfterOff.classList.contains('tgv-live');
  console.log('--- Live off, status dot dark immediately:', dotWentDark);

  const callsBeforeHook = calls.getCharacters;
  registered.onProjectChange();
  tintero.events.emit('project.changed');
  await new Promise(r => setTimeout(r, 1800));
  const liveOffHeld = calls.getCharacters === callsBeforeHook;
  console.log('--- Live off, project changed: collection calls',
              callsBeforeHook, '->', calls.getCharacters, liveOffHeld ? '(held)' : '(LEAKED)');

  await registered.onDeactivate();
  const left = Object.values(tintero.events._h).reduce((a, b) => a + b.length, 0);
  console.log('--- deactivated cleanly, handlers left:', left);

  // ── assertions ─────────────────────────────────────────────────────────────
  const problems = [];
  if (left !== 0) problems.push('event handlers survived onDeactivate');
  if (!liveOffHeld) problems.push('refresh happened while Live was off');
  if (!dotWentDark) problems.push('status dot stayed green after Live was switched off');
  if (notifications.length) problems.push('unexpected notifications: ' + JSON.stringify(notifications));
  if (savedRepel !== 2) problems.push('a preference changed mid-save was not stored: ' + savedRepel);
  if (!EMPTY && !process.env.BIG) {
    if (queuedReads !== 2) problems.push('a refresh asked for mid-read ran ' + queuedReads + ' reads, not 2');
    if (!queuedFound.includes('Queued Newcomer'))
      problems.push('a change made mid-read never reached the graph: ' + queuedFound);
  }
  panelSteps.filter(s => s.got !== s.want).forEach(s =>
    problems.push('filter panel: ' + s.name + ' — expected ' + s.want + ', got ' + s.got));
  if (!process.env.EMPTY && !/\d+ nodes/.test(statusText)) problems.push('no node count rendered');
  if (process.env.EMPTY && !collectText(overlay).join(' ').includes('Nothing to map'))
    problems.push('empty project did not show the empty state');
  if (!process.env.EMPTY && !process.env.BIG) {
    if (!statusText.includes('26 nodes') || !statusText.includes('45 links'))
      problems.push('expected 26 nodes / 45 links, got: ' + statusText);
    // d2 is attached to a character, d3 to a worldbuilding element, and d4 sits
    // in a real folder that shares a character's name and must stay unlinked.
    if (!filterText.includes('Documents | 4'))
      problems.push('expected 4 document nodes, got: ' + filterText);
    if (!status2.includes('+1 link')) problems.push('live update did not report the new link');
    if (scenesBeforeModeSwitch !== 3)
      problems.push('scene cache did not hold: ' + scenesBeforeModeSwitch + ' calls');
    // Both modes must actually vary node size, and must not agree with each
    // other — if they did, the switch would be doing nothing.
    if (byLinks.distinct < 2) problems.push('links mode drew every node the same size');
    if (byLength.distinct < 2) problems.push('length mode drew every node the same size');
    if (byLinks.shape === byLength.shape)
      problems.push('size mode switch changed nothing: ' + byLinks.shape);
    if (tintero.storage._v.graphViewPrefs.sizeBy !== 'length')
      problems.push('sizeBy preference did not round-trip through storage');
    // Search must list the match, and Enter must select it.
    if (!searchResults.includes('The Warden'))
      problems.push('search did not list the matching node: ' + searchResults);
    if (!searchJumped.includes('The Warden'))
      problems.push('Enter did not select the searched node: ' + searchJumped);
    if (!searchFiltered.includes('hidden by filters'))
      problems.push('search did not report filter-hidden matches: ' + searchFiltered);
    if (!searchNoMatch.includes('No node matches'))
      problems.push('a search with no matches said nothing: ' + searchNoMatch);
    // Per-type colour override.
    if (colorApplied !== '#123456')
      problems.push('type colour did not reach the node: ' + colorApplied);
    if (!colorStored.includes('#123456'))
      problems.push('type colour did not persist: ' + colorStored);
    if (colorReset !== '{}')
      problems.push('reset colours did not clear the overrides: ' + colorReset);
    // Battery: an idle graph schedules nothing; one scroll is one frame.
    if (!(settledAfter > 0 && settledAfter < 3000))
      problems.push('the frame loop never stopped: ' + settledAfter + ' frames');
    if (idleQueued !== 0) problems.push('frames still queued while idle: ' + idleQueued);
    if (wheelQueued !== 1 || wheelFrames !== 1)
      problems.push('two scrolls while idle queued ' + wheelQueued + ' and drew ' + wheelFrames + ' frames, not 1 and 1');
    if (staleOn.length) problems.push('no redraw after: ' + staleOn.join(', '));
    // Touch.
    if (Math.abs(pinchRatio - 0.5) > 0.01) problems.push('pinch did not halve the zoom: x' + pinchRatio);
    if (!(strayPan >= 0 && strayPan < 5))
      problems.push('the finger left after a pinch panned the view: ' + strayPan + 'px');
    if (!tapCleared) problems.push('a tap on empty space did not clear the selection');
    if (!tapSelected) problems.push('a tap on a node did not open its details');
    if (pinText !== 'Unpin') problems.push('the Pin button did not pin: ' + pinText);
    if (!(pinnedDrift >= 0 && pinnedDrift < 0.01)) problems.push('a pinned node moved: ' + pinnedDrift + 'px');
    if (!(centredOff >= 0 && centredOff < 1.5))
      problems.push('double-tap did not centre the node: ' + centredOff + 'px off');
  }
  if (problems.length) { problems.forEach(p => console.error('ASSERTION: ' + p)); process.exit(1); }
  console.log('--- all assertions passed');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
