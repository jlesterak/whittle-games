// Beadloom track junctions: where a feeder band leaves the ring band the walls used to meet in a sharp V (a
// "notch"). The fillet that rounds each V off is filled as X -> A0 -> A -> arc -> B -> B0 -> X (render.js). It must
// touch both band edges, sit in its own V, be drawn the short way round, and paint nothing outside the bands except
// the notch it fills (past bug: on big wide rings one centre landed 186 px down the gap beside the left feeder
// and painted a wall-coloured wedge there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, junctionCorners, filletShape, CHANNEL, WALL } from '../games/beadloom/track.js';

const OUTER = (CHANNEL + 2 * WALL + 10) / 2; // render.js: the shadow, the widest layer
const LAYERS = [OUTER, (CHANNEL + 2 * WALL + 4) / 2, (CHANNEL + 2 * WALL - 2) / 2];
const R0 = 30; // render.js FILLET

const distTo = (path, [x, y]) => {
  let m = Infinity;
  for (let i = 0; i < path.count; i++) m = Math.min(m, Math.hypot(path.xs[i] - x, path.ys[i] - y));
  return m;
};
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// Points along the arc exactly as canvas arc(cx, cy, r, a0, a1, anticlockwise) draws it.
function arcPoints(f, n = 12) {
  const tau = 2 * Math.PI;
  const sweep = f.ccw ? -(((f.a0 - f.a1) % tau) + tau) % tau : (((f.a1 - f.a0) % tau) + tau) % tau;
  const pts = [];
  for (let k = 1; k < n; k++) {
    const a = f.a0 + (sweep * k) / n;
    pts.push([f.C[0] + f.r * Math.cos(a), f.C[1] + f.r * Math.sin(a)]);
  }
  return { sweep, pts };
}

test('every junction fillet touches both edges, sits in its V and paints only the notch', () => {
  for (const shape of ['O', 'wide', 'squareO']) {
    for (const n of [80, 90, 100, 110, 120, 130]) {
      const t = buildTrack(shape, n);
      const ring = t.ring;
      const rounded = [0, 1, 2, 3].filter((i) => filletShape(t, i, OUTER, OUTER, R0));
      assert.ok(rounded.length >= 3, `${shape} ${n}: only corners ${rounded} rounded`);
      for (const i of rounded) {
        const feeder = t.feeders[i >> 1];
        let centre = null;
        for (const d of LAYERS) {
          const f = filletShape(t, i, d, OUTER, R0);
          const v = junctionCorners(t, d)[i];
          const where = `${shape} ${n} corner ${i} layer ${d}`;
          assert.ok(f && v, `${where}: a fillet on every wall layer`);
          if (centre) assert.ok(Math.hypot(f.C[0] - centre[0], f.C[1] - centre[1]) < 1e-6, `${where}: concentric`);
          centre = f.C;
          // in its own V: about r / sin(theta / 2) from the corner
          const reach = f.r / Math.sin(v.theta / 2);
          const away = Math.hypot(f.C[0] - v.P[0], f.C[1] - v.P[1]);
          assert.ok(away < reach * 1.5 + 4, `${where}: centre ${away.toFixed(0)} px from the corner (ideal ${reach.toFixed(0)})`);
          // touching both edges
          assert.ok(Math.abs(distTo(feeder, f.A) - d) < 1.5, `${where}: A off the feeder edge`);
          assert.ok(Math.abs(distTo(ring, f.B) - d) < 1.5, `${where}: B off the ring edge`);
          // drawn the short way, outside both bands
          const { sweep, pts } = arcPoints(f);
          assert.ok(Math.abs(sweep) < Math.PI, `${where}: the arc goes the long way round`);
          for (const q of pts) assert.ok(distTo(feeder, q) > d - 1.5 && distTo(ring, q) > d - 1.5, `${where}: the arc cuts into a band`);
          // the straight sides stay inside the bands: X in both, X -> A0 in the feeder's, B0 -> X in the ring's
          assert.ok(distTo(feeder, f.X) < d && distTo(ring, f.X) < d, `${where}: X outside the bands`);
          for (let k = 0; k <= 10; k++) {
            assert.ok(distTo(feeder, lerp(f.X, f.A0, k / 10)) < d + 0.5, `${where}: X -> A0 leaves the feeder band`);
            assert.ok(distTo(ring, lerp(f.B0, f.X, k / 10)) < d + 0.5, `${where}: B0 -> X leaves the ring band`);
          }
        }
      }
    }
  }
});
