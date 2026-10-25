// CI sanity check: does Pele's render() work in plain Node with no DOM?
import { render } from 'pele';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('../node_modules/pele/package.json', import.meta.url))).version;
console.log(`pele ${version} on node ${process.version}`);
console.log(`DOM present: document=${typeof document} window=${typeof window} OffscreenCanvas=${typeof OffscreenCanvas}`);

const flow = 'flowchart LR\n  A[Draft in Obsidian] --> B[Copy into Jekyll] --> C{Mermaid block?} -->|yes| D[Inline SVG]\n  C -->|no| E[Plain HTML]';
const base = { fontFamily: "'EB Garamond', Georgia, serif", maxWidth: 592 };

const r = render(flow, { ...base, idPrefix: 'verify' });
console.log(`type=${r.type} mermaidType=${r.mermaidType} natural size=${r.width}x${r.height} svg length=${r.svg.length}`);
console.log(`root tag: ${r.svg.match(/<svg[^>]*>/)?.[0]}`);
console.log(`contains <script: ${/<script/i.test(r.svg)}  contains <style: ${/<style/i.test(r.svg)}  ids prefixed: ${/id="verify/.test(r.svg)}`);
console.log(`--pele-* vars referenced: ${[...new Set(r.svg.match(/--pele-[a-z0-9-]+/g) || [])].join(' ')}`);

// Text measurement: if width changes with the font family, Pele measures per
// font; if not, it's using its built-in width table regardless of font.
const label = 'flowchart LR\n  A[The quick brown fox jumps over the lazy dog]';
const serif = render(label, { fontFamily: 'Georgia, serif' }).width;
const mono = render(label, { fontFamily: 'monospace' }).width;
console.log(`text measurement: same label is ${serif}px wide in serif vs ${mono}px in monospace -> ${serif === mono ? 'fixed width table (font-agnostic)' : 'font-aware width table'}`);

// autoDirection in a 592px column: does an LR chart get flipped vertical?
const on = render(flow, { ...base, autoDirection: true });
const off = render(flow, { ...base, autoDirection: false });
console.log(`autoDirection true: ${on.width}x${on.height}  false: ${off.width}x${off.height}`);
