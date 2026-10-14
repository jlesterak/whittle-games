// Beadloom track junctions: where a feeder band leaves the ring band the walls used to meet in a sharp V
// (a "notch"). The fillets that round it off must touch both band edges and keep the arc outside both bands,
// with the stacked wall layers sharing one centre so the rims stay parallel (games/beadloom/track.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, junctionCorners, filletShape, CHANNEL, WALL } from '../games/beadloom/track.js';

const OUTER = (CHANNEL + 2 * WALL + 10) / 2; // render.js: the shadow, the widest layer
const LAYERS = [OUTER, (CHANNEL + 2 * WALL + 4) / 2, (CHANNEL + 2 * WALL - 2) / 2];
const R0 = 30;

const distTo = (path, [x, y]) => {
  let m = Infinity;
  for (let i = 0; i < path.count; i++) m = Math.min(m, Math.hypot(path.xs[i] - x, path.ys[i] - y));
  return m;
};

test('every feeder junction gets a fillet that touches both edges and stays outside both bands', () => {
  for (const shape of ['O', 'wide', 'squareO']) {
    for (const n of [80, 100, 130]) {
      const t = buildTrack(shape, n);
      const base = junctionCorners(t, OUTER);
      assert.equal(base.filter(Boolean).length, 4, `${shape} ${n}: a corner on each side of each feeder`);
      const rounded = [0, 1, 2, 3].filter((i) => filletShape(t, i, OUTER, OUTER, R0));
      assert.ok(rounded.length >= 3, `${shape} ${n}: only ${rounded.length} corners rounded`);
      base.forEach((b, i) => {
        const feeder = t.feeders[i >> 1];
        let centre = null;
        for (const d of LAYERS) {
          const f = filletShape(t, i, d, OUTER, R0);
          if (!f) continue; // a corner too tight to round keeps its V
          const where = `${shape} ${n} corner ${i} layer ${d}`;
          assert.ok(f.r >= OUTER - d + R0 * 0.45 - 1e-9, `${where}: radius ${f.r}`);
          if (centre) assert.ok(Math.hypot(f.C[0] - centre[0], f.C[1] - centre[1]) < 1e-6, `${where}: concentric`);
          centre = f.C;
          assert.ok(Math.abs(distTo(feeder, f.A) - d) < 1.5, `${where}: A on the feeder edge (${distTo(feeder, f.A)})`);
          assert.ok(Math.abs(distTo(t.ring, f.B) - d) < 1.5, `${where}: B on the ring edge (${distTo(t.ring, f.B)})`);
          let sweep = f.a1 - f.a0;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          while (sweep <= -Math.PI) sweep += 2 * Math.PI;
          for (let k = 1; k < 10; k++) {
            const a = f.a0 + (sweep * k) / 10;
            const q = [f.C[0] + f.r * Math.cos(a), f.C[1] + f.r * Math.sin(a)];
            assert.ok(distTo(feeder, q) > d - 1.5 && distTo(t.ring, q) > d - 1.5, `${where}: the arc cuts into a band`);
          }
        }
      });
    }
  }
});
