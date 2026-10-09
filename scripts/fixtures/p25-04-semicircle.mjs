/** Upper half-disk prism: r=50 mm, L=1000 mm. Its centroid is
 * y=4r/(3pi), despite its split-diameter vertex cloud being symmetric. */
export function semicircleStep() {
  let next = 10;
  const lines = [], add = (type, args) => { const id = next++; lines.push(`#${id}=${type}(${args});`); return id; };
  const corners = [0, 1000].flatMap((z) => [-50, 0, 50].map((x) => [x, 0, z]));
  const cartesian = (p) => add("CARTESIAN_POINT", `'',(${p})`);
  const direction = (p) => add("DIRECTION", `'',(${p})`);
  const placement = (p, normal) => add("AXIS2_PLACEMENT_3D", `'',#${cartesian(p)},#${direction(normal)},#${direction(Math.abs(normal[0]) ? [0, 1, 0] : [1, 0, 0])}`);
  const vertices = corners.map((p) => add("VERTEX_POINT", `'',#${cartesian(p)}`));
  const edges = new Map();
  const edge = (a, b, arc = false) => {
    const key = [a, b].sort().join(":"), previous = edges.get(key);
    let id = previous?.id;
    if (!id) {
      const delta = corners[b].map((v, i) => v - corners[a][i]), length = Math.hypot(...delta);
      const curve = arc
        ? add("CIRCLE", `'',#${placement([0, 0, corners[a][2]], [0, 0, 1])},50.`)
        : add("LINE", `'',#${cartesian(corners[a])},#${add("VECTOR", `'',#${direction(delta.map((v) => v / length))},1.`)}`);
      id = add("EDGE_CURVE", `'',#${vertices[a]},#${vertices[b]},#${curve},.T.`);
      edges.set(key, { id, start: a });
    }
    return add("ORIENTED_EDGE", `'',*,*,#${id},${(previous?.start ?? a) === a ? ".T." : ".F."}`);
  };
  const face = (sequence, normal, cylinder = false) => {
    const oriented = sequence.map(([a, b, arc]) => edge(a, b, arc));
    const loop = add("EDGE_LOOP", `'',(${oriented.map((id) => `#${id}`)})`);
    const bound = add("FACE_OUTER_BOUND", `'',#${loop},.T.`);
    const surface = add(cylinder ? "CYLINDRICAL_SURFACE" : "PLANE", `'',#${placement(cylinder ? [0, 0, 0] : corners[sequence[0][0]], normal)}${cylinder ? ",50." : ""}`);
    return add("ADVANCED_FACE", `'',(#${bound}),#${surface},.T.`);
  };
  const faces = [
    face([[0, 1], [1, 2], [2, 0, true]], [0, 0, 1]),
    face([[3, 5, true], [5, 4], [4, 3]], [0, 0, 1]),
    face([[0, 3], [3, 4], [4, 1], [1, 0]], [0, -1, 0]),
    face([[1, 4], [4, 5], [5, 2], [2, 1]], [0, -1, 0]),
    face([[2, 5], [5, 3, true], [3, 0], [0, 2, true]], [0, 0, 1], true),
  ];
  const shell = add("CLOSED_SHELL", `'',(${faces.map((id) => `#${id}`)})`);
  add("MANIFOLD_SOLID_BREP", `'upper semicircular prism',#${shell}`);
  lines.push(`#${next++}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('P25-04 asymmetric arc regression'),'2;1');\nFILE_SCHEMA(('AP203'));\nENDSEC;\nDATA;\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
