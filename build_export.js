const fs = require('fs');
const path = require('path');

const root = '.';

const ignoreDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'target', '.claude', 'src-tauri/target']);
const ignoreFiles = new Set(['package-lock.json', 'yarn.lock', '.db', '.db-shm', '.db-wal']);

function shouldIgnore(filePath) {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    if (ignoreDirs.has(part)) return true;
  }
  const base = path.basename(filePath);
  for (const ign of ignoreFiles) {
    if (base === ign || base.endsWith(ign)) return true;
  }
  return false;
}

function collectFiles(dir, files=[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldIgnore(full)) continue;
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else {
      files.push(full);
    }
  }
  files.sort();
  return files;
}

function buildTree(dir, prefix='') {
  let out = '';
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name));
  const filtered = entries.filter(e => !shouldIgnore(path.join(dir, e.name)));
  filtered.forEach((entry, i) => {
    const isLast = i === filtered.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    if (entry.isDirectory()) {
      out += prefix + connector + entry.name + '/\n';
      out += buildTree(path.join(dir, entry.name), prefix + (isLast ? '    ' : '│   '));
    } else {
      out += prefix + connector + entry.name + '\n';
    }
  });
  return out;
}

const files = collectFiles(root);
const tree = buildTree(root);

const explanation = `Vynlore Audio is a Windows-only, lossless-first local music player built as a Tauri v2 desktop app. Frontend: React + TypeScript + Vite. Backend: Rust. Audio: FLAC playback via cpal + symphonia, targeting WASAPI exclusive mode for bit-perfect output. It scans folders for FLAC files, stores metadata in SQLite, and plays them back with minimal resampling.`;

let output = explanation + '\n\n';
output += 'DIRECTORY TREE\n';
output += '============================================================\n';
output += tree + '\n';

for (const file of files) {
  let rel = path.relative(root, file);
  rel = rel.split(path.sep).join('/');
  output += '=========================================\n';
  output += 'FILE: ' + rel + '\n';
  output += '=========================================\n';
  try {
    output += fs.readFileSync(file, 'utf8');
  } catch (e) {
    output += '[BINARY FILE - skipped content]\n';
  }
  output += '\n\n';
}

fs.writeFileSync('project_export.txt', output, 'utf8');
console.log('project_export.txt created successfully.');
