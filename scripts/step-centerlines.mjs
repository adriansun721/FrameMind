// Conservative analytic extrusion reader. It never treats LINE.vector.magnitude
// (a curve parameter scale) as a physical member length.
const refs = (value = "") => [...value.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
const numbers = (value = "") => [...value.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/g)].map((match) => Number(match[0]));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scale = (a, s) => a.map((x) => x * s);
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / norm(a));
const clean = (a) => a.map((x) => Math.round(x * 1e12) / 1e12);
const point = (matrix, p) => clean(matrix.slice(0, 3).map((row) => dot(row.slice(0, 3), p) + row[3]));
const bound = (points) => ({ min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))), max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))) });

export function extractStepCenterlines(records, units, instances) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const toleranceM = 1e-7; // Geometry recognition, separate from the 0.5 mm contact tolerance.
  const readPoint = (id) => numbers(byId.get(id)?.args[1]).slice(0, 3).map((x) => x * units.lengthToM);
  const direction = (id) => unit(numbers(byId.get(id)?.args[1]).slice(0, 3));
  const placement = (id) => { const r = byId.get(id); return { origin: readPoint(refs(r?.args[1])[0]), axis: r?.args[2] === "$" ? [0, 0, 1] : direction(refs(r?.args[2])[0]) }; };
  const descendants = (id) => {
    const visited = new Set(), stack = [id];
    while (stack.length) { const next = stack.pop(); if (!next || visited.has(next)) continue; visited.add(next); const r = byId.get(next); if (r) stack.push(...refs(r.body)); }
    return [...visited].map((key) => byId.get(key)).filter(Boolean);
  };
  const definitions = records.filter((r) => r.type === "MANIFOLD_SOLID_BREP").map((solid) => {
    const owned = descendants(solid.id), vertices = owned.filter((r) => r.type === "VERTEX_POINT").map((r) => ({ id: r.id, point: readPoint(refs(r.args[1])[0]) }));
    const surfaces = owned.filter((r) => r.type === "PLANE" || r.type.endsWith("SURFACE"));
    const unsupported = surfaces.filter((r) => r.type !== "PLANE");
    const curveKinds = owned.filter((r) => r.type === "EDGE_CURVE").map((r) => byId.get(refs(r.args[3])[0])?.type);
    const finiteVertices = vertices.filter((v) => v.point.length === 3 && v.point.every(Number.isFinite));
    const vertexBounds = finiteVertices.length ? bound(finiteVertices.map((v) => v.point)) : undefined;
    // Trimmed arcs need area centroids and curve extrema, which this reader has
    // not verified. Vertex/circle-center symmetry alone is insufficient.
    if (!units.explicit || finiteVertices.length !== vertices.length || vertices.length < 6 || curveKinds.length < 3 || unsupported.length || curveKinds.some((kind) => kind !== "LINE")) return { solidId: solid.id, status: "blocked", reason: "单位、端截面或曲面不在已验证的平面直边对称恒截面范围；圆弧与自由曲面需独立几何核验", vertexBounds, sourceEntityIds: [solid.id, ...unsupported.map((r) => r.id)] };
    const candidateAxes = [];
    for (const r of surfaces) { const a = placement(refs(r.args[1])[0]).axis; if (a.length === 3 && a.every(Number.isFinite) && !candidateAxes.some((v) => Math.abs(dot(v, a)) > 1 - 1e-9)) candidateAxes.push(a); }
    const matches = [], rejections = [];
    for (const rawAxis of candidateAxes) {
      const axis = rawAxis.find((x) => Math.abs(x) > 1e-9) < 0 ? scale(rawAxis, -1) : rawAxis;
      const projections = vertices.map(({ point: p }) => dot(p, axis)), lo = Math.min(...projections), hi = Math.max(...projections), lengthM = hi - lo;
      if (lengthM <= toleranceM) continue;
      const ends = [lo, hi].map((level) => vertices.filter((v) => Math.abs(dot(v.point, axis) - level) <= toleranceM));
      if (ends.some((end) => end.length < 3)) continue;
      const profile = ends[0].map((v) => sub(v.point, scale(axis, lo)));
      const other = ends[1].map((v) => sub(v.point, scale(axis, hi)));
      const near = (p, list) => list.some((q) => norm(sub(p, q)) <= toleranceM);
      if (profile.length !== other.length || profile.some((p) => !near(p, other)) || vertices.some((v) => !near(sub(v.point, scale(axis, dot(v.point, axis))), profile))) { rejections.push("end-profile-mismatch"); continue; }
      // Every side must be parallel to the extrusion. Interior axial faces,
      // curved axes, tapers, and arbitrary freeform surfaces are rejected.
      if (surfaces.some((r) => { const p = placement(refs(r.args[1])[0]), cosine = Math.abs(dot(p.axis, axis)); return r.type === "CYLINDRICAL_SURFACE" ? cosine < 1 - 1e-9 : cosine > 1e-9 && cosine < 1 - 1e-9 || cosine > 1 - 1e-9 && Math.min(Math.abs(dot(p.origin, axis) - lo), Math.abs(dot(p.origin, axis) - hi)) > toleranceM; })) { rejections.push("non-extruded-side-or-interior-end-face"); continue; }
      const bounds = bound(profile), center = bounds.min.map((x, i) => (x + bounds.max[i]) / 2);
      // A centrally symmetric analytic profile has its centroid at the symmetry
      // center. Asymmetric sections are blocked instead of guessing a centroid.
      if (profile.some((p) => !near(sub(scale(center, 2), p), profile))) { rejections.push("asymmetric-profile"); continue; }
      // Prove symmetry of the actual closed cap boundary, not merely its vertex
      // cloud. A symmetric set of vertices can form an asymmetric polygon.
      const capEdges = [lo, hi].map((level) => {
        const caps = owned.filter((r) => r.type === "ADVANCED_FACE" && (() => {
          const surface = byId.get(refs(r.args[2])[0]);
          if (surface?.type !== "PLANE") return false;
          const p = placement(refs(surface.args[1])[0]);
          return Math.abs(dot(p.axis, axis)) > 1 - 1e-9 && Math.abs(dot(p.origin, axis) - level) <= toleranceM;
        })());
        if (caps.length !== 1) return null;
        const bounds = refs(caps[0].args[1]);
        if (bounds.length !== 1 || byId.get(bounds[0])?.type !== "FACE_OUTER_BOUND") return null;
        const loop = byId.get(refs(byId.get(bounds[0]).args[1])[0]);
        if (loop?.type !== "EDGE_LOOP") return null;
        const edges = refs(loop.args[1]).map((id) => {
          const oriented = byId.get(id), edge = byId.get(refs(oriented?.args[3])[0]);
          if (oriented?.type !== "ORIENTED_EDGE" || edge?.type !== "EDGE_CURVE") return null;
          const ids = [refs(edge.args[1])[0], refs(edge.args[2])[0]];
          if (oriented.args[4] === ".F.") ids.reverse();
          return ids.map((id) => vertices.find((v) => v.id === id)?.point);
        });
        if (edges.length < 3 || edges.some((e) => !e || e.some((p) => !p || Math.abs(dot(p, axis) - level) > toleranceM))) return null;
        if (edges.some((e, i) => norm(sub(e[1], edges[(i + 1) % edges.length][0])) > toleranceM)) return null;
        const projected = edges.map((e) => e.map((p) => sub(p, scale(axis, level))));
        if (projected.length !== profile.length || profile.some((p) => !near(p, projected.flat()))) return null;
        return projected;
      });
      const sameEdge = (a, b) => a.every((p) => near(p, b));
      if (capEdges.some((edges) => !edges || edges.some((edge) => !edges.some((other) => sameEdge(edge.map((p) => sub(scale(center, 2), p)), other))))
        || capEdges[0].some((edge) => !capEdges[1].some((other) => sameEdge(edge, other)))) { rejections.push("unverified-or-asymmetric-cap-boundary"); continue; }
      matches.push({ direction: clean(axis), lengthM, start: clean(add(center, scale(axis, lo))), end: clean(add(center, scale(axis, hi))), endSections: ends.map((end) => end.map((v) => clean(v.point))), boundingBox: bound(vertices.map((v) => v.point)), sourceEntityIds: [solid.id, ...ends.flatMap((end) => end.map((v) => v.id))] });
    }
    matches.sort((a, b) => b.lengthM - a.lengthM);
    const unique = matches.length === 1 || matches.length > 1 && matches[0].lengthM >= 3 * matches[1].lengthM;
    if (!unique) return { solidId: solid.id, status: "blocked", reason: `无法唯一证明恒截面主轴（${matches.length} 个可行轴）`, rejections: [...new Set(rejections)], vertexBounds: bound(vertices.map((v) => v.point)), sourceEntityIds: [solid.id] };
    return { solidId: solid.id, status: "supported", method: "planar-linear-closed-symmetric-translated-cap-boundaries", ...matches[0] };
  });
  // Follow product -> shape representation -> BREP representation. Never use
  // assembly relationships to assign a part's solid to another part.
  const representationByDefinition = new Map();
  for (const r of records.filter((r) => r.type === "SHAPE_DEFINITION_REPRESENTATION")) { const shape = byId.get(refs(r.args[0])[0]); representationByDefinition.set(refs(shape?.args[2])[0], refs(r.args[1])[0]); }
  const solidsByRepresentation = new Map();
  for (const r of records.filter((r) => r.type.endsWith("REPRESENTATION"))) { const ids = refs(r.body).filter((id) => byId.get(id)?.type === "MANIFOLD_SOLID_BREP"); if (ids.length) solidsByRepresentation.set(r.id, ids); }
  for (const r of records.filter((r) => r.type === "SHAPE_REPRESENTATION_RELATIONSHIP")) { const [a, b] = refs(r.body); const solids = solidsByRepresentation.get(b); if (solids) solidsByRepresentation.set(a, solids); }
  const centerlines = [], issues = [], solidInstances = [];
  const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const placements = instances.length ? instances : definitions.map((d) => ({ id: null, solidIds: [d.solidId], globalTransform: identity }));
  for (const instance of placements) {
    const ids = instance.solidIds ?? solidsByRepresentation.get(representationByDefinition.get(instance.childDefinitionId)) ?? [];
    if (!ids.length) issues.push({ code: "unresolved-instance-solid", severity: "blocking", instanceId: instance.id, sourceEntityIds: [instance.id], message: "装配实例缺少可追溯实体" });
    for (const id of ids) {
      const d = definitions.find((d) => d.solidId === id);
      const bounds = d?.boundingBox ?? d?.vertexBounds;
      if (bounds) { const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => point(instance.globalTransform, [bounds[x ? "max" : "min"][0], bounds[y ? "max" : "min"][1], bounds[z ? "max" : "min"][2]])))); solidInstances.push({ instanceId: instance.id, solidId: id, status: d.status, boundsBasis: d.status === "supported" ? "verified-linear-vertices" : "vertex-sample-only", bounds: bound(corners), transform: instance.globalTransform, sourceEntityIds: [id, ...(instance.id ? [instance.id] : [])] }); }
      if (!d || d.status !== "supported") { issues.push({ code: "uncertain-principal-axis", severity: "blocking", instanceId: instance.id, sourceEntityIds: d?.sourceEntityIds ?? [id], message: d?.reason ?? "实体缺失" }); continue; }
      const start = point(instance.globalTransform, d.start), end = point(instance.globalTransform, d.end), endSections = d.endSections.map((section) => section.map((p) => point(instance.globalTransform, p)));
      centerlines.push({ id: `axis-${instance.id ?? "definition"}-${id}`, instanceId: instance.id, solidId: id, start, end, lengthM: d.lengthM, direction: clean(unit(sub(end, start))), endSections, boundingBox: bound(endSections.flat()), method: d.method, sourceEntityIds: [...d.sourceEntityIds, ...(instance.id ? [instance.id] : [])] });
    }
  }
  return { schemaVersion: 1, recognitionToleranceM: toleranceM, definitions, solidInstances, centerlines, issues };
}
