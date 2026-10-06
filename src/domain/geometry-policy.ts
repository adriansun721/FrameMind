/** Geometry uses canonical metres. Interaction tolerances never create connections. */
export const GEOMETRY_CONTRACT = {
  coordinateUnit: "m",
  coordinates: "finite-double-no-grid-clipping",
  connectivity: "explicit-node-id-only",
  intersections: "do-not-connect-or-split",
  topology: { pointOnMemberToleranceM: 1e-9, localAxisTolerance: 1e-9, operation: "explicit-reviewed-engineering-topology", nodeReuse: "explicit-exact-identity", solverSubdivision: "does-not-create-engineering-objects" },
  duplicates: { comparison: "exact-xyz", automaticMerge: false },
  nodeMerge: { defaultToleranceM: 1e-6, comparison: "euclidean-distance-to-explicit-target", scaleWithCoordinates: false, automaticMerge: false },
  snapping: { defaultEnabled: true, userControllable: true, nodeRadiusPixels: 12, planeMembership: "exact-normal-coordinate", numericInput: "exact-xyz-only", parallelRayTolerance: 1e-10, automaticGridSnap: false },
  memberLength: { minimumExclusive: 1e-12, scaleWithCoordinates: false },
  picking: { nodeRadius: 0.22, nodeRadiusPixels: 8, memberRadiusPixels: 6, memberRadiusMin: 0.08, memberRadiusMax: 0.16, memberLengthFactor: 0.02, lineThreshold: 0.04, clickMovementPixels: 4 },
  solver: { relativePivotTolerance: 1e-12, relativeResidualTolerance: 1e-10, absoluteResidualTolerance: 1e-9 },
} as const;
