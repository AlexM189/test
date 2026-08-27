/* Render the report body with the JS renderer and print it, so the Python side can
   diff every number against its own output. Catches formatting divergence (rounding
   mode, decimal places) that a metric-level comparison cannot see. */
import { readFileSync } from 'fs';
import { readDelimited } from '../web/parse.js';
import { makeEngine } from '../web/analyze.js';
import { makeRenderer } from '../web/render.js';
const RULES = JSON.parse(readFileSync(new URL('../rules.json', import.meta.url), 'utf8'));
const eng = makeEngine(RULES), ren = makeRenderer(RULES, '', '');
const rows = readDelimited(readFileSync(process.argv[2], 'utf8'));
const { recs, prov, stats } = eng.buildRecords([{ file: 'x', sheet: '', rows }]);
const res = eng.run(recs);
process.stdout.write(ren.buildBody(res, { prov, stats, file_count: 1 }));
