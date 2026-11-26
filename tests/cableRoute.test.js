// Tracé et couleur des câbles (src/render/cableRoute.js) : sans navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cableRoute, cableColor, fallbackEnd, trayRoute, trayLines, smoothRoute, cableTagLines, CABLE_COLORS, CABLE_RADIUS, FLOOR_Y } from '../src/render/cableRoute.js';
import { CABLES, DEFAULT_CABLE } from '../src/sim/catalog.js';

const near = (p, q, eps = 1e-9) => p.every((v, i) => Math.abs(v - q[i]) < eps);

test('câbles : une couleur de gaine par type du catalogue, sans les couleurs de charge', () => {
  for (const id of Object.keys(CABLES)) assert.match(cableColor(id), /^#[0-9a-f]{6}$/, id);
  assert.equal(new Set(Object.values(CABLE_COLORS)).size, Object.keys(CABLE_COLORS).length, 'couleurs distinctes');
  assert.equal(cableColor('inconnu'), CABLE_COLORS[DEFAULT_CABLE]);
  // Vert, orange et rouge sont réservés à la charge du lien (linkLoad.js).
  for (const hex of Object.values(CABLE_COLORS)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const reddish = r > 180 && g < 140 && b < 120;
    const greenish = g > 180 && r < 120 && b < 120;
    assert.ok(!reddish && !greenish, `${hex} ressemble à une couleur de charge`);
  }
});

test('câbles : le tracé part de la prise A et arrive à la prise B', () => {
  const a = { point: [0, 0.12, 0.5], out: [0, 0, 1] };
  const b = { point: [4, 0.4, -0.3], out: [0, 0, -1] };
  const route = cableRoute(a, b);
  assert.ok(near(route[0], a.point), 'départ');
  assert.ok(near(route.at(-1), b.point), 'arrivée');
  assert.ok(route.length >= 4);
});

test('câbles : ils sortent perpendiculairement à la façade, puis descendent au sol', () => {
  const a = { point: [0, 0.3, 0.5], out: [0, 0, 1] };
  const b = { point: [5, 0.3, 0.5], out: [0, 0, 1] };
  const route = cableRoute(a, b);
  assert.equal(route[1][0], 0, 'le 2e point est droit devant la prise (même x)');
  assert.ok(route[1][2] > a.point[2], 'il avance vers l\'avant de la façade');
  assert.ok(route.some((p) => Math.abs(p[1] - FLOOR_Y) < 1e-9), 'il passe au sol');
  for (const p of route) assert.ok(p[1] >= FLOOR_Y - 1e-9, 'jamais sous le sol');
});

test('câbles : une prise au ras du sol ne fait pas de détour, deux prises proches ne font pas de boucle', () => {
  const low = cableRoute({ point: [0, FLOOR_Y, 0], out: [1, 0, 0] }, { point: [3, FLOOR_Y, 0], out: [-1, 0, 0] });
  assert.ok(low.every((p) => p[1] === FLOOR_Y && p[2] === 0), 'tout droit, au sol');
  const close = cableRoute({ point: [0, 0.2, 0], out: [1, 0, 0] }, { point: [0.05, 0.2, 0], out: [-1, 0, 0] });
  for (let i = 1; i < close.length; i += 1) {
    const d = Math.hypot(...close[i].map((v, k) => v - close[i - 1][k]));
    assert.ok(d > 0.02, 'pas de points confondus');
  }
});

test('câbles : extrémité de secours au bord de l\'équipement, tournée vers l\'autre', () => {
  const end = fallbackEnd([0, 0, 0], [10, 0, 0], 0.14, 0.45);
  assert.ok(near(end.out, [1, 0, 0]));
  assert.ok(near(end.point, [0.45, 0.14, 0]));
});

test('chemins de câbles (labo) : le câble monte au chemin, le suit à angle droit et redescend', () => {
  const a = { point: [0, 0.1, 0.5], out: [0, 0, 1] };
  const b = { point: [6, 0.4, -3], out: [0, 0, -1] };
  const { points, segments } = trayRoute(a, b, { height: 3.4 });
  assert.ok(near(points[0], a.point) && near(points.at(-1), b.point), 'de prise à prise');
  const top = points.filter((p) => Math.abs(p[1] - 3.4) < 1e-9);
  assert.ok(top.length >= 3, 'plusieurs points à la hauteur du chemin');
  assert.ok(Math.max(...points.map((p) => p[1])) <= 3.4 + 1e-9, 'jamais au-dessus du chemin');
  assert.equal(segments.length, 2, 'un tronçon le long de x, un le long de z');
  const [[p, q], [r, t]] = segments;
  assert.equal(p[1], q[1], 'premier tronçon : z constant');
  assert.equal(r[0], t[0], 'second tronçon : x constant');
});

test('chemins de câbles : départ sur le côté d\'une baie, décalage dans la nappe', () => {
  const a = { point: [0, 0.1, 0.5], out: [0, 0, 1], rise: [1.2, 0.1, 0.8] };
  const b = { point: [6, 0.4, 0.5], out: [0, 0, 1] };
  const route = trayRoute(a, b, { height: 3, offset: 0 });
  assert.ok(route.points.some((p) => near(p, [1.2, 0.1, 0.8])), 'passe par le point de montée imposé');
  assert.ok(route.points.some((p) => near(p, [1.2, 3, 0.8])), 'monte à la verticale de ce point');
  const shifted = trayRoute(a, b, { height: 3, offset: 0.12 }).points.filter((p) => p[1] === 3);
  assert.ok(shifted.every((p) => Math.abs(p[2] - 0.92) < 1e-9 || Math.abs(p[2] - 0.8) > 0.05), 'tronçon décalé dans la nappe');
  assert.deepEqual(route.segments.map((seg) => seg.length), [2], 'même z : un seul tronçon');
});

test('chemins de câbles : les tronçons qui se chevauchent forment un seul chemin', () => {
  const lines = trayLines([
    [[0, 1], [4, 1]],
    [[3, 1], [7, 1]],   // prolonge le premier
    [[10, 1], [12, 1]], // même ligne, mais séparé
    [[2, 0], [2, 5]],   // le long de z
  ]);
  const alongX = lines.filter((line) => line.axis === 'x').sort((m, n) => m.from - n.from);
  assert.deepEqual(alongX.map(({ at, from, to }) => [at, from, to]), [[1, 0, 7], [1, 10, 12]]);
  assert.deepEqual(lines.filter((line) => line.axis === 'z').map(({ at, from, to }) => [at, from, to]), [[2, 0, 5]]);
});

test('câbles : la courbe lisse reste au-dessus du sol, même sur un long parcours', () => {
  const route = cableRoute({ point: [-7.2, 0.16, -3.3], out: [0, 0, -1] }, { point: [-4.2, 0.1, 0.35], out: [0, 0, 1] });
  const curve = smoothRoute(route);
  assert.ok(near(curve[0], route[0]) && near(curve.at(-1), route.at(-1)), 'mêmes extrémités');
  const lowest = Math.min(...curve.map((p) => p[1]));
  assert.ok(lowest - CABLE_RADIUS > 0, `le câble passe sous le sol (axe à y = ${lowest.toFixed(3)})`);
  assert.ok(curve.length > route.length * 4, 'points rapprochés');
});

test('câbles : étiquette = type et vitesse réelle du lien, et ce qui le bride', () => {
  assert.deepEqual(cableTagLines({ speed: 1000, limitedBy: null }, { cable: 'cat6' }), { lines: ['Cat 6 · 1 Gb/s'], limited: false }, 'Cat 6 entre deux cartes Gigabit : 1 Gb/s, pas 10');
  assert.deepEqual(cableTagLines({ speed: 100, limitedBy: 'cable' }, { cable: 'cat5' }), { lines: ['Cat 5 · 100 Mb/s', 'bridé par le câble'], limited: true });
  assert.deepEqual(cableTagLines({ speed: 100, limitedBy: 'b' }, { cable: 'cat6', nameA: 'SW1', nameB: 'PC2' }).lines, ['Cat 6 · 100 Mb/s', 'bridé par PC2']);
  assert.deepEqual(cableTagLines({ speed: 10000, limitedBy: null }, { cable: 'fibre', lang: 'en' }).lines, ['OM3 fibre · 10 Gb/s']);
  assert.deepEqual(cableTagLines({ speed: 100, limitedBy: 'cable' }, { cable: 'cat5', lang: 'en' }).lines[1], 'limited by the cable');
  assert.equal(cableTagLines({ speed: 1000, limitedBy: null }).lines[0], 'Cat 6 · 1 Gb/s', 'sans type : Cat 6 par défaut');
});
