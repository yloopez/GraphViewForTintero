/*
 * Graph View for Tintero
 * ----------------------
 * An Obsidian-style force-directed map of everything in a project and the
 * relations between those things.
 *
 * Read-only by construction: the manifest declares no `*.write` scope, so any
 * attempt to mutate the project would be rejected by the host with
 * SCOPE_DENIED. Nothing below calls a write method.
 */
(function () {
  'use strict';

  // ── Kinds ────────────────────────────────────────────────────────────────
  // Every node has a kind. Kinds drive colour, size, the filter list and the
  // legend. Worldbuilding kinds are keyed "wb:<type>".

  var KINDS = {
    'character':   { label: 'Characters',    color: '#e0685f', r: 6.5 },
    'file':        { label: 'Manuscript',    color: '#6aa9e0', r: 5.5 },
    'doc':         { label: 'Documents',     color: '#79c7bd', r: 5 },
    'folder':      { label: 'Folders',       color: '#8a8a8a', r: 4.5 },
    'note':        { label: 'Notes',         color: '#d9b45c', r: 3.8 },
    'tag':         { label: 'Tags',          color: '#b07fd4', r: 3.8 },
    'collection':  { label: 'Collections',   color: '#cf8fb0', r: 5 },
    'timeline':    { label: 'Timelines',     color: '#7f9ad4', r: 5 },
    'flowmap':     { label: 'Flow maps',     color: '#6fbf8e', r: 5 },
    'plotgrid':    { label: 'Plot grids',    color: '#c9a227', r: 5 },
    'cardboard':   { label: 'Cardboards',    color: '#b98f6a', r: 5 },
    'wb:location':     { label: 'Locations',      color: '#4fae86', r: 5.5 },
    'wb:faction':      { label: 'Factions',       color: '#d07a3c', r: 5.5 },
    'wb:group':        { label: 'Groups',         color: '#d08a55', r: 5 },
    'wb:species':      { label: 'Species',        color: '#9d7fd4', r: 5 },
    'wb:creature':     { label: 'Creatures',      color: '#8d6fc4', r: 5 },
    'wb:item':         { label: 'Items',          color: '#c9a227', r: 4.6 },
    'wb:event':        { label: 'Events',         color: '#dd6b8e', r: 5.2 },
    'wb:religion':     { label: 'Religions',      color: '#7fb7d4', r: 5 },
    'wb:deity':        { label: 'Deities',        color: '#6fa0cc', r: 5.2 },
    'wb:magic-system': { label: 'Magic systems',  color: '#a06fd4', r: 5 },
    'wb:technology':   { label: 'Technology',     color: '#7a9ba8', r: 5 },
    'wb:language':     { label: 'Languages',      color: '#96a86f', r: 4.6 },
    'wb:occupation':   { label: 'Occupations',    color: '#b3936f', r: 4.6 },
    'wb:custom':       { label: 'Worldbuilding',  color: '#9b9b9b', r: 5 }
  };

  // Order the filter list is rendered in.
  var KIND_ORDER = ['character', 'file', 'doc', 'folder', 'wb:location', 'wb:faction',
    'wb:group', 'wb:species', 'wb:creature', 'wb:item', 'wb:event', 'wb:religion',
    'wb:deity', 'wb:magic-system', 'wb:technology', 'wb:language', 'wb:occupation',
    'wb:custom', 'note', 'tag', 'collection', 'timeline', 'flowmap', 'plotgrid',
    'cardboard'];

  // Character.worldbuilding keys → the edge label they should carry.
  // Keys the SDK declares, plus ten more that the host actually sends but the
  // type definitions never mention. Unknown keys still link — they just fall
  // back to showing the raw key as the edge label.
  var CW_LABELS = {
    species: 'species', factions: 'faction', occupations: 'occupation',
    locations: 'location', religions: 'religion', magicSystems: 'magic',
    languages: 'language', technologies: 'technology',
    factionLeader: 'leads', factionFounder: 'founded',
    factionExMember: 'ex-member of',
    occupationFormer: 'former occupation',
    locationBirthplace: 'born in', locationRuler: 'rules',
    religionClergy: 'clergy of', religionHeretic: 'heretic of',
    religionExFollower: 'ex-follower of',
    languageNative: 'native language',
    groupMember: 'member of', groupLeader: 'leads', groupFounder: 'founded',
    groupExMember: 'ex-member of', groupExLeader: 'former leader of',
    deityFollower: 'follows', deityChampion: 'champion of', deityClergy: 'clergy of',
    deityEnemy: 'enemy of', deityBlessed: 'blessed by', deityCursed: 'cursed by',
    deityExFollower: 'ex-follower of',
    creatureTamed: 'tamed', creatureHunted: 'hunts', creatureProtected: 'protects',
    creatureEncountered: 'encountered', creatureCompanion: 'companion',
    creatureFamiliar: 'familiar',
    itemOwner: 'owns', itemCreator: 'created', itemDiscovered: 'discovered',
    itemGuardian: 'guards', itemExOwner: 'former owner of', itemSeeker: 'seeks',
    eventParticipant: 'took part in', eventKeyFigure: 'key figure in',
    eventCausedBy: 'caused', eventWitness: 'witnessed', eventVictim: 'victim of',
    eventHero: 'hero of'
  };

  var SCENE_TYPE_LABELS = {
    main_continuity: 'scene', flashback: 'flashback', dream: 'dream',
    vision: 'vision', memory: 'memory', prologue: 'prologue',
    epilogue: 'epilogue', interlude: 'interlude', montage: 'montage'
  };

  var PREFS_KEY = 'graphViewPrefs';

  var DEFAULT_PREFS = {
    hidden: ['folder'],
    kindColors: {},            // kind → '#rrggbb' chosen by the reader
    showOrphans: false,
    sizeBy: 'links',           // 'links' = by connections, 'length' = by words written
    autoRefresh: true,
    repel: 1.0,
    linkDist: 1.0,
    labelZoom: 1.0,
    sideOpen: true
  };

  // Merge stored preferences over the defaults, cloning anything mutable so a
  // later edit cannot reach back and corrupt DEFAULT_PREFS for the next view.
  function normalizePrefs(saved) {
    var p = Object.assign({}, DEFAULT_PREFS, (saved && typeof saved === 'object') ? saved : {});
    p.hidden = Array.isArray(p.hidden) ? p.hidden.slice() : DEFAULT_PREFS.hidden.slice();
    p.kindColors = (p.kindColors && typeof p.kindColors === 'object')
      ? Object.assign({}, p.kindColors) : {};
    return p;
  }

  // Not every engine offers a native colour picker. Detect once: an input whose
  // type refuses to stay "color" has fallen back to a text box, and we render a
  // hex field instead so the feature still works.
  var COLOR_INPUT_OK = (function () {
    try {
      var probe = document.createElement('input');
      probe.type = 'color';
      return probe.type === 'color';
    } catch (e) { return false; }
  })();

  var HEX_RE = /^#[0-9a-f]{6}$/i;

  // A finger rather than a mouse is the main pointer: a phone or a tablet.
  var COARSE = (function () {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  })();

  // At or below this width the panels become bottom sheets. Must match the
  // `max-width` of the narrow-screen media query in plugin.css.
  var NARROW_MAX = 760;

  // At or below this width the filter panel starts closed. Beside the details
  // panel it would leave the graph too little of the window.
  var SIDE_AUTO_MAX = 1100;

  // ── Small helpers ────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgIcon(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      paths + '</svg>';
  }

  var ICON = {
    graph: '<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><line x1="12" y1="7.4" x2="5.9" y2="15.7"/><line x1="12" y1="7.4" x2="18.1" y2="15.7"/><line x1="7.4" y1="18" x2="16.6" y2="18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
    live: '<circle cx="12" cy="12" r="3"/><path d="M16.5 7.5a6.4 6.4 0 0 1 0 9"/><path d="M7.5 16.5a6.4 6.4 0 0 1 0-9"/>',
    fit: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>'
  };

  function debounce(fn, ms) {
    var t = null;
    var wrapped = function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(null, args); }, ms);
    };
    wrapped.cancel = function () { clearTimeout(t); t = null; };
    return wrapped;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Normalise a reference the way a wiki-style link might be written:
  // "[[The Ashen Gate|the gate]]#section" → "the ashen gate".
  function normRef(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    var m = s.match(/^\[\[([\s\S]*?)\]\]$/);
    if (m) s = m[1];
    var bar = s.indexOf('|');
    if (bar !== -1) s = s.slice(0, bar);
    var hash = s.indexOf('#');
    if (hash !== -1) s = s.slice(0, hash);
    s = s.replace(/^[./\\]+/, '').trim();
    s = s.replace(/\.(md|markdown|txt|json|html?)$/i, '');
    return s.toLowerCase();
  }

  // A reference can arrive as a plain string, or as an object carrying the id
  // under one of several names. Without this, an object reference silently
  // stringifies to "[object Object]" and the link is quietly lost.
  function refString(raw) {
    if (raw == null) return '';
    var t = typeof raw;
    if (t === 'string' || t === 'number') return String(raw).trim();
    if (t !== 'object') return '';
    var keys = ['id', 'characterId', 'docId', 'fileId', 'elementId', 'documentId',
      'worldbuildingId', 'targetId', 'ref', 'value', 'name'];
    for (var i = 0; i < keys.length; i++) {
      var v = raw[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function baseName(p) {
    if (!p) return '';
    var parts = String(p).split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function parentPath(p) {
    if (!p) return '';
    var parts = String(p).split(/[/\\]/).filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  // Some fields hold ProseMirror JSON rather than prose. Showing `{"type":"doc"…}`
  // as a node label would be worse than showing nothing, so drop it.
  function plainText(s) {
    if (s == null) return '';
    var t = String(s).trim();
    if (!t) return '';
    if ((t.charAt(0) === '{' || t.charAt(0) === '[') && /"type"\s*:/.test(t)) return '';
    return t;
  }

  function firstLine(s, max) {
    var t = plainText(s).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  // Rich-text fields may arrive as ProseMirror JSON rather than a plain string.
  // Walk it for text nodes so a word count means the same thing either way.
  function pmText(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (var k = 0; k < node.length; k++) pmText(node[k], out);
      return out;
    }
    if (typeof node.text === 'string') out.push(node.text);
    if (Array.isArray(node.content)) {
      for (var i = 0; i < node.content.length; i++) pmText(node.content[i], out);
    }
    return out;
  }

  function countWords(raw) {
    if (raw == null) return 0;
    var t = String(raw).trim();
    if (!t) return 0;
    if ((t.charAt(0) === '{' || t.charAt(0) === '[') && /"type"\s*:/.test(t)) {
      try { t = pmText(JSON.parse(t), []).join(' '); } catch (e) { return 0; }
    }
    t = t.replace(/\s+/g, ' ').trim();
    return t ? t.split(' ').length : 0;
  }

  // Sum the words across several fields, each of which may be a string or an
  // array of strings (goals, fears, traits).
  function countWordsIn(obj, keys) {
    var n = 0;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (Array.isArray(v)) {
        for (var j = 0; j < v.length; j++) n += countWords(v[j]);
      } else {
        n += countWords(v);
      }
    }
    return n;
  }

  function hashColor(seed) {
    var h = 0, i;
    for (i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ', 42%, 58%)';
  }

  function kindOf(key) {
    return KINDS[key] || KINDS['wb:custom'];
  }

  // ── Graph construction ───────────────────────────────────────────────────

  function GraphBuilder() {
    this.nodes = new Map();      // nodeId → node
    this.edges = new Map();      // edgeKey → edge
    this.byEntityId = new Map(); // raw entity id → nodeId
    this.byName = new Map();     // normalised name → nodeId (first writer wins)
  }

  GraphBuilder.prototype.add = function (id, kind, label, data, refId) {
    var existing = this.nodes.get(id);
    if (existing) return existing;
    var node = {
      id: id,
      kind: kind,
      label: label || '(untitled)',
      data: data || null,
      deg: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      r: kindOf(kind).r,
      // baseColor is this kind's colour out of the box; color is what actually
      // gets drawn, which is baseColor unless the reader has overridden the
      // kind. Tintero's own per-item colours are deliberately ignored: it gives
      // every character the same default, so honouring them would paint the
      // graph one shade and destroy the type coding.
      baseColor: kindOf(kind).color,
      color: kindOf(kind).color
    };
    this.nodes.set(id, node);
    if (refId) this.byEntityId.set(String(refId), id);
    return node;
  };

  GraphBuilder.prototype.alias = function (name, nodeId) {
    var n = normRef(name);
    if (!n || n.length < 2) return;
    if (!this.byName.has(n)) this.byName.set(n, nodeId);
  };

  GraphBuilder.prototype.link = function (a, b, type, label) {
    if (!a || !b || a === b) return null;
    if (!this.nodes.has(a) || !this.nodes.has(b)) return null;
    var lo = a < b ? a : b, hi = a < b ? b : a;
    // JSON rather than a delimiter: a node id can contain almost anything.
    var key = JSON.stringify([lo, hi, type]);
    var e = this.edges.get(key);
    if (e) {
      e.w += 1;
      if (label && e.labels.indexOf(label) === -1 && e.labels.length < 4) e.labels.push(label);
      return e;
    }
    e = { key: key, s: a, t: b, type: type, labels: label ? [label] : [], w: 1 };
    this.edges.set(key, e);
    return e;
  };

  // Resolve a free-form reference (an id, a name, a path) to a node id.
  // Strict form of resolve(): entity ids only, never names. Used where a name
  // match would be unsafe — a folder may legitimately share a character's name.
  GraphBuilder.prototype.resolveId = function (raw) {
    var s = refString(raw);
    if (!s) return null;
    return this.byEntityId.get(s) || null;
  };

  GraphBuilder.prototype.resolve = function (raw) {
    var s = refString(raw);
    if (!s) return null;
    var direct = this.byEntityId.get(s);
    if (direct) return direct;
    var n = normRef(s);
    var byName = this.byName.get(n);
    if (byName) return byName;
    var base = normRef(baseName(s));
    if (base && base !== n) {
      byName = this.byName.get(base);
      if (byName) return byName;
    }
    return null;
  };

  // ── Data collection ──────────────────────────────────────────────────────

  var SCENE_FILE_CAP = 1500;  // don't scan scenes for more files than this
  var SCENE_CHUNK = 8;        // concurrent getScenes() calls
  var SCENE_RATE = 60;        // calls per second to aim for (host ceiling is 100)

  function safeCall(fn, fallback, report, name) {
    return Promise.resolve()
      .then(fn)
      .catch(function (err) {
        report.push({ what: name, message: String((err && err.message) || err) });
        return fallback;
      });
  }

  async function collect(onProgress) {
    var problems = [];
    var g = new GraphBuilder();
    var P = tintero.project;

    var step = function (msg) { if (onProgress) onProgress(msg); };

    step('Reading project…');

    var results = await Promise.all([
      safeCall(function () { return P.getMetadata(); }, null, problems, 'project metadata'),
      safeCall(function () { return P.getFiles(); }, [], problems, 'files'),
      safeCall(function () { return P.getFolders(); }, [], problems, 'folders'),
      safeCall(function () { return P.getDocs(); }, [], problems, 'documents'),
      safeCall(function () { return P.getCharacters(); }, [], problems, 'characters'),
      safeCall(function () { return P.getWorldbuilding(); }, [], problems, 'worldbuilding'),
      safeCall(function () { return P.getCustomWorldbuildingTemplates(); }, [], problems, 'templates'),
      safeCall(function () { return P.getNotes(); }, [], problems, 'notes'),
      safeCall(function () { return P.getCollections(); }, [], problems, 'collections'),
      safeCall(function () { return P.getTags(); }, [], problems, 'tags'),
      safeCall(function () { return P.getTimelines(); }, [], problems, 'timelines'),
      safeCall(function () { return P.getFlowMaps(); }, [], problems, 'flow maps'),
      safeCall(function () { return P.getPlotGrids(); }, [], problems, 'plot grids'),
      safeCall(function () { return P.getCardboards(); }, [], problems, 'cardboards')
    ]);

    var meta = results[0], files = results[1] || [], folders = results[2] || [],
      docs = results[3] || [], characters = results[4] || [], world = results[5] || [],
      templates = results[6] || [], notes = results[7] || [], collections = results[8] || [],
      tags = results[9] || [], timelines = results[10] || [], flowmaps = results[11] || [],
      plotgrids = results[12] || [], cardboards = results[13] || [];

    step('Building nodes…');

    // Custom worldbuilding templates give custom types a name and a colour.
    var tplByKey = new Map();
    templates.forEach(function (t) {
      if (!t) return;
      var info = { label: t.name || 'Custom', color: t.color || null };
      if (t.id) tplByKey.set(String(t.id).toLowerCase(), info);
      if (t.name) tplByKey.set(String(t.name).toLowerCase(), info);
    });

    // --- Folders
    var folderByPath = new Map();
    folders.forEach(function (f) {
      if (!f) return;
      var path = f.treePath || f.title || f.id;
      var id = 'folder:' + (f.id || path);
      g.add(id, 'folder', f.title || baseName(path) || 'Folder', f, f.id);
      folderByPath.set(String(path).replace(/[/\\]+$/, ''), id);
      g.alias(f.title, id);
    });

    // --- Manuscript files
    files.forEach(function (f) {
      if (!f) return;
      var id = 'file:' + f.id;
      var node = g.add(id, 'file', f.title || f.name || baseName(f.location) || 'Untitled', f, f.id);
      if (typeof f.wordNumber === 'number') node.words = f.wordNumber;
      g.alias(f.name, id);
      g.alias(f.title, id);
      g.alias(baseName(f.location), id);
      if (f.treePath) g.alias(f.treePath, id);
    });

    // --- Documents (notes / research docs)
    docs.forEach(function (d) {
      if (!d) return;
      var id = 'doc:' + d.id;
      var node = g.add(id, 'doc', d.title || d.name || 'Untitled', d, d.id);
      if (typeof d.wordNumber === 'number') node.words = d.wordNumber;
      g.alias(d.name, id);
      g.alias(d.title, id);
      g.alias(baseName(d.location), id);
    });

    // --- Characters
    characters.forEach(function (c) {
      if (!c) return;
      var id = 'char:' + c.id;
      var node = g.add(id, 'character', c.name || 'Unnamed', c, c.id);
      // "Length" for a character is how much has been written about them.
      node.words = countWordsIn(c, ['backstory', 'physicalDescription',
        'psychologicalDescription', 'notes', 'goals', 'fears', 'traits']);
      g.alias(c.name, id);
      if (c.firstName && c.lastName) g.alias(c.firstName + ' ' + c.lastName, id);
      if (c.firstName) g.alias(c.firstName, id);
      (c.aka || []).forEach(function (a) { g.alias(a, id); });
      (c.variants || []).forEach(function (v) { if (v && v.name) g.alias(v.name, id); });
    });

    // --- Worldbuilding elements
    world.forEach(function (w) {
      if (!w) return;
      var rawType = String(w.type || 'custom').toLowerCase();
      var kind = KINDS['wb:' + rawType] ? 'wb:' + rawType : 'wb:custom';
      var id = 'wb:' + w.id;
      var node = g.add(id, kind, w.name || 'Unnamed', w, w.id);
      var wbWords = countWordsIn(w, ['description', 'notes']);
      (w.extraFields || []).forEach(function (f) { if (f) wbWords += countWords(f.value); });
      node.words = wbWords;
      var tpl = tplByKey.get(rawType);
      if (kind === 'wb:custom') {
        // A custom type is still a type, so it keeps its own colour: the one on
        // its template, or a stable colour derived from the type name.
        node.typeLabel = (tpl && tpl.label) || w.type || 'Worldbuilding';
        node.baseColor = (tpl && tpl.color) || hashColor(rawType);
        node.color = node.baseColor;
      } else {
        node.typeLabel = KINDS[kind].label.replace(/s$/, '');
      }
      g.alias(w.name, id);
    });

    // --- Tag vocabulary (kept only if something references it, unless orphans shown)
    tags.forEach(function (t) {
      if (!t) return;
      g.add('tag:' + String(t).toLowerCase(), 'tag', String(t), { name: String(t) }, null);
    });

    function tagNode(raw) {
      var name = String(raw || '').trim();
      if (!name) return null;
      var id = 'tag:' + name.toLowerCase();
      g.add(id, 'tag', name, { name: name }, null);   // returns the existing node if there is one
      return id;
    }

    // --- Notes
    notes.forEach(function (n) {
      if (!n) return;
      var label = firstLine(n.textAssociated, 42) || firstLine(n.content, 42) ||
        firstLine(n.type, 42) || 'Note';
      var noteNode = g.add('note:' + n.id, 'note', label, n, n.id);
      noteNode.words = countWordsIn(n, ['textAssociated', 'content']);
    });

    // --- Collections
    collections.forEach(function (c) {
      if (!c) return;
      g.add('col:' + c.id, 'collection', c.name || 'Collection', c, c.id);
      g.alias(c.name, 'col:' + c.id);
    });

    // --- Timelines, flow maps, grids
    timelines.forEach(function (t) {
      if (!t) return;
      g.add('tl:' + t.id, 'timeline', t.name || 'Timeline', t, t.id);
    });
    flowmaps.forEach(function (f) {
      if (!f) return;
      g.add('fm:' + f.id, 'flowmap', f.name || 'Flow map', f, f.id);
    });
    plotgrids.forEach(function (p) {
      if (!p) return;
      g.add('pg:' + p.id, 'plotgrid', p.name || 'Plot grid', p, p.id);
    });
    cardboards.forEach(function (c) {
      if (!c) return;
      g.add('cb:' + c.id, 'cardboard', c.name || 'Cardboard', c, c.id);
    });

    step('Linking relations…');

    // --- Folder containment
    function linkIntoFolder(nodeId, path) {
      if (!path) return;
      var parent = parentPath(path);
      while (parent) {
        var fid = folderByPath.get(parent);
        if (fid) { g.link(fid, nodeId, 'contains', 'contains'); return; }
        parent = parentPath(parent);
      }
    }
    folders.forEach(function (f) {
      if (!f) return;
      var path = String(f.treePath || '').replace(/[/\\]+$/, '');
      var id = folderByPath.get(path);
      if (id) linkIntoFolder(id, path);
    });
    files.forEach(function (f) {
      if (f) linkIntoFolder('file:' + f.id, f.treePath || f.location);
    });
    docs.forEach(function (d) {
      if (d) linkIntoFolder('doc:' + d.id, d.treePath || d.location);
    });

    // --- Documents attached to an entity
    // A document attached to a character is not filed in the folder tree. The
    // host stores it under a virtual root instead, as in
    //   "*characters*/<character id>/<document name>"
    // so any path segment naming a known entity is a real relation.
    function linkPathOwner(nodeId, path) {
      if (!path) return;
      var segs = String(path).split(/[/\\]/).filter(Boolean);
      var underVirtualRoot = false;
      // The final segment is the item's own name, never a container.
      for (var i = 0; i < segs.length - 1; i++) {
        var seg = segs[i];
        if (/^\*.+\*$/.test(seg)) { underVirtualRoot = true; continue; }
        // Ids are always safe to match. Names only directly beneath a virtual
        // root, where a segment cannot be an ordinary folder.
        var target = g.resolveId(seg) || (underVirtualRoot ? g.resolve(seg) : null);
        if (target && target !== nodeId) g.link(nodeId, target, 'attached', 'attached to');
        underVirtualRoot = false;
      }
    }
    files.forEach(function (f) {
      if (f) linkPathOwner('file:' + f.id, f.treePath || f.location);
    });
    docs.forEach(function (d) {
      if (d) linkPathOwner('doc:' + d.id, d.treePath || d.location);
    });

    // --- Explicit links between files/docs, plus keyword tags
    function wireDocLike(item, nodeId) {
      (item.links || []).forEach(function (l) {
        var target = g.resolve(l);
        if (target) g.link(nodeId, target, 'link', 'links to');
      });
      (item.keywords || []).forEach(function (k) {
        var t = tagNode(k);
        if (t) g.link(nodeId, t, 'tag', 'tagged');
      });
      var cm = item.customMetadata;
      if (cm) {
        Object.keys(cm).forEach(function (key) {
          var target = g.resolve(cm[key]);
          if (target) g.link(nodeId, target, 'meta', key);
        });
      }
    }
    files.forEach(function (f) { if (f) wireDocLike(f, 'file:' + f.id); });
    docs.forEach(function (d) { if (d) wireDocLike(d, 'doc:' + d.id); });

    // --- Character relationships and worldbuilding ties
    characters.forEach(function (c) {
      if (!c) return;
      var id = 'char:' + c.id;
      (c.relationships || []).forEach(function (rel) {
        if (!rel) return;
        var other = g.resolve(rel.characterId);
        if (!other) return;
        var label = rel.type || 'related';
        if (rel.isBidirectional && rel.inverseType && rel.inverseType !== rel.type) {
          label = rel.type + ' / ' + rel.inverseType;
        }
        g.link(id, other, 'relationship', label);
      });
      (c.tags || []).forEach(function (t) {
        var n = tagNode(t);
        if (n) g.link(id, n, 'tag', 'tagged');
      });
      var cw = c.worldbuilding;
      if (cw) {
        Object.keys(cw).forEach(function (key) {
          var list = cw[key];
          if (!Array.isArray(list)) return;
          var label = CW_LABELS[key] || key;
          list.forEach(function (ref) {
            var target = g.resolve(ref);
            if (target) g.link(id, target, 'worldbuilding', label);
          });
        });
      }
      if (c.birthplace) {
        var bp = g.resolve(c.birthplace);
        if (bp) g.link(id, bp, 'worldbuilding', 'born in');
      }
    });

    // --- Worldbuilding tags and extra fields that name other elements
    world.forEach(function (w) {
      if (!w) return;
      var id = 'wb:' + w.id;
      (w.tags || []).forEach(function (t) {
        var n = tagNode(t);
        if (n) g.link(id, n, 'tag', 'tagged');
      });
      (w.extraFields || []).forEach(function (f) {
        if (!f || !f.value) return;
        var target = g.resolve(f.value);
        if (target) g.link(id, target, 'worldbuilding', f.key || 'related');
      });
    });

    // --- Notes anchor to their file
    notes.forEach(function (n) {
      if (!n) return;
      var target = n.fileId ? g.resolve(n.fileId) : null;
      if (!target && n.location) target = g.resolve(n.location);
      if (target) g.link('note:' + n.id, target, 'note', n.type || 'note on');
    });

    // --- Collections gather items
    collections.forEach(function (c) {
      if (!c) return;
      (c.items || []).forEach(function (item) {
        if (!item) return;
        var target = g.resolve(item.id);
        if (target) g.link('col:' + c.id, target, 'collection', item.type || 'in collection');
      });
    });

    // --- Timelines
    timelines.forEach(function (t) {
      if (!t) return;
      var id = 'tl:' + t.id;
      if (t.parentId) {
        var parent = g.resolve(t.parentId);
        if (parent) g.link(id, parent, 'timeline', 'sub-timeline of');
      }
      (t.lanes || []).forEach(function (lane) {
        (lane && lane.blocks ? lane.blocks : []).forEach(function (b) {
          if (!b) return;
          var laneName = (lane && lane.name) || 'lane';
          var f = b.fileId ? g.resolve(b.fileId) : null;
          if (f) g.link(id, f, 'timeline', laneName);
          var ch = b.characterId ? g.resolve(b.characterId) : null;
          if (ch) {
            g.link(id, ch, 'timeline', laneName);
            if (f) g.link(ch, f, 'timeline', 'appears in');
          }
          var wb = b.worldbuildingId ? g.resolve(b.worldbuildingId) : null;
          if (wb) {
            g.link(id, wb, 'timeline', laneName);
            if (f) g.link(wb, f, 'timeline', 'featured in');
          }
          var child = b.childTimelineId ? g.resolve(b.childTimelineId) : null;
          if (child) g.link(id, child, 'timeline', 'nested');
        });
      });
    });

    // --- Flow maps
    flowmaps.forEach(function (f) {
      if (!f) return;
      var id = 'fm:' + f.id;
      var linkedByNode = new Map();
      (f.nodes || []).forEach(function (n) {
        if (!n) return;
        var targets = [];
        [n.linkedDocument, n.linkedCharacterId, n.linkedWorldbuildingId].forEach(function (ref) {
          if (!ref) return;
          var target = g.resolve(ref);
          if (target) targets.push(target);
        });
        if (targets.length) linkedByNode.set(n.id, targets);
        targets.forEach(function (target) {
          g.link(id, target, 'flowmap', n.label || 'flow node');
        });
      });
      // A connection between two flow nodes that both point at project entities
      // is a real relation between those entities — keep it.
      (f.connections || []).forEach(function (c) {
        if (!c) return;
        var from = linkedByNode.get(c.fromNodeId) || [];
        var to = linkedByNode.get(c.toNodeId) || [];
        from.forEach(function (a) {
          to.forEach(function (b) {
            g.link(a, b, 'flowmap', c.label || 'flow');
          });
        });
      });
    });

    // --- Plot grids and cardboards reference entities from their cells
    plotgrids.forEach(function (p) {
      if (!p) return;
      var colName = new Map();
      (p.columns || []).forEach(function (c) { if (c) colName.set(c.id, c.name); });
      (p.cells || []).forEach(function (cell) {
        if (!cell || !cell.referenceId) return;
        var target = g.resolve(cell.referenceId);
        if (target) g.link('pg:' + p.id, target, 'plotgrid', colName.get(cell.columnId) || cell.type || 'cell');
      });
    });
    cardboards.forEach(function (cb) {
      if (!cb) return;
      (cb.cells || []).forEach(function (cell) {
        if (!cell || !cell.referenceId) return;
        var target = g.resolve(cell.referenceId);
        if (target) g.link('cb:' + cb.id, target, 'cardboard', cell.title || cell.type || 'card');
      });
    });

    // Scenes are read separately, after this returns: one call per file is the
    // only unbounded loop in here, and the graph is worth looking at without it.
    var snapshot = finalize(g, meta, problems);
    snapshot.builder = g;
    snapshot.sceneFiles = files.slice(0, SCENE_FILE_CAP);
    snapshot.stats.skippedSceneFiles = Math.max(0, files.length - SCENE_FILE_CAP);
    return snapshot;
  }

  // Rebuild the flat arrays and node degrees from a builder.
  function finalize(g, meta, problems) {
    var nodes = Array.from(g.nodes.values());
    var edges = Array.from(g.edges.values());
    nodes.forEach(function (n) { n.deg = 0; });
    edges.forEach(function (e) {
      var a = g.nodes.get(e.s), b = g.nodes.get(e.t);
      if (a) a.deg++;
      if (b) b.deg++;
    });
    return {
      nodes: nodes,
      edges: edges,
      index: g.nodes,
      meta: meta,
      problems: problems,
      stats: { scenes: 0 }
    };
  }

  // A file's scenes only change when the file does, so cache them against the
  // file's own stamp. A refresh then costs a call only for files that moved.
  function sceneStamp(file) {
    return String(file.hash || '') + ':' + String(file.lastModified || 0);
  }

  function applyScenes(g, fileId, list, counter) {
    var fileNode = 'file:' + fileId;
    (list || []).forEach(function (s) {
      if (!s) return;
      counter.n++;
      var kindLabel = SCENE_TYPE_LABELS[s.type] || s.type || 'scene';
      if (s.povCharacterId) {
        var pov = g.resolve(s.povCharacterId);
        if (pov) g.link(pov, fileNode, 'scene', 'POV · ' + kindLabel);
      }
      (s.charactersInScene || []).forEach(function (cid) {
        var ch = g.resolve(cid);
        if (ch) g.link(ch, fileNode, 'scene', 'in ' + kindLabel);
      });
      (s.objectsInScene || []).forEach(function (oid) {
        var ob = g.resolve(oid);
        if (ob) g.link(ob, fileNode, 'scene', 'appears in ' + kindLabel);
      });
      if (s.locationId) {
        var loc = g.resolve(s.locationId);
        if (loc) g.link(loc, fileNode, 'scene', 'setting of ' + kindLabel);
      }
    });
  }

  // Feeds scene links back as they arrive. `onBatch` runs after every chunk;
  // returning false from `alive` abandons the scan.
  async function scanScenes(result, cache, alive, onBatch) {
    var g = result.builder;
    var files = result.sceneFiles || [];
    var problems = result.problems;
    var counter = { n: 0 };
    var pending = [];

    // Cached files first, in one synchronous pass and with no API calls at all.
    files.forEach(function (f) {
      var hit = cache.get(f.id);
      if (hit && hit.stamp === sceneStamp(f)) applyScenes(g, f.id, hit.scenes, counter);
      else pending.push(f);
    });
    result.stats.scenes = counter.n;
    onBatch(files.length - pending.length, files.length);
    if (!pending.length || !alive()) return;

    for (var i = 0; i < pending.length; i += SCENE_CHUNK) {
      if (!alive()) return;
      var chunk = pending.slice(i, i + SCENE_CHUNK);
      var started = Date.now();
      var lists = await Promise.all(chunk.map(function (f) {
        return safeCall(function () { return tintero.project.getScenes(f.id); }, null, problems, 'scenes');
      }));
      if (!alive()) return;

      /* eslint-disable no-loop-func */
      lists.forEach(function (list, k) {
        if (list === null) return;              // the read failed; don't cache it
        cache.set(chunk[k].id, { stamp: sceneStamp(chunk[k]), scenes: list });
        applyScenes(g, chunk[k].id, list, counter);
      });
      /* eslint-enable no-loop-func */

      result.stats.scenes = counter.n;
      onBatch(files.length - pending.length + Math.min(i + chunk.length, pending.length), files.length);

      // Hold the call rate well under the host's 100-per-second ceiling, without
      // sleeping any longer than the bridge already took on its own.
      var spent = Date.now() - started;
      var budget = (chunk.length / SCENE_RATE) * 1000;
      if (spent < budget) await sleep(budget - spent);
    }
  }

  // ── Force layout (Barnes–Hut) ────────────────────────────────────────────

  var MAX_DEPTH = 22;

  function quadIndex(cell, p) {
    return (p.x >= cell.x + cell.s / 2 ? 1 : 0) + (p.y >= cell.y + cell.s / 2 ? 2 : 0);
  }

  function makeCell(x, y, s) {
    return { x: x, y: y, s: s, p: null, more: null, kids: null, m: 0, cx: 0, cy: 0 };
  }

  function qInsert(cell, p, depth) {
    while (cell.kids) {
      cell = cell.kids[quadIndex(cell, p)];
      depth++;
    }
    if (!cell.p) { cell.p = p; return; }
    if (depth >= MAX_DEPTH) {
      (cell.more || (cell.more = [])).push(p);
      return;
    }
    var old = cell.p;
    cell.p = null;
    var h = cell.s / 2;
    cell.kids = [
      makeCell(cell.x, cell.y, h),
      makeCell(cell.x + h, cell.y, h),
      makeCell(cell.x, cell.y + h, h),
      makeCell(cell.x + h, cell.y + h, h)
    ];
    qInsert(cell.kids[quadIndex(cell, old)], old, depth + 1);
    qInsert(cell.kids[quadIndex(cell, p)], p, depth + 1);
  }

  function qMass(cell) {
    if (cell.kids) {
      var m = 0, cx = 0, cy = 0;
      for (var i = 0; i < 4; i++) {
        var k = cell.kids[i];
        qMass(k);
        if (k.m) { m += k.m; cx += k.cx * k.m; cy += k.cy * k.m; }
      }
      cell.m = m;
      if (m) { cell.cx = cx / m; cell.cy = cy / m; }
      return;
    }
    var count = cell.p ? 1 : 0;
    var sx = cell.p ? cell.p.x : 0;
    var sy = cell.p ? cell.p.y : 0;
    if (cell.more) {
      for (var j = 0; j < cell.more.length; j++) {
        count++; sx += cell.more[j].x; sy += cell.more[j].y;
      }
    }
    cell.m = count;
    if (count) { cell.cx = sx / count; cell.cy = sy / count; }
  }

  function qRepel(cell, p, theta2, strength, alpha) {
    if (!cell.m) return;
    var dx = cell.cx - p.x;
    var dy = cell.cy - p.y;
    var d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 0.5; dy = (Math.random() - 0.5) * 0.5; d2 = dx * dx + dy * dy + 1e-6; }

    if (!cell.kids) {
      if (cell.p === p && !cell.more) return;
      var m = cell.m - (cell.p === p || (cell.more && cell.more.indexOf(p) !== -1) ? 1 : 0);
      if (m <= 0) return;
      var w = -strength * m * alpha / d2;
      p.vx += dx * w; p.vy += dy * w;
      return;
    }
    if ((cell.s * cell.s) / d2 < theta2) {
      var w2 = -strength * cell.m * alpha / d2;
      p.vx += dx * w2; p.vy += dy * w2;
      return;
    }
    for (var i = 0; i < 4; i++) qRepel(cell.kids[i], p, theta2, strength, alpha);
  }

  function Sim() {
    this.nodes = [];
    this.edges = [];
    this.alpha = 1;
    this.alphaMin = 0.006;
    this.alphaDecay = 0.0215;
    this.velocityDecay = 0.42;
    this.repel = 260;
    this.linkDist = 46;
    this.linkStrength = 0.42;
    this.gravity = 0.035;
    this.center = { x: 0, y: 0 };
  }

  Sim.prototype.setData = function (nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
    var byId = new Map();
    nodes.forEach(function (n) { byId.set(n.id, n); });
    this.links = [];
    var self = this;
    edges.forEach(function (e) {
      var a = byId.get(e.s), b = byId.get(e.t);
      if (a && b) self.links.push({ a: a, b: b, e: e });
    });
  };

  Sim.prototype.reheat = function (a) {
    this.alpha = Math.max(this.alpha, a == null ? 1 : a);
    // The view only animates while something moves, so a layout that has come
    // back to life has to say so.
    if (this.onReheat) this.onReheat();
  };

  Sim.prototype.tick = function () {
    var nodes = this.nodes;
    if (!nodes.length) return;
    this.alpha += (0 - this.alpha) * this.alphaDecay;
    var alpha = this.alpha;
    var i, n;

    // Repulsion via Barnes–Hut.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    var size = Math.max(maxX - minX, maxY - minY, 1) * 1.05 + 2;
    var root = makeCell(minX - 1, minY - 1, size);
    for (i = 0; i < nodes.length; i++) qInsert(root, nodes[i], 0);
    qMass(root);
    var strength = this.repel;
    for (i = 0; i < nodes.length; i++) qRepel(root, nodes[i], 0.81, strength, alpha);

    // Springs.
    var links = this.links;
    for (i = 0; i < links.length; i++) {
      var l = links[i], a = l.a, b = l.b;
      var dx = b.x - a.x + (Math.random() - 0.5) * 1e-3;
      var dy = b.y - a.y + (Math.random() - 0.5) * 1e-3;
      var d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      var rest = this.linkDist + a.r + b.r;
      var f = ((d - rest) / d) * alpha * this.linkStrength;
      var bias = (a.deg + 1) / (a.deg + b.deg + 2);
      a.vx += dx * f * (1 - bias); a.vy += dy * f * (1 - bias);
      b.vx -= dx * f * bias;       b.vy -= dy * f * bias;
    }

    // Gentle pull to centre + integration.
    var gx = this.center.x, gy = this.center.y, grav = this.gravity * alpha;
    var decay = 1 - this.velocityDecay;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
      n.vx += (gx - n.x) * grav;
      n.vy += (gy - n.y) * grav;
      n.vx *= decay; n.vy *= decay;
      var speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > 40) { n.vx = n.vx / speed * 40; n.vy = n.vy / speed * 40; }
      n.x += n.vx; n.y += n.vy;
    }
  };

  Sim.prototype.running = function () {
    return this.alpha > this.alphaMin;
  };

  // ── The view ─────────────────────────────────────────────────────────────

  function GraphView(root) {
    this.root = root;
    this.prefs = normalizePrefs(null);
    this.hidden = new Set(this.prefs.hidden);
    this.graph = { nodes: [], edges: [], index: new Map(), meta: null, problems: [], stats: {} };
    this.visNodes = [];
    this.visEdges = [];
    this.visIndex = new Map();
    this.adj = new Map();
    this.sim = new Sim();
    this.cam = { x: 0, y: 0, z: 1 };
    this.hover = null;
    this.selected = null;
    this.search = '';
    this.matches = new Set();
    this.hits = [];          // ranked search results, best first
    this.hiddenHits = 0;     // matches the filters are currently hiding
    this.activeHit = 0;
    this.dragNode = null;
    this.loading = false;
    this.destroyed = false;
    this.dpr = 1;
    this.portraitCache = new Map();
    this.sceneCache = new Map();   // fileId → { stamp, scenes }
    this.sceneProgress = null;

    // Preferences are written back on a trailing debounce, one write at a time.
    // A save asked for while a write is still in flight is not dropped: it
    // runs once that write finishes, and takes its snapshot then, so the
    // latest preferences are what end up stored.
    var self = this;
    var writing = false, again = false;
    var write = function () {
      if (self.destroyed) return;
      if (writing) { again = true; return; }
      writing = true;
      // Called inside then() so a bridge that throws rather than rejects
      // cannot leave `writing` stuck on for good.
      Promise.resolve()
        .then(function () { return tintero.storage.set(PREFS_KEY, self.prefSnapshot()); })
        .catch(function () { /* preferences are a nicety, not worth surfacing */ })
        .then(function () {
          writing = false;
          if (again) { again = false; write(); }
        });
    };
    this.savePrefs = debounce(write, 500);

    this.build();
  }

  GraphView.prototype.prefSnapshot = function () {
    return Object.assign({}, this.prefs, { hidden: Array.from(this.hidden) });
  };

  // --- DOM -----------------------------------------------------------------

  GraphView.prototype.build = function () {
    var self = this;
    var r = this.root;
    r.className = 'tgv-root';
    r.innerHTML = '';

    // Light/dark: derive from the host background so we sit on it properly.
    try {
      var bg = getComputedStyle(document.body).backgroundColor || '';
      var m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (m) {
        var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
        if (lum > 0.55) r.classList.add('tgv-light');
      }
    } catch (e) { /* keep the dark default */ }

    this.canvas = el('canvas', 'tgv-canvas');
    r.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Toolbar
    var bar = el('div', 'tgv-pane tgv-toolbar');
    var title = el('div', 'tgv-title');
    title.innerHTML = svgIcon(ICON.graph) + '<span>Graph View</span>';
    this.projectLabel = el('span', 'tgv-project');
    title.appendChild(this.projectLabel);
    bar.appendChild(title);

    this.btnPanel = this.makeBtn(ICON.panel, 'Panel', function () {
      // On a narrow screen both panels share one bottom sheet and the details
      // win. Pressing Panel there means "show me the filters", not "toggle a
      // panel you cannot currently see".
      if (self.isNarrow() && self.detailsOpen()) {
        self.selected = null;
        self.hideDetails();
        self.setSideOpen(true);
      } else {
        self.setSideOpen(!self.sideVisible());
      }
    });
    bar.appendChild(this.btnPanel);

    bar.appendChild(el('div', 'tgv-spacer'));

    // The input and its result list share a positioned wrapper so the list
    // stays anchored to the box however the toolbar wraps.
    var searchWrap = el('div', 'tgv-search-wrap');
    this.searchInput = el('input', 'tgv-search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search nodes…';
    this.searchInput.addEventListener('input', function () {
      self.setSearch(self.searchInput.value);
    });
    this.searchInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); self.moveActive(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); self.moveActive(-1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); self.jumpToActive(); }
    });
    searchWrap.appendChild(this.searchInput);
    this.results = el('div', 'tgv-results tgv-hidden');
    searchWrap.appendChild(this.results);
    bar.appendChild(searchWrap);

    this.btnFit = this.makeBtn(ICON.fit, 'Fit', function () { self.fit(true); });
    bar.appendChild(this.btnFit);

    this.btnLive = this.makeBtn(ICON.live, 'Live', function () {
      self.prefs.autoRefresh = !self.prefs.autoRefresh;
      self.btnLive.setAttribute('aria-pressed', String(self.prefs.autoRefresh));
      self.savePrefs();
      // The status dot lives in the status bar, which only redraws when asked.
      // Without this, switching Live off left the dot pulsing green until some
      // unrelated change happened to repaint it.
      self.renderStatus();
      if (self.prefs.autoRefresh) self.scheduleRefresh();
    });
    this.btnLive.title = 'Refresh automatically when the project changes';
    bar.appendChild(this.btnLive);

    this.btnRefresh = this.makeBtn(ICON.refresh, 'Refresh', function () { self.reload(true); });
    bar.appendChild(this.btnRefresh);

    r.appendChild(bar);
    this.bar = bar;

    // Left panel
    this.side = el('div', 'tgv-pane tgv-side');
    this.sideScroll = el('div', 'tgv-side-scroll');
    this.side.appendChild(this.sideScroll);
    r.appendChild(this.side);

    // Details
    this.details = el('div', 'tgv-pane tgv-details tgv-hidden');
    r.appendChild(this.details);

    // Status + hint
    this.status = el('div', 'tgv-pane tgv-status');
    r.appendChild(this.status);
    var hint = el('div', 'tgv-pane tgv-hint', COARSE
      ? 'Drag to pan · pinch to zoom · tap a node'
      : 'Drag to pan · scroll to zoom · click a node');
    r.appendChild(hint);

    // Overlay
    this.overlay = el('div', 'tgv-overlay');
    r.appendChild(this.overlay);
    this.setOverlay('Reading your project…', '', true);

    this.bindCanvas();
    this.bindResize();
  };

  GraphView.prototype.makeBtn = function (icon, label, onClick) {
    var b = el('button', 'tgv-btn');
    b.type = 'button';
    b.innerHTML = svgIcon(icon) + '<span>' + label + '</span>';
    // Narrow screens hide the text and leave only the icon, so the name has to
    // survive somewhere a tooltip and a screen reader can find it.
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };

  // Whether the filter panel shows. On a smaller window it starts closed, so the
  // graph gets the room; on a larger one it follows the saved preference. A
  // choice made by hand wins either way, until the window next crosses
  // SIDE_AUTO_MAX, when the automatic rule takes over again.
  GraphView.prototype.sideVisible = function () {
    if (this.sideManual != null) return this.sideManual;
    return this.compact ? false : this.prefs.sideOpen;
  };

  GraphView.prototype.setSideOpen = function (open) {
    this.sideManual = open;
    // Only a choice made with room to spare is worth remembering: closing the
    // panel on a phone should not close it on the desktop next time.
    if (!this.compact) {
      this.prefs.sideOpen = open;
      this.savePrefs();
    }
    this.applyPanelState();
  };

  GraphView.prototype.applyPanelState = function () {
    var open = this.sideVisible();
    this.side.classList.toggle('tgv-collapsed', !open);
    this.btnPanel.setAttribute('aria-pressed', String(open));
  };

  GraphView.prototype.setOverlay = function (heading, body, busy) {
    if (heading == null) { this.overlay.classList.add('tgv-hidden'); return; }
    this.overlay.classList.remove('tgv-hidden');
    this.overlay.innerHTML = '';
    var h = el('h2', null, heading);
    this.overlay.appendChild(h);
    if (body) this.overlay.appendChild(el('p', null, body));
    if (busy) {
      var bar = el('div', 'tgv-bar');
      bar.appendChild(el('i'));
      this.overlay.appendChild(bar);
    }
  };

  // --- Preferences ---------------------------------------------------------

  GraphView.prototype.loadPrefs = async function () {
    try {
      var saved = await tintero.storage.get(PREFS_KEY);
      if (saved && typeof saved === 'object') this.prefs = normalizePrefs(saved);
    } catch (e) { /* defaults are fine */ }
    this.hidden = new Set(this.prefs.hidden);
    this.applyPanelState();
    this.btnLive.setAttribute('aria-pressed', String(this.prefs.autoRefresh));
    this.applyForces();
  };

  GraphView.prototype.applyForces = function () {
    this.sim.repel = 260 * (this.prefs.repel || 1);
    this.sim.linkDist = 46 * (this.prefs.linkDist || 1);
  };

  // --- Data ----------------------------------------------------------------

  GraphView.prototype.reload = async function (manual) {
    if (this.destroyed) return;
    // A refresh asked for while one is running could otherwise be dropped,
    // and a change made mid-read would stay missing until the next edit. Any
    // number of such requests collapse into one more read afterwards.
    if (this.loading) {
      this.reloadQueued = true;
      this.reloadQueuedManual = this.reloadQueuedManual || !!manual;
      return;
    }
    this.loading = true;
    this.btnRefresh.classList.add('tgv-spin');
    var self = this;
    var first = this.graph.nodes.length === 0;
    if (first) this.setOverlay('Reading your project…', '', true);

    try {
      var next = await collect(function (msg) {
        if (first) self.setOverlay(msg, '', true);
      });
      if (this.destroyed) return;
      this.applyGraph(next, manual);
      this.startSceneScan(next);
    } catch (err) {
      var message = String((err && err.message) || err);
      if (first) {
        this.setOverlay('Could not read the project', message);
      } else {
        this.notify('Graph View could not refresh: ' + message, 'error');
      }
    } finally {
      this.loading = false;
      this.btnRefresh.classList.remove('tgv-spin');
      if (this.reloadQueued && !this.destroyed) {
        var queuedManual = this.reloadQueuedManual;
        this.reloadQueued = false;
        this.reloadQueuedManual = false;
        this.reload(queuedManual);
      }
    }
  };

  // Scene links arrive after the first paint. Each reload gets a generation
  // number so a scan from a superseded reload stops touching the graph.
  GraphView.prototype.startSceneScan = function (result) {
    var self = this;
    var gen = (this.scanGen = (this.scanGen || 0) + 1);
    var alive = function () { return !self.destroyed && self.scanGen === gen; };
    if (!result.sceneFiles || !result.sceneFiles.length) return;

    this.sceneProgress = { done: 0, total: result.sceneFiles.length };
    this.renderStatus();

    var before = result.edges.length;
    scanScenes(result, this.sceneCache, alive, function (done, total) {
      if (!alive()) return;
      self.sceneProgress = done >= total ? null : { done: done, total: total };
      if (result.builder.edges.size !== before) {
        before = result.builder.edges.size;
        var fresh = finalize(result.builder, result.meta, result.problems);
        fresh.stats = result.stats;
        fresh.builder = result.builder;
        fresh.sceneFiles = result.sceneFiles;
        result.nodes = fresh.nodes;
        result.edges = fresh.edges;
        self.graph = fresh;
        self.recompute(false);
        self.updateDiff();
        if (self.selected) self.showDetails(self.selected);
      }
      self.renderStatus();
    }).catch(function () {
      if (alive()) { self.sceneProgress = null; self.renderStatus(); }
    });
  };

  // "+3 nodes · +5 links" against the graph as it stood before this reload.
  // Recomputed as late-arriving scene links land, so the count stays honest.
  GraphView.prototype.updateDiff = function () {
    var d = this._diff;
    if (!d) return;
    if (d.firstLoad) { this.flash = null; return; }

    var base = d.base, fresh = 0;
    var present = new Set();
    this.graph.edges.forEach(function (e) {
      present.add(e.key);
      if (!base.has(e.key)) fresh++;
    });

    // Links only look "removed" until the scene scan has put them back, so
    // only count removals once the graph is complete.
    var gone = 0;
    if (!this.sceneProgress) {
      base.forEach(function (k) { if (!present.has(k)) gone++; });
    }

    var parts = [];
    if (d.newNodes) parts.push('+' + d.newNodes + ' node' + (d.newNodes === 1 ? '' : 's'));
    if (fresh) parts.push('+' + fresh + ' link' + (fresh === 1 ? '' : 's'));
    if (gone) parts.push('−' + gone + ' link' + (gone === 1 ? '' : 's'));

    var msg = null;
    if (parts.length) msg = parts.join(' · ');
    else if (d.manual) msg = 'no changes';
    this.flash = msg ? { text: msg } : null;

    // Its own timer: the frame loop stops when nothing moves, so it cannot be
    // what takes the message down again.
    var self = this;
    clearTimeout(this.flashTimer);
    if (this.flash) {
      this.flashTimer = setTimeout(function () {
        self.flash = null;
        if (!self.destroyed) self.renderStatus();
      }, 6000);
    }
  };

  GraphView.prototype.applyGraph = function (next, manual) {
    var prev = this.graph;
    var prevPos = new Map();
    prev.nodes.forEach(function (n) { prevPos.set(n.id, n); });

    var prevEdgeKeys = new Set(prev.edges.map(function (e) { return e.key; }));
    var newNodes = 0;

    // Keep positions for nodes we already had so the view does not jump.
    var spread = Math.max(160, Math.sqrt(next.nodes.length + 1) * 40);
    next.nodes.forEach(function (n) {
      var old = prevPos.get(n.id);
      if (old) {
        n.x = old.x; n.y = old.y; n.vx = old.vx * 0.4; n.vy = old.vy * 0.4;
        n.fixed = old.fixed;
      } else {
        newNodes++;
        var angle = Math.random() * Math.PI * 2;
        var rad = Math.sqrt(Math.random()) * spread;
        n.x = Math.cos(angle) * rad;
        n.y = Math.sin(angle) * rad;
      }
    });
    this._diff = {
      base: prevEdgeKeys,
      firstLoad: prev.nodes.length === 0,
      manual: !!manual,
      newNodes: newNodes
    };

    this.graph = next;
    if (next.meta && next.meta.name) this.projectLabel.textContent = '· ' + next.meta.name;

    this.recompute(prev.nodes.length === 0);

    // Keep the selection alive across refreshes.
    if (this.selected && !this.graph.index.has(this.selected)) this.selected = null;
    if (this.selected) this.showDetails(this.selected); else this.hideDetails();

    this.updateDiff();
    if (this.flash && this.flash.text !== 'no changes') this.sim.reheat(0.5);

    this.renderStatus();
    this.renderFilters();
    this.updateEmptyState();
  };

  // Distinguishes "this project has nothing to draw" from "you have filtered
  // everything away", because the fix is different in each case.
  GraphView.prototype.updateEmptyState = function () {
    if (!this.graph.nodes.length) {
      this.setOverlay('Nothing to map yet',
        'Graph View draws characters, worldbuilding, files, scenes, tags and the links between them. Add some of those to this project, then press Refresh.');
    } else if (!this.visNodes.length) {
      this.setOverlay('Everything is hidden',
        this.hidden.size
          ? 'Every node type is switched off in the panel on the left. Turn one back on to see the graph.'
          : 'Nothing in this project is connected to anything else yet. Switch on "Unconnected nodes" on the left to see the pieces on their own.');
    } else {
      this.setOverlay(null);
    }
  };

  // A kind's colour: the reader's choice if they made one, else the default.
  GraphView.prototype.colorForKind = function (kind, fallback) {
    var chosen = this.prefs.kindColors && this.prefs.kindColors[kind];
    return HEX_RE.test(chosen || '') ? chosen : fallback;
  };

  // Every custom worldbuilding type shares the 'wb:custom' kind, so overriding
  // that one row paints them all the same. Left alone they keep the individual
  // colours from their templates.
  GraphView.prototype.applyColors = function () {
    var self = this;
    this.invalidate();
    this.graph.nodes.forEach(function (n) {
      n.color = self.colorForKind(n.kind, n.baseColor);
    });
  };

  GraphView.prototype.recompute = function (doFit) {
    var hidden = this.hidden;
    this.applyColors();

    var visible = this.graph.nodes.filter(function (n) { return !hidden.has(n.kind); });
    var visibleIds = new Set(visible.map(function (n) { return n.id; }));

    var edges = this.graph.edges.filter(function (e) {
      return visibleIds.has(e.s) && visibleIds.has(e.t);
    });

    // Adjacency over the visible subgraph.
    var adj = new Map();
    visible.forEach(function (n) { adj.set(n.id, []); });
    edges.forEach(function (e) {
      adj.get(e.s).push({ other: e.t, edge: e });
      adj.get(e.t).push({ other: e.s, edge: e });
    });

    if (!this.prefs.showOrphans) {
      visible = visible.filter(function (n) { return adj.get(n.id).length > 0; });
      visibleIds = new Set(visible.map(function (n) { return n.id; }));
      edges = edges.filter(function (e) { return visibleIds.has(e.s) && visibleIds.has(e.t); });
      var adj2 = new Map();
      visible.forEach(function (n) { adj2.set(n.id, []); });
      edges.forEach(function (e) {
        adj2.get(e.s).push({ other: e.t, edge: e });
        adj2.get(e.t).push({ other: e.s, edge: e });
      });
      adj = adj2;
    }

    // Node size carries one of two meanings, chosen in the panel. Both use the
    // same +0..+7 range on top of the per-kind base, so switching modes rescales
    // the picture rather than replacing it.
    //
    // Length mode normalises against the project's own 95th percentile rather
    // than its maximum: a single enormous chapter would otherwise flatten every
    // other node to nothing. Anything at or above that mark takes the full
    // boost. The sqrt curve matches the degree mode's, so the two views feel
    // like the same graph.
    var byLength = this.prefs.sizeBy === 'length';
    var scale = 0;
    if (byLength) {
      var counts = [];
      visible.forEach(function (n) { if (n.words > 0) counts.push(n.words); });
      if (counts.length) {
        counts.sort(function (a, b) { return a - b; });
        scale = counts[Math.floor(0.95 * (counts.length - 1))] || 0;
      }
    }

    var visIndex = new Map();
    visible.forEach(function (n) {
      var d = adj.get(n.id).length;
      n.visDeg = d;
      var boost;
      if (byLength) {
        boost = scale > 0 ? 7 * Math.sqrt(Math.min(1, (n.words || 0) / scale)) : 0;
      } else {
        boost = Math.min(7, Math.sqrt(d) * 1.5);
      }
      n.r = kindOf(n.kind).r + boost;
      visIndex.set(n.id, n);
    });

    this.visNodes = visible;
    this.visEdges = edges;
    this.visIndex = visIndex;
    this.adj = adj;
    this.sim.setData(visible, edges);
    this.sim.reheat(doFit ? 1 : 0.45);
    this.applySearch();
    if (doFit) {
      // Let the layout settle a little before framing it.
      this.pendingFit = 60;
    }
    this.renderStatus();
    if (this.graph.nodes.length) this.updateEmptyState();
  };

  // --- Filters and legend --------------------------------------------------

  // The legend swatch doubles as the colour control for its kind. Clicks must
  // not reach the row, or picking a colour would also hide the type.
  GraphView.prototype.makeSwatch = function (kind, label) {
    var self = this;
    var current = this.colorForKind(kind, kindOf(kind).color);
    var swatch = el('input', 'tgv-swatch tgv-swatch-input');
    swatch.type = COLOR_INPUT_OK ? 'color' : 'text';
    swatch.value = current;
    swatch.title = 'Colour for ' + label.toLowerCase();

    if (!COLOR_INPUT_OK) {
      // No native picker: a hex field does the same job, less prettily.
      swatch.className = 'tgv-swatch-hex';
      swatch.style.color = current;
    }

    var commit = function (value) {
      if (!HEX_RE.test(value)) return;
      if (value.toLowerCase() === kindOf(kind).color.toLowerCase()) {
        delete self.prefs.kindColors[kind];
      } else {
        self.prefs.kindColors[kind] = value;
      }
      self.savePrefs();
      self.applyColors();
      if (!COLOR_INPUT_OK) swatch.style.color = value;
      if (self.resetColorsBtn) {
        self.resetColorsBtn.classList.toggle('tgv-hidden',
          !Object.keys(self.prefs.kindColors).length);
      }
      if (self.selected) self.showDetails(self.selected);
    };

    swatch.addEventListener('click', function (ev) { ev.stopPropagation(); });
    swatch.addEventListener('input', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      commit(String(swatch.value || '').trim());
    });
    return swatch;
  };

  GraphView.prototype.renderFilters = function () {
    var self = this;
    var counts = new Map();
    this.graph.nodes.forEach(function (n) {
      counts.set(n.kind, (counts.get(n.kind) || 0) + 1);
    });
    // Custom worldbuilding types can introduce kinds we do not know about.
    var order = KIND_ORDER.slice();
    counts.forEach(function (_v, k) { if (order.indexOf(k) === -1) order.push(k); });

    this.sideScroll.innerHTML = '';

    var head = el('div', 'tgv-section-title');
    head.appendChild(el('span', null, 'Node types'));
    // Always built, shown only while something is overridden — toggling a class
    // avoids re-rendering the panel while a colour input is still being dragged.
    var actions = el('span', 'tgv-title-actions');
    var resetColors = el('button', 'tgv-reset-colors', 'reset colours');
    resetColors.title = 'Put every node type back to its original colour';
    if (!Object.keys(this.prefs.kindColors).length) resetColors.classList.add('tgv-hidden');
    resetColors.addEventListener('click', function () {
      self.prefs.kindColors = {};
      self.savePrefs();
      self.applyColors();
      self.renderFilters();
      if (self.selected) self.showDetails(self.selected);
    });
    this.resetColorsBtn = resetColors;
    actions.appendChild(resetColors);
    var toggleAll = el('button', null, 'all');
    toggleAll.addEventListener('click', function () {
      if (self.hidden.size) self.hidden.clear();
      else order.forEach(function (k) { if (counts.get(k)) self.hidden.add(k); });
      self.persistHidden();
      self.renderFilters();
      self.recompute(false);
    });
    actions.appendChild(toggleAll);
    // Closes the panel from the panel itself, which is where people look for a
    // way to close it. The toolbar's Panel button brings it back.
    var hide = el('button', 'tgv-side-hide');
    hide.type = 'button';
    hide.title = 'Hide this panel';
    hide.setAttribute('aria-label', 'Hide this panel');
    hide.innerHTML = svgIcon('<polyline points="15 6 9 12 15 18"/>');
    hide.addEventListener('click', function () { self.setSideOpen(false); });
    actions.appendChild(hide);
    head.appendChild(actions);
    this.sideScroll.appendChild(head);

    order.forEach(function (kind) {
      var count = counts.get(kind) || 0;
      if (!count) return;
      var row = el('div', 'tgv-filter');
      if (self.hidden.has(kind)) row.classList.add('tgv-off');
      var label = kindOf(kind).label;
      if (kind === 'wb:custom') label = 'Other worldbuilding';
      row.appendChild(self.makeSwatch(kind, label));
      row.appendChild(el('span', 'tgv-label', label));
      row.appendChild(el('span', 'tgv-count', String(count)));
      row.title = (self.hidden.has(kind) ? 'Show ' : 'Hide ') + label.toLowerCase();
      row.addEventListener('click', function () {
        if (self.hidden.has(kind)) self.hidden.delete(kind); else self.hidden.add(kind);
        self.persistHidden();
        row.classList.toggle('tgv-off', self.hidden.has(kind));
        self.recompute(false);
      });
      self.sideScroll.appendChild(row);
    });

    // Display options
    var displayHead = el('div', 'tgv-section-title');
    displayHead.appendChild(el('span', null, 'Display'));
    this.sideScroll.appendChild(displayHead);

    var orphanRow = el('div', 'tgv-filter');
    if (!this.prefs.showOrphans) orphanRow.classList.add('tgv-off');
    var osw = el('span', 'tgv-swatch');
    osw.style.background = 'var(--tgv-fg-dim)';
    orphanRow.appendChild(osw);
    orphanRow.appendChild(el('span', 'tgv-label', 'Unconnected nodes'));
    orphanRow.addEventListener('click', function () {
      self.prefs.showOrphans = !self.prefs.showOrphans;
      orphanRow.classList.toggle('tgv-off', !self.prefs.showOrphans);
      self.savePrefs();
      self.recompute(false);
    });
    this.sideScroll.appendChild(orphanRow);

    var sizeRow = el('div', 'tgv-filter');
    if (this.prefs.sizeBy !== 'length') sizeRow.classList.add('tgv-off');
    var zsw = el('span', 'tgv-swatch');
    zsw.style.background = 'var(--tgv-fg-dim)';
    sizeRow.appendChild(zsw);
    sizeRow.appendChild(el('span', 'tgv-label', 'Size by length'));
    sizeRow.title = 'Size nodes by how much is written about them, instead of by ' +
      'how many connections they have';
    sizeRow.addEventListener('click', function () {
      self.prefs.sizeBy = self.prefs.sizeBy === 'length' ? 'links' : 'length';
      sizeRow.classList.toggle('tgv-off', self.prefs.sizeBy !== 'length');
      self.savePrefs();
      self.recompute(false);
    });
    this.sideScroll.appendChild(sizeRow);

    this.addSlider('Repel', 'repel', 0.3, 3, 0.05);
    this.addSlider('Link distance', 'linkDist', 0.3, 3, 0.05);
    this.addSlider('Label fade', 'labelZoom', 0.4, 3, 0.05);
  };

  GraphView.prototype.addSlider = function (label, key, min, max, step) {
    var self = this;
    var wrap = el('div', 'tgv-slider');
    var lab = el('label');
    lab.appendChild(el('span', null, label));
    var val = el('span', null, (this.prefs[key] || 1).toFixed(2) + '×');
    lab.appendChild(val);
    wrap.appendChild(lab);
    var input = el('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(this.prefs[key] == null ? 1 : this.prefs[key]);
    input.addEventListener('input', function () {
      self.prefs[key] = parseFloat(input.value);
      val.textContent = self.prefs[key].toFixed(2) + '×';
      self.invalidate();
      self.applyForces();
      if (key !== 'labelZoom') self.sim.reheat(0.35);
      self.savePrefs();
    });
    wrap.appendChild(input);
    this.sideScroll.appendChild(wrap);
  };

  GraphView.prototype.persistHidden = function () {
    this.prefs.hidden = Array.from(this.hidden);
    this.savePrefs();
  };

  // --- Search --------------------------------------------------------------

  GraphView.prototype.setSearch = function (value) {
    this.search = String(value || '').trim().toLowerCase();
    this.applySearch();
  };

  // Lower is better. An exact hit beats a prefix, which beats a word start,
  // which beats a match buried mid-word.
  function searchScore(label, q) {
    var l = label.toLowerCase();
    var i = l.indexOf(q);
    if (i === -1) return -1;
    if (l === q) return 0;
    if (i === 0) return 1;
    return /[\s\-_/([]/.test(l.charAt(i - 1)) ? 2 : 3;
  }

  var MAX_RESULTS = 12;

  GraphView.prototype.applySearch = function () {
    this.invalidate();
    this.matches = new Set();
    this.hits = [];
    this.hiddenHits = 0;
    this.activeHit = 0;

    var q = this.search;
    if (!q) { this.renderResults(); return; }

    var scored = [];
    this.visNodes.forEach(function (n) {
      var s = searchScore(n.label, q);
      if (s < 0) return;
      this.matches.add(n.id);
      scored.push({ node: n, score: s });
    }, this);

    // Matches that exist but are filtered out. Reported rather than listed —
    // jumping to a node the filters are hiding would be a confusing no-op.
    var visIndex = this.visIndex;
    this.graph.nodes.forEach(function (n) {
      if (!visIndex.has(n.id) && searchScore(n.label, q) >= 0) this.hiddenHits++;
    }, this);

    scored.sort(function (a, b) {
      return a.score - b.score ||
        (b.node.visDeg || 0) - (a.node.visDeg || 0) ||
        a.node.label.localeCompare(b.node.label);
    });
    this.hits = scored.map(function (s) { return s.node; });
    this.renderResults();
  };

  GraphView.prototype.renderResults = function () {
    if (!this.results) return;
    var self = this;
    this.results.innerHTML = '';

    if (!this.search || (!this.hits.length && !this.hiddenHits)) {
      this.results.classList.add('tgv-hidden');
      if (this.search && !this.hits.length) {
        this.results.classList.remove('tgv-hidden');
        this.results.appendChild(el('div', 'tgv-result-none', 'No node matches that.'));
      }
      return;
    }
    this.results.classList.remove('tgv-hidden');

    this.hits.slice(0, MAX_RESULTS).forEach(function (node, i) {
      var row = el('div', 'tgv-result');
      if (i === self.activeHit) row.classList.add('tgv-active');
      var sw = el('span', 'tgv-swatch');
      sw.style.background = node.color;
      row.appendChild(sw);
      row.appendChild(el('span', 'tgv-label', node.label));
      row.appendChild(el('span', 'tgv-edge', self.kindLabelFor(node)));
      row.title = node.label + ' — ' + self.kindLabelFor(node);
      // mousedown, not click: the input blurs before a click would land.
      row.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        self.activeHit = i;
        self.jumpToActive();
      });
      self.results.appendChild(row);
    });

    var extra = [];
    if (this.hits.length > MAX_RESULTS) extra.push((this.hits.length - MAX_RESULTS) + ' more');
    if (this.hiddenHits) extra.push(this.hiddenHits + ' hidden by filters');
    if (extra.length) this.results.appendChild(el('div', 'tgv-result-none', extra.join(' · ')));
  };

  GraphView.prototype.moveActive = function (delta) {
    var shown = Math.min(this.hits.length, MAX_RESULTS);
    if (!shown) return;
    this.activeHit = (this.activeHit + delta + shown) % shown;
    this.renderResults();
  };

  GraphView.prototype.jumpToActive = function () {
    var node = this.hits[this.activeHit];
    if (!node) return;
    this.closeResults();
    this.focusNode(node.id);
  };

  GraphView.prototype.closeResults = function () {
    if (this.results) this.results.classList.add('tgv-hidden');
  };

  // --- Details panel -------------------------------------------------------

  GraphView.prototype.hideDetails = function () {
    this.invalidate();
    this.details.classList.add('tgv-hidden');
    this.root.classList.remove('tgv-has-details');
  };

  GraphView.prototype.detailsOpen = function () {
    return !this.details.classList.contains('tgv-hidden');
  };

  GraphView.prototype.kindLabelFor = function (node) {
    if (node.kind.indexOf('wb:') === 0) {
      return node.typeLabel || kindOf(node.kind).label.replace(/s$/, '');
    }
    return kindOf(node.kind).label.replace(/s$/, '');
  };

  GraphView.prototype.showDetails = function (nodeId) {
    var self = this;
    var node = this.graph.index.get(nodeId);
    if (!node) { this.hideDetails(); return; }
    this.details.classList.remove('tgv-hidden');
    this.invalidate();
    // Lets the stylesheet give the details the bottom sheet on narrow screens.
    this.root.classList.add('tgv-has-details');
    this.details.innerHTML = '';

    var head = el('div', 'tgv-det-head');
    var portrait = null;
    var data = node.data || {};
    if (data.portrait || data.landscape) {
      portrait = el('img', 'tgv-det-portrait');
      portrait.alt = '';
      head.appendChild(portrait);
      this.loadPortrait(data.portrait || data.landscape, portrait);
    }
    var textWrap = el('div');
    textWrap.style.minWidth = '0';
    textWrap.appendChild(el('div', 'tgv-det-name', node.label));
    var kindRow = el('div', 'tgv-det-kind');
    var sw = el('span', 'tgv-swatch');
    sw.style.background = node.color;
    kindRow.appendChild(sw);
    kindRow.appendChild(el('span', null, this.kindLabelFor(node)));
    textWrap.appendChild(kindRow);
    head.appendChild(textWrap);

    // Shift-drag pins with a mouse. A finger has no Shift key, so the panel
    // offers the same thing as a button, for every kind of pointer.
    var pin = el('button', 'tgv-det-pin');
    pin.type = 'button';
    pin.addEventListener('click', function () {
      node.fixed = !node.fixed;
      node.vx = 0; node.vy = 0;
      if (!node.fixed) self.sim.reheat(0.2);
      self.syncPinButton(node);
      self.invalidate();
    });
    this.pinBtn = pin;
    this.syncPinButton(node);
    head.appendChild(pin);

    var close = el('button', 'tgv-det-close', '×');
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', function () {
      self.selected = null;
      self.hideDetails();
    });
    head.appendChild(close);
    this.details.appendChild(head);

    var body = el('div', 'tgv-det-body');

    var desc = data.description || data.physicalDescription || data.psychologicalDescription ||
      data.backstory || data.content || data.textAssociated;
    if (desc) body.appendChild(el('div', 'tgv-det-desc', firstLine(desc, 220)));

    var facts = [];
    if (node.kind === 'character') {
      if (data.pronouns && data.pronouns.length) facts.push(['Pronouns', data.pronouns.join('/')]);
      if (data.age) facts.push(['Age', data.age]);
      if (data.traits && data.traits.length) facts.push(['Traits', data.traits.slice(0, 6).join(', ')]);
      if (data.goals && data.goals.length) facts.push(['Goals', firstLine(data.goals.join('; '), 90)]);
    }
    if (node.kind === 'file' || node.kind === 'doc') {
      if (data.treePath) facts.push(['Path', data.treePath]);
      if (data.status) facts.push(['Status', data.status]);
      if (data.writingMode) facts.push(['Mode', data.writingMode]);
    }
    // What "Size by length" is measuring for this node.
    if (node.words > 0) facts.push(['Words', node.words.toLocaleString()]);
    if (data.tags && data.tags.length) facts.push(['Tags', data.tags.join(', ')]);
    if (data.lastModified) facts.push(['Modified', new Date(data.lastModified).toLocaleDateString()]);

    if (facts.length) {
      var meta = el('div', 'tgv-det-meta');
      facts.forEach(function (f) {
        var line = el('div');
        line.appendChild(el('b', null, f[0] + ': '));
        line.appendChild(document.createTextNode(String(f[1])));
        meta.appendChild(line);
      });
      body.appendChild(meta);
    }

    // `adj` only ever holds visible nodes, so these are already the visible ones.
    var visibleOnly = (this.adj.get(nodeId) || []).slice();
    visibleOnly.sort(function (a, b) {
      var an = self.graph.index.get(a.other), bn = self.graph.index.get(b.other);
      return (bn.visDeg || 0) - (an.visDeg || 0) || an.label.localeCompare(bn.label);
    });

    var relHead = el('div', 'tgv-section-title');
    relHead.appendChild(el('span', null, 'Connections'));
    relHead.appendChild(el('span', null, String(visibleOnly.length)));
    body.appendChild(relHead);

    if (!visibleOnly.length) {
      body.appendChild(el('div', 'tgv-det-meta', 'No visible connections. Some may be hidden by the node-type filters.'));
    }

    visibleOnly.slice(0, 80).forEach(function (item) {
      var other = self.graph.index.get(item.other);
      var row = el('div', 'tgv-rel');
      var s = el('span', 'tgv-swatch');
      s.style.background = other.color;
      row.appendChild(s);
      row.appendChild(el('span', 'tgv-label', other.label));
      var lbl = item.edge.labels.length ? item.edge.labels.join(', ') : item.edge.type;
      row.appendChild(el('span', 'tgv-edge', lbl));
      row.title = other.label + ' — ' + lbl;
      row.addEventListener('click', function () { self.focusNode(other.id); });
      body.appendChild(row);
    });

    // Raw API data. The SDK's type declarations do not always match what the
    // host actually returns, so this shows exactly what arrived — the quickest
    // way to work out why something did or did not become a link.
    if (node.data) {
      var rawHead = el('div', 'tgv-section-title');
      rawHead.appendChild(el('span', null, 'Raw data'));
      var toggle = el('button', null, this.showRaw ? 'hide' : 'show');
      rawHead.appendChild(toggle);
      body.appendChild(rawHead);

      var pre = el('div', 'tgv-raw');
      var text;
      try {
        text = JSON.stringify(node.data, null, 2);
      } catch (e) {
        text = String(node.data);
      }
      if (text && text.length > 6000) text = text.slice(0, 6000) + '\n…truncated';
      pre.textContent = text;
      pre.hidden = !this.showRaw;
      toggle.addEventListener('click', function () {
        self.showRaw = !self.showRaw;
        pre.hidden = !self.showRaw;
        toggle.textContent = self.showRaw ? 'hide' : 'show';
      });
      body.appendChild(pre);
    }

    this.details.appendChild(body);
  };

  // Rewrites the button in place rather than rebuilding the panel, which would
  // throw away its scroll position.
  GraphView.prototype.syncPinButton = function (node) {
    var pin = this.pinBtn;
    if (!pin) return;
    pin.textContent = node.fixed ? 'Unpin' : 'Pin';
    pin.title = node.fixed ? 'Let this node move with the layout again' : 'Hold this node where it is';
    pin.setAttribute('aria-pressed', String(!!node.fixed));
  };

  GraphView.prototype.loadPortrait = async function (ref, img) {
    if (!ref) return;
    var key = String(ref);
    try {
      var cached = this.portraitCache.get(key);
      if (cached === undefined) {
        cached = await tintero.project.getImageData(key);
        this.portraitCache.set(key, cached);
      }
      if (!cached) { img.remove(); return; }
      img.src = /^data:/.test(cached) ? cached : 'data:image/png;base64,' + cached;
    } catch (e) {
      img.remove();
    }
  };

  GraphView.prototype.focusNode = function (nodeId) {
    var node = this.visIndex.get(nodeId) || null;
    this.selected = nodeId;
    this.showDetails(nodeId);
    // Glide rather than cut, so it stays obvious where the view came from.
    // Centred in the space the panels leave, not behind the details it opened.
    if (node) {
      this.camTarget = this.camAt(node.x, node.y, Math.max(this.cam.z, 1.4));
    }
  };

  // --- Status --------------------------------------------------------------

  GraphView.prototype.renderStatus = function () {
    this.status.innerHTML = '';
    var dot = el('span', 'tgv-dot');
    if (this.prefs.autoRefresh) dot.classList.add('tgv-live');
    dot.title = this.prefs.autoRefresh ? 'Watching the project for changes' : 'Auto-refresh is off';
    this.status.appendChild(dot);

    var hiddenCount = this.graph.nodes.length - this.visNodes.length;
    var text = this.visNodes.length.toLocaleString() + ' nodes · ' +
      this.visEdges.length.toLocaleString() + ' links';
    if (hiddenCount > 0) text += ' · ' + hiddenCount.toLocaleString() + ' hidden';
    this.status.appendChild(el('span', null, text));

    if (this.flash) {
      this.status.appendChild(el('span', 'tgv-badge', this.flash.text));
    }

    if (this.sceneProgress) {
      var p = this.sceneProgress;
      this.status.appendChild(el('span', 'tgv-badge',
        'reading scenes ' + p.done + '/' + p.total));
    }

    var problems = this.graph.problems || [];
    if (problems.length) {
      var names = [];
      problems.forEach(function (p) { if (names.indexOf(p.what) === -1) names.push(p.what); });
      var warn = el('span', null, '· could not read: ' + names.slice(0, 3).join(', '));
      warn.title = problems.map(function (p) { return p.what + ': ' + p.message; }).join('\n');
      this.status.appendChild(warn);
    }
    if (this.graph.stats && this.graph.stats.skippedSceneFiles) {
      this.status.appendChild(el('span', null,
        '· scenes read for the first ' + SCENE_FILE_CAP + ' files only'));
    }
  };

  // --- Camera / geometry ---------------------------------------------------

  GraphView.prototype.toWorld = function (sx, sy) {
    return {
      x: (sx - this.width / 2) / this.cam.z + this.cam.x,
      y: (sy - this.height / 2) / this.cam.z + this.cam.y
    };
  };

  GraphView.prototype.fit = function (animate) {
    var nodes = this.visNodes;
    if (!nodes.length) { this.cam.x = 0; this.cam.y = 0; this.cam.z = 1; return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      if (n.x - n.r < minX) minX = n.x - n.r;
      if (n.y - n.r < minY) minY = n.y - n.r;
      if (n.x + n.r > maxX) maxX = n.x + n.r;
      if (n.y + n.r > maxY) maxY = n.y + n.r;
    });
    var f = this.freeRect();
    var pad = 24;
    var w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    var z = Math.min((f.r - f.l - 2 * pad) / w, (f.b - f.t - 2 * pad) / h);
    z = Math.max(0.06, Math.min(2.4, z));
    var target = this.camAt((minX + maxX) / 2, (minY + maxY) / 2, z, f);
    this.invalidate();
    if (animate) this.camTarget = target;
    else { this.cam.x = target.x; this.cam.y = target.y; this.cam.z = target.z; }
  };

  // The camera that puts world point (x, y) at the centre of the free area
  // rather than the centre of the canvas.
  GraphView.prototype.camAt = function (x, y, z, f) {
    f = f || this.freeRect();
    return {
      x: x - ((f.l + f.r) / 2 - this.width / 2) / z,
      y: y - ((f.t + f.b) / 2 - this.height / 2) / z,
      z: z
    };
  };

  // The part of the canvas the floating panels leave uncovered, in canvas
  // pixels. Each visible panel is cut away from whichever side leaves the most
  // room, so the toolbar trims the top, the side panel the left, the details
  // the right, and a bottom sheet the bottom, without knowing which layout is
  // active. A panel that would leave only a sliver is ignored instead.
  GraphView.prototype.freeRect = function () {
    var f = { l: 0, t: 0, r: this.width, b: this.height };
    var origin = this.root.getBoundingClientRect();
    var panes = [this.bar, this.side, this.details, this.status];
    for (var i = 0; i < panes.length; i++) {
      var box = panes[i] && panes[i].getBoundingClientRect();
      if (!box || !box.width || !box.height) continue;    // display: none
      var o = { l: box.left - origin.left, t: box.top - origin.top };
      o.r = o.l + box.width;
      o.b = o.t + box.height;
      if (o.r <= f.l || o.l >= f.r || o.b <= f.t || o.t >= f.b) continue;
      var cuts = [
        { l: o.r, t: f.t, r: f.r, b: f.b },
        { l: f.l, t: f.t, r: o.l, b: f.b },
        { l: f.l, t: o.b, r: f.r, b: f.b },
        { l: f.l, t: f.t, r: f.r, b: o.t }
      ];
      var best = null, bestArea = 0;
      for (var k = 0; k < cuts.length; k++) {
        var cw = cuts[k].r - cuts[k].l, ch = cuts[k].b - cuts[k].t;
        if (cw >= 120 && ch >= 120 && cw * ch > bestArea) { best = cuts[k]; bestArea = cw * ch; }
      }
      if (best) f = best;
    }
    return f;
  };

  GraphView.prototype.isNarrow = function () {
    return this.width <= NARROW_MAX;
  };

  // `slackPx` is how far outside a node's circle still counts as a hit, in
  // screen pixels. A fingertip is far less precise than a mouse pointer.
  GraphView.prototype.nodeAt = function (sx, sy, slackPx) {
    var world = this.toWorld(sx, sy);
    var best = null, bestD = Infinity;
    var slack = (slackPx == null ? 6 : slackPx) / this.cam.z;
    for (var i = this.visNodes.length - 1; i >= 0; i--) {
      var n = this.visNodes[i];
      var dx = n.x - world.x, dy = n.y - world.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= n.r + slack && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  // --- Input ---------------------------------------------------------------

  // Mouse, pen and fingers all arrive as pointer events. One pointer drags a
  // node or pans; two fingers pinch to zoom. The browser's own touch gestures
  // are switched off on the canvas (`touch-action: none` in plugin.css), or it
  // would claim every finger drag as a page scroll and cancel ours.
  GraphView.prototype.bindCanvas = function () {
    var self = this;
    var c = this.canvas;
    var active = new Map();   // pointerId → latest { x, y }, for every pointer down
    // 'idle', 'drag' (a node), 'pan', 'pinch', or 'done': a pinch has ended but
    // a finger is still down. That finger is ignored until it lifts, so taking
    // one finger off does not yank the view with the other.
    var mode = 'idle';
    var downAt = { x: 0, y: 0 };
    var moved = false;
    var pinch = null;
    var lastTap = null;       // the last touch tap, to recognise a double-tap
    var lastTouch = 0;        // when a finger last lifted

    function at(ev) { return { x: ev.offsetX, y: ev.offsetY }; }
    function isTouch(ev) { return ev.pointerType === 'touch'; }

    function startPinch() {
      // A second finger turns whatever the first was doing into a pinch. A node
      // it was dragging goes back to exactly how it was.
      if (self.dragNode) {
        self.dragNode.fixed = self.dragWasPinned;
        self.dragNode = null;
        self.sim.reheat(0.2);
      }
      c.classList.remove('tgv-panning');
      var pts = Array.from(active.values());
      var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      pinch = {
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        z: self.cam.z,
        world: self.toWorld(mid.x, mid.y)   // stays under the fingers throughout
      };
      mode = 'pinch';
      moved = true;
    }

    // Double-click with a mouse, double-tap with a finger: centre on a node, or
    // fit the whole graph when there is no node there.
    function focusAt(x, y, slack) {
      var hit = self.nodeAt(x, y, slack);
      if (hit) self.focusNode(hit.id);
      else self.fit(true);
    }

    c.addEventListener('pointerdown', function (ev) {
      self.closeResults();
      self.camTarget = null;
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      active.set(ev.pointerId, at(ev));
      if (active.size === 2) { startPinch(); return; }
      if (active.size > 2 || mode !== 'idle') return;

      moved = false;
      downAt = at(ev);
      var hit = self.nodeAt(ev.offsetX, ev.offsetY, isTouch(ev) ? 16 : 6);
      if (hit && ev.button === 0) {
        mode = 'drag';
        self.dragNode = hit;
        self.dragWasPinned = !!hit.fixed;
        hit.fixed = true;
        self.sim.reheat(0.32);
      } else {
        mode = 'pan';
        c.classList.add('tgv-panning');
      }
    });

    c.addEventListener('pointermove', function (ev) {
      var prev = active.get(ev.pointerId);
      if (!prev) {
        // Nothing pressed: a mouse or pen hovering over the graph.
        var hit = self.nodeAt(ev.offsetX, ev.offsetY);
        var id = hit ? hit.id : null;
        if (id !== self.hover) {
          self.hover = id;
          c.classList.toggle('tgv-over-node', !!hit);
          c.title = hit ? hit.label : '';
          self.invalidate();
        }
        return;
      }
      var p = at(ev);
      active.set(ev.pointerId, p);

      if (mode === 'pinch') {
        var pts = Array.from(active.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var z = Math.max(0.05, Math.min(8, pinch.z * dist / pinch.dist));
        var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        // Zoom about the fingers, and pan with them as they move together.
        self.cam.z = z;
        self.cam.x = pinch.world.x - (mx - self.width / 2) / z;
        self.cam.y = pinch.world.y - (my - self.height / 2) / z;
        self.invalidate();
        return;
      }
      if (mode !== 'drag' && mode !== 'pan') return;

      var dx = p.x - prev.x, dy = p.y - prev.y;
      // A fingertip wobbles more than a mouse, so a tap tolerates more slop.
      if (Math.abs(p.x - downAt.x) + Math.abs(p.y - downAt.y) > (isTouch(ev) ? 8 : 3)) moved = true;
      if (mode === 'drag') {
        self.dragNode.x += dx / self.cam.z;
        self.dragNode.y += dy / self.cam.z;
        self.dragNode.vx = 0; self.dragNode.vy = 0;
        self.sim.reheat(0.25);
      } else {
        self.cam.x -= dx / self.cam.z;
        self.cam.y -= dy / self.cam.z;
        self.invalidate();
      }
    });

    function endPointer(ev) {
      if (!active.has(ev.pointerId)) return;
      active.delete(ev.pointerId);
      try { c.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (isTouch(ev)) lastTouch = Date.now();

      if (mode === 'pinch' || mode === 'done') {
        mode = active.size ? 'done' : 'idle';
        return;
      }
      if (active.size) return;
      c.classList.remove('tgv-panning');
      // A pointer the browser cancelled or took away is not a tap.
      var tapped = !moved && ev.type === 'pointerup';

      if (self.dragNode) {
        var node = self.dragNode;
        var wasPinned = self.dragWasPinned;
        // Shift toggles a pin; an ordinary drag lets the node go again; a click
        // that never moved leaves the pin exactly as it found it.
        if (ev.shiftKey) node.fixed = !wasPinned;
        else if (moved) node.fixed = false;
        else node.fixed = wasPinned;
        self.dragNode = null;
        self.sim.reheat(0.2);
        if (tapped) {
          self.selected = node.id;
          self.showDetails(self.selected);
        } else if (node.id === self.selected && !!node.fixed !== wasPinned) {
          self.syncPinButton(node);
        }
      } else if (tapped) {
        self.selected = null;
        self.hideDetails();
      }
      mode = 'idle';

      if (tapped && isTouch(ev)) {
        var now = Date.now(), p = at(ev);
        if (lastTap && now - lastTap.t < 320 &&
          Math.abs(p.x - lastTap.x) + Math.abs(p.y - lastTap.y) < 30) {
          lastTap = null;
          focusAt(p.x, p.y, 16);
        } else {
          lastTap = { t: now, x: p.x, y: p.y };
        }
      }
    }
    c.addEventListener('pointerup', endPointer);
    c.addEventListener('pointercancel', endPointer);
    // Capture can be lost without either of the above, and a pointer left in
    // `active` would wedge every gesture after it. After a normal pointerup
    // this finds nothing to do.
    c.addEventListener('lostpointercapture', endPointer);

    c.addEventListener('dblclick', function (ev) {
      // A double-tap has already been handled above. Some browsers follow it
      // with a dblclick of their own, which must not act a second time.
      if (Date.now() - lastTouch < 800) return;
      focusAt(ev.offsetX, ev.offsetY, 6);
    });

    c.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      self.camTarget = null;
      var before = self.toWorld(ev.offsetX, ev.offsetY);
      var factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0016));
      self.cam.z = Math.max(0.05, Math.min(8, self.cam.z * factor));
      var after = self.toWorld(ev.offsetX, ev.offsetY);
      self.cam.x += before.x - after.x;
      self.cam.y += before.y - after.y;
      self.invalidate();
    }, { passive: false });

    this.onKeyDown = function (ev) {
      if (ev.key === 'Escape') {
        if (document.activeElement === self.searchInput) {
          self.searchInput.value = '';
          self.setSearch('');
          self.searchInput.blur();
        } else {
          self.selected = null;
          self.hideDetails();
        }
      } else if (ev.key === 'f' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        self.searchInput.focus();
        self.searchInput.select();
      } else if (ev.key === 'r' && !ev.ctrlKey && !ev.metaKey &&
        document.activeElement !== self.searchInput) {
        self.reload(true);
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  };

  GraphView.prototype.bindResize = function () {
    var self = this;
    var resize = function () {
      var rect = self.root.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      self.width = Math.max(1, Math.round(rect.width));
      self.height = Math.max(1, Math.round(rect.height));
      self.dpr = dpr;
      self.canvas.width = Math.round(self.width * dpr);
      self.canvas.height = Math.round(self.height * dpr);
      self.canvas.style.width = self.width + 'px';
      self.canvas.style.height = self.height + 'px';
      self.invalidate();
      // Crossing the limit, in either direction, forgets any hand-made choice:
      // squeezing the window tidies the panel away, widening it brings it back.
      var compact = self.width <= SIDE_AUTO_MAX;
      if (compact !== self.compact) {
        self.compact = compact;
        self.sideManual = null;
        self.applyPanelState();
      }
      self.layoutChrome();
    };
    resize();
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(resize);
      this.ro.observe(this.root);
      // The toolbar wraps and the status line grows without the root changing
      // size. Watched separately so that does not reallocate the canvas.
      this.chromeRo = new ResizeObserver(function () { self.layoutChrome(); });
      this.chromeRo.observe(this.bar);
      this.chromeRo.observe(this.status);
    }
    window.addEventListener('resize', resize);
    this.onWindowResize = resize;
  };

  // The side panels sit between the toolbar and the status line, and both of
  // those change height: the toolbar wraps on a narrow window, the status line
  // when it has a lot to say. Measure them rather than assume one line each.
  GraphView.prototype.layoutChrome = function () {
    var origin = this.root.getBoundingClientRect();
    var bar = this.bar.getBoundingClientRect();
    var status = this.status.getBoundingClientRect();
    var top = bar.height ? bar.top - origin.top + bar.height + 8 : 62;
    var bottom = status.height ? origin.top + origin.height - status.top + 8 : 12;
    this.root.style.setProperty('--tgv-top', Math.round(top) + 'px');
    this.root.style.setProperty('--tgv-bottom', Math.round(bottom) + 'px');
  };

  // --- Rendering -----------------------------------------------------------

  GraphView.prototype.palette = function () {
    var cs = getComputedStyle(this.root);
    return {
      fg: cs.getPropertyValue('--tgv-fg').trim() || '#e8e2d6',
      dim: cs.getPropertyValue('--tgv-fg-dim').trim() || '#a98e6b',
      accent: cs.getPropertyValue('--tgv-accent').trim() || '#c98a48',
      light: this.root.classList.contains('tgv-light')
    };
  };

  GraphView.prototype.draw = function () {
    var ctx = this.ctx;
    var pal = this.palette();
    var w = this.width, h = this.height, z = this.cam.z;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var nodes = this.visNodes;
    var edges = this.visEdges;
    if (!nodes.length) return;

    var focusId = this.hover || this.selected;
    var near = null;
    if (focusId) {
      near = new Set([focusId]);
      (this.adj.get(focusId) || []).forEach(function (x) { near.add(x.other); });
    }
    var searching = this.matches.size > 0 || (this.search && this.search.length > 0);

    var cx = w / 2, cy = h / 2;
    var camX = this.cam.x, camY = this.cam.y;
    function sx(x) { return (x - camX) * z + cx; }
    function sy(y) { return (y - camY) * z + cy; }

    // Edges — two passes so highlighted links sit on top.
    var margin = 80;
    ctx.lineCap = 'round';

    ctx.globalAlpha = near ? 0.16 : (searching ? 0.16 : 0.34);
    ctx.strokeStyle = pal.light ? '#4a4a4a' : '#cfcfcf';
    ctx.lineWidth = Math.max(0.5, 0.9 * Math.min(1.6, z));
    ctx.beginPath();
    var i, e, a, b, ax, ay, bx, by;
    var index = this.visIndex;
    var highlighted = [];
    for (i = 0; i < edges.length; i++) {
      e = edges[i];
      a = index.get(e.s); b = index.get(e.t);
      if (!a || !b) continue;
      ax = sx(a.x); ay = sy(a.y); bx = sx(b.x); by = sy(b.y);
      if ((ax < -margin && bx < -margin) || (ax > w + margin && bx > w + margin) ||
        (ay < -margin && by < -margin) || (ay > h + margin && by > h + margin)) continue;
      if (near && near.has(e.s) && near.has(e.t)) { highlighted.push([e, a, b]); continue; }
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    if (highlighted.length) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = Math.max(1, 1.5 * Math.min(1.8, z));
      ctx.beginPath();
      for (i = 0; i < highlighted.length; i++) {
        a = highlighted[i][1]; b = highlighted[i][2];
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
      }
      ctx.stroke();
    }

    // Nodes
    var labelThreshold = 0.62 / (this.prefs.labelZoom || 1);
    var showLabels = z > labelThreshold;
    var labels = [];

    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var nx = sx(n.x), ny = sy(n.y);
      var r = Math.max(1.2, n.r * z);
      if (nx < -margin || nx > w + margin || ny < -margin || ny > h + margin) continue;

      var dim = 1;
      if (near && !near.has(n.id)) dim = 0.18;
      if (searching && !this.matches.has(n.id)) dim = Math.min(dim, 0.14);

      ctx.globalAlpha = dim;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();

      if (n.id === this.selected || (searching && this.matches.has(n.id))) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(nx, ny, r + 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (n.fixed) {
        ctx.globalAlpha = Math.max(dim, 0.6);
        ctx.strokeStyle = pal.fg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(nx, ny, r + 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      var important = n.id === focusId || (near && near.has(n.id)) ||
        (searching && this.matches.has(n.id));
      if ((showLabels && (!searching || this.matches.has(n.id)) && (!near || near.has(n.id))) || important) {
        labels.push({ n: n, x: nx, y: ny + r + 10, alpha: important ? 1 : Math.min(1, dim) });
      }
    }

    // Labels last, so they are never covered by a circle.
    if (labels.length) {
      var size = Math.max(9, Math.min(14, 11 * Math.max(0.8, Math.min(1.35, z))));
      ctx.font = '500 ' + size.toFixed(1) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Cap the label count so a huge graph does not crawl.
      if (labels.length > 420) {
        labels.sort(function (p, q) { return (q.n.visDeg || 0) - (p.n.visDeg || 0); });
        labels.length = 420;
      }
      for (i = 0; i < labels.length; i++) {
        var L = labels[i];
        var text = L.n.label.length > 28 ? L.n.label.slice(0, 27) + '…' : L.n.label;
        ctx.globalAlpha = L.alpha * 0.95;
        ctx.lineWidth = 3;
        ctx.strokeStyle = pal.light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.72)';
        ctx.strokeText(text, L.x, L.y);
        ctx.fillStyle = L.n.id === focusId ? pal.accent : pal.fg;
        ctx.fillText(text, L.x, L.y);
      }
    }

    ctx.globalAlpha = 1;
  };

  // Frames are drawn on demand. The loop runs while something is moving (the
  // layout settling, the camera gliding, a fit waiting for the layout) and then
  // stops, so a graph nobody is touching costs no CPU and no battery. Anything
  // that changes the picture calls invalidate() for one more frame, which
  // restarts the loop if it had stopped.
  GraphView.prototype.loop = function () {
    var self = this;
    this.sim.onReheat = function () { self.invalidate(); };
    this.invalidate();
  };

  GraphView.prototype.invalidate = function () {
    if (this.raf || this.destroyed) return;
    var self = this;
    this.raf = requestAnimationFrame(function () {
      self.raf = null;
      self.frame();
    });
  };

  GraphView.prototype.frame = function () {
    if (this.destroyed) return;
    if (this.sim.running()) this.sim.tick();

    if (this.pendingFit != null) {
      this.pendingFit--;
      if (this.pendingFit <= 0) { this.pendingFit = null; this.fit(false); }
    }
    if (this.camTarget) {
      var t = this.camTarget;
      this.cam.x += (t.x - this.cam.x) * 0.16;
      this.cam.y += (t.y - this.cam.y) * 0.16;
      this.cam.z += (t.z - this.cam.z) * 0.16;
      if (Math.abs(t.z - this.cam.z) < 0.002 && Math.abs(t.x - this.cam.x) < 0.5) {
        this.cam.x = t.x; this.cam.y = t.y; this.cam.z = t.z;
        this.camTarget = null;
      }
    }

    this.draw();

    if (this.sim.running() || this.camTarget || this.pendingFit != null) this.invalidate();
  };

  GraphView.prototype.notify = function (message, type) {
    try { tintero.ui.showNotification(message, type || 'info', 5000); } catch (e) { /* ignore */ }
  };

  // --- Live updates --------------------------------------------------------

  var REFRESH_EVENTS = [
    'project.changed', 'project.saved', 'project.loaded',
    'file.saved', 'file.closed',
    'character.added', 'character.updated', 'character.deleted',
    'worldbuilding.added', 'worldbuilding.updated', 'worldbuilding.deleted'
  ];

  GraphView.prototype.watch = function () {
    var self = this;
    this.scheduleRefresh = debounce(function () {
      if (self.prefs.autoRefresh && !self.destroyed) self.reload(false);
    }, 1400);

    this.handlers = REFRESH_EVENTS.map(function (name) {
      var fn = function () { self.scheduleRefresh(); };
      try { tintero.events.on(name, fn); } catch (e) { return null; }
      return { name: name, fn: fn };
    }).filter(Boolean);
  };

  GraphView.prototype.destroy = function () {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    clearTimeout(this.flashTimer);
    if (this.scheduleRefresh) this.scheduleRefresh.cancel();
    if (this.ro) { try { this.ro.disconnect(); } catch (e) { /* ignore */ } }
    if (this.chromeRo) { try { this.chromeRo.disconnect(); } catch (e) { /* ignore */ } }
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    (this.handlers || []).forEach(function (h) {
      try { tintero.events.off(h.name, h.fn); } catch (e) { /* ignore */ }
    });
    this.handlers = [];
  };

  // ── Plugin wiring ────────────────────────────────────────────────────────

  var view = null;

  function mount() {
    var root = document.getElementById('plugin-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'plugin-root';
      document.body.appendChild(root);
    }
    return root;
  }

  var plugin = new TinteroPlugin();

  plugin.onActivate = async function () {
    if (view) return;                       // never subscribe twice
    var root = mount();
    view = new GraphView(root);

    await view.loadPrefs();
    view.loop();
    view.watch();
    await view.reload(false);
  };

  // Route this through the same debounced path as the event subscriptions.
  // Calling reload() directly ignored the Live toggle entirely — switching it
  // off stopped the events but not this hook — and skipped the debounce, so a
  // burst of project changes meant a burst of full re-reads.
  plugin.onProjectChange = function () {
    if (view && view.scheduleRefresh) view.scheduleRefresh();
  };

  plugin.onDeactivate = async function () {
    if (!view) return;
    try {
      await tintero.storage.set(PREFS_KEY, view.prefSnapshot());
    } catch (e) { /* nothing worth failing over */ }
    view.destroy();
    view = null;
  };

  registerPlugin(plugin);
})();
