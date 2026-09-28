#!/usr/bin/env node
/*
 * Pre-package checks for the Graph View plugin for Tintero.
 *
 * Catches the mistakes that produce a plugin which installs and then quietly
 * does not work: a bad manifest, an entry point that is not .js (so plugin.css
 * is never loaded), a non-SVG icon, a scope that is declared but never used —
 * and, for this plugin specifically, any scope that could write to a project.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ── The scope vocabulary the installer accepts ───────────────────────────────
const SCOPES = {
  low: ['app.settings.read', 'convert.format', 'debug.console', 'editor.read', 'fs.platform',
    'project.read', 'project.read.analytics', 'project.read.cardboards', 'project.read.characters',
    'project.read.collections', 'project.read.docContent', 'project.read.docs',
    'project.read.fileContent', 'project.read.files', 'project.read.flowmaps',
    'project.read.images', 'project.read.notes', 'project.read.plotgrid', 'project.read.scenes',
    'project.read.snapshots', 'project.read.tags', 'project.read.templates',
    'project.read.timelines', 'project.read.worldbuilding', 'settings', 'storage',
    'ui.notification'],
  medium: ['backup.create', 'backup.list', 'export.file', 'fs.read', 'import.file',
    'media.control', 'ui.contextMenu', 'ui.dialog', 'ui.sidebar', 'ui.window'],
  high: ['app.settings.write', 'backup.restore', 'editor.write', 'export.book', 'export.project',
    'fs.write', 'import.project', 'net.fetch', 'project.write.cardboards',
    'project.write.characters', 'project.write.docs', 'project.write.fileContent',
    'project.write.files', 'project.write.images', 'project.write.notes',
    'project.write.plotgrid', 'project.write.tags', 'project.write.worldbuilding']
};
const ALL_SCOPES = [].concat(SCOPES.low, SCOPES.medium, SCOPES.high);

// Which call proves a scope is actually in use.
const SCOPE_USES = {
  'project.read': ['getMetadata'],
  'project.read.files': ['getFiles', 'getFolders'],
  'project.read.docs': ['getDocs'],
  'project.read.characters': ['getCharacters', 'getCharacterById'],
  'project.read.worldbuilding': ['getWorldbuilding', 'getWorldbuildingByType'],
  'project.read.templates': ['getCustomWorldbuildingTemplates'],
  'project.read.notes': ['getNotes'],
  'project.read.collections': ['getCollections'],
  'project.read.tags': ['getTags'],
  'project.read.timelines': ['getTimelines'],
  'project.read.flowmaps': ['getFlowMaps'],
  'project.read.plotgrid': ['getPlotGrids'],
  'project.read.cardboards': ['getCardboards'],
  'project.read.scenes': ['getScenes'],
  'project.read.images': ['getImages', 'getImageData'],
  'project.read.fileContent': ['getFileContent'],
  'project.read.docContent': ['getDocContent'],
  'project.read.snapshots': ['getFileSnapshots'],
  'project.read.analytics': ['getWordCountLog', 'getWritingGoals', 'getWritingMinutesLog'],
  'editor.read': ['getActiveDocument', 'getOpenDocuments', 'getSelection', 'getWordCount'],
  'convert.format': ['toMarkdown', 'toText', 'toHtml', 'fromMarkdown', 'fromText', 'fromHtml'],
  'storage': ['storage.get', 'storage.set', 'storage.getAll', 'storage.remove'],
  'settings': ['settings.get', 'settings.getField'],
  'app.settings.read': ['app.getSettings', 'app.getSettingsField'],
  'ui.notification': ['showNotification'],
  'ui.dialog': ['openDialog', 'closeDialog'],
  'ui.sidebar': ['ui.render'],
  'ui.window': ['showSidebar', 'hideSidebar', 'toggleSidebar', 'toggleFullscreen', 'isFullscreen'],
  'fs.platform': ['getPlatform'],
  'fs.read': ['readProjectFile'],
  'debug.console': ['debug.getLogs', 'debug.clear'],
  'media.control': ['getNowPlaying', 'media.play'],
  'net.fetch': ['net.fetch'],
  'backup.list': ['backup.list', 'backup.getById'],
  'backup.create': ['backup.create']
};

// This plugin promises to read and never write. Anything here would break that.
const MUTATING = /^(.*\.write.*|editor\.write|fs\.write|import\..*|export\..*|backup\.(create|restore)|net\.fetch|media\.control)$/;

const ALLOWED_EXT = new Set(['.js', '.html', '.json', '.css', '.svg']);
const TYPES = ['sidebar-panel', 'app', 'file-importer', 'file-exporter', 'project-importer',
  'project-exporter', 'book-exporter', 'tool'];
const SURFACES = ['sidebar', 'app', 'background', 'dialog'];

// ── Manifest ─────────────────────────────────────────────────────────────────
const manifestPath = path.join(SRC, 'plugin.json');
let m = null;
try {
  m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error('plugin.json could not be parsed: ' + e.message);
  process.exit(1);
}

for (const field of ['id', 'name', 'version', 'description', 'type', 'main']) {
  if (typeof m[field] !== 'string' || !m[field]) fail(`Missing or invalid "${field}"`);
}
if (!m.author || typeof m.author.name !== 'string' || !m.author.name) {
  fail('Missing or invalid "author" (requires at least "name")');
}
if (!Array.isArray(m.scopes) || !m.scopes.length) fail('Missing or invalid "scopes" array');

if (m.id && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(m.id)) {
  fail('"id" must contain only lowercase letters, numbers, dots and hyphens, and start and end with a letter or number');
}
if (m.type && TYPES.indexOf(m.type) === -1) fail(`Invalid "type": "${m.type}"`);
if (m.surfaces) {
  if (!Array.isArray(m.surfaces)) fail('"surfaces" must be an array');
  else m.surfaces.filter(s => SURFACES.indexOf(s) === -1)
    .forEach(s => fail(`Invalid surface: "${s}"`));
}
if (m.main && !/\.js$/.test(m.main)) {
  fail(`"main" must end in .js or plugin.css is never loaded (got "${m.main}")`);
}
if (m.icon && !/\.svg$/.test(m.icon)) {
  fail(`"icon" must be an .svg — other formats are dropped at install (got "${m.icon}")`);
}
if (!m.license) warn('No license specified; the installer shows a warning');
if (!m.icon) warn('No icon specified; the default icon will be used');

const declared = Array.isArray(m.scopes) ? m.scopes : [];
declared.filter(s => ALL_SCOPES.indexOf(s) === -1).forEach(s => fail(`Invalid scope: "${s}"`));
if (m.surfaces && m.surfaces.indexOf('sidebar') !== -1 && declared.indexOf('ui.sidebar') === -1) {
  fail('Plugins with a "sidebar" surface must include the "ui.sidebar" scope');
}
if (declared.indexOf('net.fetch') !== -1 && !(m.network && Array.isArray(m.network.domains) && m.network.domains.length)) {
  fail('"net.fetch" requires network.domains to list concrete hosts');
}
new Set(declared.filter((s, i) => declared.indexOf(s) !== i))
  .forEach(s => warn(`Scope "${s}" is declared twice`));

// The read-only promise.
declared.filter(s => MUTATING.test(s)).forEach(s => {
  fail(`Scope "${s}" can change the project or reach outside it — this plugin is read-only`);
});

// ── Source files ─────────────────────────────────────────────────────────────
const files = fs.readdirSync(SRC);
files.filter(f => !ALLOWED_EXT.has(path.extname(f).toLowerCase())).forEach(f => {
  fail(`src/${f} will be dropped at install: only ${[...ALLOWED_EXT].join(', ')} survive`);
});

const mainPath = path.join(SRC, m.main || '');
if (!fs.existsSync(mainPath)) fail(`"main" points at ${m.main}, which does not exist in src/`);
if (m.icon && !fs.existsSync(path.join(SRC, m.icon))) fail(`"icon" points at ${m.icon}, which does not exist in src/`);
if (!fs.existsSync(path.join(SRC, 'plugin.css'))) warn('No plugin.css alongside plugin.js');

let code = '';
if (fs.existsSync(mainPath)) {
  code = fs.readFileSync(mainPath, 'utf8');

  const registrations = (code.match(/\bregisterPlugin\s*\(/g) || []).length;
  if (registrations === 0) fail('registerPlugin() is never called');
  else if (registrations > 1) fail(`registerPlugin() is called ${registrations} times; it must be called exactly once`);

  // Declared but never used.
  declared.forEach(scope => {
    const uses = SCOPE_USES[scope];
    if (!uses) { warn(`No usage rule for scope "${scope}"; cannot check whether it is used`); return; }
    const used = uses.some(u => code.indexOf(u.indexOf('.') === -1 ? u + '(' : u) !== -1);
    if (!used) fail(`Scope "${scope}" is declared but no matching call appears in ${m.main}`);
  });

  // Used but never declared.
  Object.keys(SCOPE_USES).forEach(scope => {
    if (declared.indexOf(scope) !== -1) return;
    const hit = SCOPE_USES[scope].find(u => code.indexOf(u.indexOf('.') === -1 ? u + '(' : u) !== -1);
    if (hit) fail(`${m.main} calls ${hit} but "${scope}" is not declared in scopes`);
  });

  // Paths must stay inside the plugin folder.
  if (/['"][a-zA-Z]:[\\/]/.test(code) || /['"]\.\.[\\/]/.test(code)) {
    warn('Source contains what looks like an absolute or parent path; those are rejected at install');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
warnings.forEach(w => console.log('  warning  ' + w));
errors.forEach(e => console.log('  ERROR    ' + e));

if (errors.length) {
  console.log(`\n${errors.length} error(s). Not packaging.`);
  process.exit(1);
}
console.log(`ok  ${m.id} v${m.version} — ${declared.length} scopes, all read-only, ` +
  `${files.length} files` + (warnings.length ? `, ${warnings.length} warning(s)` : ''));
