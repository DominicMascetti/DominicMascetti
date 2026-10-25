// Renders Mermaid sources to SVG for _plugins/pele_diagrams.rb.
//
// argv[2]: JSON object of Pele render options shared by every diagram.
// stdin:   JSON array of { source, idPrefix }.
// stdout:  JSON array, same order, of { svg } or { error }.
import { render } from 'pele';

const options = JSON.parse(process.argv[2] || '{}');

let input = '';
for await (const chunk of process.stdin) input += chunk;

const results = JSON.parse(input).map(({ source, idPrefix }) => {
  try {
    return { svg: render(source, { ...options, idPrefix }).svg };
  } catch (e) {
    return { error: e.code ? `${e.code}: ${e.message}` : String(e.message || e) };
  }
});

process.stdout.write(JSON.stringify(results));
