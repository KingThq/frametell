// The read, write and edit tools run in this process, not in the shell's sandbox; the shell can plant links in the
// project. Every planted link and hard link is refused, and what it points at is left as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileTools } from './tools/files.js';
import { Project } from './project.js';
import { imagesIn, readIn } from './projectfs.js';

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-files-')));
  const root = path.join(base, 'users', 'me', 'projects', 'film');
  const other = path.join(base, 'users', 'other', 'projects', 'x');
  const api = path.join(base, 'api');
  for (const d of [root, other, api, path.join(root, 'pages'), path.join(root, '.studio')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(other, 'script.js'), 'their script');
  fs.writeFileSync(path.join(api, 'server.js'), 'api code');
  fs.writeFileSync(path.join(root, 'pages', 'p01.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, '.studio', 'state.json'), '{"stage":"pages"}');
  const tools = Object.fromEntries(fileTools(root).map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown>) => {
    try { const r: any = await tools[name].execute('id', args as never, undefined as never, undefined as never); return { ok: true, text: r.content.map((c: any) => c.text ?? c.data).join('') }; }
    catch (e) { return { ok: false, text: (e as Error).message }; }
  };
  return { base, root, other, api, call, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('read through a planted link (a folder of another account, a file) is refused', async () => {
  const s = setup();
  try {
    fs.symlinkSync(s.other, path.join(s.root, 'y'));
    fs.symlinkSync(path.join(s.other, 'script.js'), path.join(s.root, 'z.js'));
    for (const p of ['y/script.js', 'z.js']) {
      const r = await s.call('read', { path: p });
      assert.equal(r.ok, false, p);
      assert.doesNotMatch(r.text, /their script/);
      assert.match(r.text, /outside the project directory/);
    }
    // a picture through a link: not read either
    fs.writeFileSync(path.join(s.other, 'f.png'), 'their picture');
    fs.symlinkSync(path.join(s.other, 'f.png'), path.join(s.root, 'f.png'));
    assert.equal((await s.call('read', { path: 'f.png' })).ok, false);
    // a link to the studio's record
    fs.symlinkSync('.studio', path.join(s.root, 's'));
    const r = await s.call('read', { path: 's/state.json' });
    assert.equal(r.ok, false);
    assert.match(r.text, /studio's record/);
  } finally { s.done(); }
});

test('write and edit through a link into .studio, or to a file outside, are refused and change nothing', async () => {
  const s = setup();
  try {
    fs.symlinkSync('.studio', path.join(s.root, 's'));
    fs.symlinkSync(path.join(s.api, 'server.js'), path.join(s.root, 'z.js'));
    fs.symlinkSync(s.api, path.join(s.root, 'apidir'));
    const tries: [string, Record<string, unknown>][] = [
      ['write', { path: 's/state.json', content: 'x' }],
      ['write', { path: 's/new.json', content: 'x' }],
      ['edit', { path: 's/state.json', old_string: 'pages', new_string: 'done' }],
      ['write', { path: 'z.js', content: 'pwned' }],
      ['edit', { path: 'z.js', old_string: 'api', new_string: 'pwned' }],
      ['write', { path: 'apidir/server.js', content: 'pwned' }],
      ['write', { path: 'apidir/new.js', content: 'pwned' }],
      ['write', { path: 'apidir/deep/new.js', content: 'pwned' }],
      ['edit', { path: 'apidir/server.js', old_string: 'api', new_string: 'pwned' }],
    ];
    for (const [name, args] of tries) assert.equal((await s.call(name, args)).ok, false, `${name} ${args.path}`);
    assert.equal(fs.readFileSync(path.join(s.root, '.studio', 'state.json'), 'utf8'), '{"stage":"pages"}');
    assert.deepEqual(fs.readdirSync(path.join(s.root, '.studio')), ['state.json']);
    assert.equal(fs.readFileSync(path.join(s.api, 'server.js'), 'utf8'), 'api code');
    assert.deepEqual(fs.readdirSync(s.api), ['server.js']);
    assert.ok(fs.lstatSync(path.join(s.root, 'z.js')).isSymbolicLink());   // the link is left as a link, nothing written through it
  } finally { s.done(); }
});

test('a hard-linked file is neither read nor edited nor replaced', async () => {
  const s = setup();
  try {
    // the sandbox would deny this link (no path to the API's files); made here to test the last line of defence
    fs.linkSync(path.join(s.api, 'server.js'), path.join(s.root, 'h.js'));
    assert.match((await s.call('read', { path: 'h.js' })).text, /hard link/);
    assert.equal((await s.call('edit', { path: 'h.js', old_string: 'api', new_string: 'pwned' })).ok, false);
    assert.equal((await s.call('write', { path: 'h.js', content: 'pwned' })).ok, false);
    assert.equal(fs.readFileSync(path.join(s.api, 'server.js'), 'utf8'), 'api code');
  } finally { s.done(); }
});

test('a new file under a linked folder is refused; a folder made on the way is a real one of the project', async () => {
  const s = setup();
  try {
    fs.symlinkSync(path.join(s.other), path.join(s.root, 'out'));
    assert.equal((await s.call('write', { path: 'out/frames/a.txt', content: 'x' })).ok, false);
    assert.ok(!fs.existsSync(path.join(s.other, 'frames')));
    assert.deepEqual(fs.readdirSync(s.other), ['script.js']);
    // a lexical escape and the engine stay refused with their old messages
    assert.match((await s.call('write', { path: '../x.txt', content: 'x' })).text, /outside the project directory/);
    assert.match((await s.call('write', { path: '.studio/state.json', content: 'x' })).text, /studio's record/);
  } finally { s.done(); }
});

test('normal reads, writes, edits and new nested files work; .studio/revision.json is writable', async () => {
  const s = setup();
  try {
    const r = await s.call('read', { path: 'pages/p01.js' });
    assert.ok(r.ok); assert.match(r.text, /const a = 1;/);
    assert.match((await s.call('write', { path: 'notes/deep/n.md', content: 'hello\nworld' })).text, /wrote notes\/deep\/n\.md \(2 lines\)/);
    assert.equal(fs.readFileSync(path.join(s.root, 'notes/deep/n.md'), 'utf8'), 'hello\nworld');
    assert.ok((await s.call('write', { path: 'notes/deep/n.md', content: 'replaced' })).ok);
    assert.equal(fs.readFileSync(path.join(s.root, 'notes/deep/n.md'), 'utf8'), 'replaced');
    assert.match((await s.call('edit', { path: 'pages/p01.js', old_string: 'a = 1', new_string: 'a = 2' })).text, /edited pages\/p01\.js \(1 replacement\)/);
    assert.equal(fs.readFileSync(path.join(s.root, 'pages/p01.js'), 'utf8'), 'const a = 2;\n');
    assert.equal((await s.call('edit', { path: 'pages/p01.js', old_string: 'nope', new_string: 'x' })).text, 'old_string not found');
    assert.ok((await s.call('write', { path: '.studio/revision.json', content: '{"pages":[]}' })).ok);
    assert.equal(fs.readFileSync(path.join(s.root, '.studio/revision.json'), 'utf8'), '{"pages":[]}');
    assert.ok((await s.call('read', { path: '.studio/revision.json' })).ok);
    // a link inside the project to a file of the project is fine to read
    fs.symlinkSync('pages/p01.js', path.join(s.root, 'alias.js'));
    assert.ok((await s.call('read', { path: 'alias.js' })).ok);
    // a long page is still not rewritten whole
    fs.writeFileSync(path.join(s.root, 'pages/p02.js'), 'x\n'.repeat(50));
    assert.match((await s.call('write', { path: 'pages/p02.js', content: 'y' })).text, /use edit/);
    assert.equal(fs.readFileSync(path.join(s.root, 'pages/p02.js'), 'utf8'), 'x\n'.repeat(50));
  } finally { s.done(); }
});

test('the orchestrator\'s own reads and pictures go through the same check', () => {
  const s = setup();
  try {
    fs.symlinkSync(path.join(s.other, 'script.js'), path.join(s.root, 'script.js'));
    const project = new Project(s.root);
    assert.throws(() => project.read('script.js'), /outside the project directory/);
    assert.throws(() => project.write('script.js', 'pwned'), /link/);
    assert.equal(fs.readFileSync(path.join(s.other, 'script.js'), 'utf8'), 'their script');
    fs.writeFileSync(path.join(s.other, 'sheet.jpg'), 'their picture');
    fs.mkdirSync(path.join(s.root, 'out', 'snap'), { recursive: true });
    fs.symlinkSync(path.join(s.other, 'sheet.jpg'), path.join(s.root, 'out', 'snap', 'sheet.jpg'));
    fs.writeFileSync(path.join(s.root, 'out', 'snap', 'ok.jpg'), 'mine');
    const pics = imagesIn(s.root, [path.join(s.root, 'out/snap/sheet.jpg'), path.join(s.root, 'out/snap/ok.jpg')]);
    assert.deepEqual(pics.map((p) => p.data.toString()), ['mine']);
    assert.equal(readIn(s.root, 'pages/p01.js').toString(), 'const a = 1;\n');
  } finally { s.done(); }
});

const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('posters and stills are cut only from a film of the project\'s own, through the opened file', { skip: !ffmpeg && 'no ffmpeg' }, async () => {
  const s = setup();
  try {
    const film = path.join(s.other, 'film.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', film]);
    fs.mkdirSync(path.join(s.root, 'out'));
    fs.symlinkSync(film, path.join(s.root, 'out', 'linked.mp4'));
    const project = new Project(s.root);
    const pages = [{ id: 'p01', start: 0, end: 1.5, speechEnd: 1, cues: [] }];
    assert.deepEqual(await project.posters(path.join(s.root, 'out', 'linked.mp4'), pages), {});
    assert.deepEqual(await project.posters(film, pages), {});   // a path elsewhere
    assert.ok(!fs.existsSync(path.join(s.root, 'out', 'thumbs')));
    // the same film as a file of the project
    fs.copyFileSync(film, path.join(s.root, 'out', 'own.mp4'));
    assert.deepEqual(await project.posters(path.join(s.root, 'out', 'own.mp4'), pages), { p01: 'out/thumbs/p01.jpg' });
    assert.ok(fs.statSync(path.join(s.root, 'out/thumbs/p01.jpg')).size > 0);
    assert.deepEqual(await project.stills([0.5, 1], path.join(s.root, 'out', 'own.mp4')), ['out/frames/5.jpg', 'out/frames/10.jpg']);
    assert.ok(fs.statSync(path.join(s.root, 'out/frames/10.jpg')).size > 0);
    // a link planted where a frame goes is not written through
    fs.symlinkSync(path.join(s.api, 'server.js'), path.join(s.root, 'out/frames/20.jpg'));
    await assert.rejects(project.stills([2], path.join(s.root, 'out', 'own.mp4')));
    assert.equal(fs.readFileSync(path.join(s.api, 'server.js'), 'utf8'), 'api code');
  } finally { s.done(); }
});
