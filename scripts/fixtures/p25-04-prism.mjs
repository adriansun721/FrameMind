/** Analytic reference: 100 x 100 x 1000 mm rectangular prism, centroid (0,0,z). */
export function prismStep(taper = false) {
  let next = 10;
  const lines = [], add = (type, args) => { const id = next++; lines.push(`#${id}=${type}(${args});`); return id; };
  const corners = [0, 1000].flatMap((z) => [-50, 50].flatMap((x) => [-50, 50].map((y) => [taper && z ? x * .5 : x, y, z])));
  const vertices = corners.map((p) => add("VERTEX_POINT", `'',#${add("CARTESIAN_POINT", `'',(${p})`)}`));
  const edges = new Map();
  const faces = [];
  for (const [indices, normal] of [[[0, 1, 3, 2], [0, 0, -1]], [[4, 6, 7, 5], [0, 0, 1]], [[0, 4, 5, 1], [-1, 0, 0]], [[2, 3, 7, 6], [1, 0, 0]], [[0, 2, 6, 4], [0, -1, 0]], [[1, 5, 7, 3], [0, 1, 0]]]) {
    const oriented = [];
    for (let i = 0; i < 4; i++) {
      const a = indices[i], b = indices[(i + 1) % 4], key = [a, b].sort().join(":"), cached = edges.get(key);
      let edge = cached?.id;
      if (!edge) {
        const origin = add("CARTESIAN_POINT", `'',(${corners[a]})`), delta = corners[b].map((v, j) => v - corners[a][j]);
        const length = Math.hypot(...delta), direction = add("DIRECTION", `'',(${delta.map((v) => v / length)})`), vector = add("VECTOR", `'',#${direction},1.`);
        const curve = add("LINE", `'',#${origin},#${vector}`);
        edge = add("EDGE_CURVE", `'',#${vertices[a]},#${vertices[b]},#${curve},.T.`); edges.set(key, { id: edge, start: a });
      }
      oriented.push(add("ORIENTED_EDGE", `'',*,*,#${edge},${(cached?.start ?? a) === a ? ".T." : ".F."}`));
    }
    const loop = add("EDGE_LOOP", `'',(${oriented.map((id) => `#${id}`)})`), bound = add("FACE_OUTER_BOUND", `'',#${loop},.T.`);
    const origin = add("CARTESIAN_POINT", `'',(${corners[indices[0]]})`), axis = add("DIRECTION", `'',(${normal})`);
    const tangent = Math.abs(normal[0]) ? [0, 1, 0] : [1, 0, 0], ref = add("DIRECTION", `'',(${tangent})`);
    const placement = add("AXIS2_PLACEMENT_3D", `'',#${origin},#${axis},#${ref}`), plane = add("PLANE", `'',#${placement}`);
    faces.push(add("ADVANCED_FACE", `'',(#${bound}),#${plane},.T.`));
  }
  const shell = add("CLOSED_SHELL", `'',(${faces.map((id) => `#${id}`)})`); add("MANIFOLD_SOLID_BREP", `'analytic prism',#${shell}`);
  lines.push(`#${next++}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Analytic P25-04 prism'),'2;1');\nFILE_NAME('prism.step','2026-10-09T00:00:00',('FrameMind'),('FrameMind'),'fixture','fixture','');\nFILE_SCHEMA(('AP203'));\nENDSEC;\nDATA;\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
