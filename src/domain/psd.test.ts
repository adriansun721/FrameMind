import { expect, it } from "vitest";
import { bandLimitedWhiteNoise, canonicalPsdConvention, convertPsd, evaluatePsd, importPsdCsv, integratePsd, normalizePsd, validatePsdInput } from "./psd";

it("imports a quoted UTF-8 CSV and integrates the independently known rectangular spectrum", () => {
  const input = importPsdCsv('\uFEFF"frequency","density"\r\n"10","2"\r\n"20","2"\r\n', { name: "rectangle", ...canonicalPsdConvention("force"), band: [10, 20] });
  expect(integratePsd(input)).toBe(20);
});

it("preserves a representable subnormal rectangular area rather than silently zeroing it", () => {
  expect(integratePsd(bandLimitedWhiteNoise("tiny", canonicalPsdConvention("force"), [0, 1], Number.MIN_VALUE))).toBe(Number.MIN_VALUE);
});

it("uses the independent triangle area with linear interpolation and zero outside the explicit band", () => {
  const triangle = { name: "triangle", ...canonicalPsdConvention("force"), band: [0, 10] as [number, number], points: [{ frequency: 0, density: 0 }, { frequency: 5, density: 4 }, { frequency: 10, density: 0 }] };
  expect(integratePsd(triangle)).toBe(20);
  expect(evaluatePsd(triangle, 2.5)).toBe(2);
  expect(evaluatePsd(triangle, 10.001)).toBe(0);
  expect(evaluatePsd(triangle, -1)).toBe(0);
});

it("converts axis, density, amplitude-squared units and even two-sided half together preserving variance", () => {
  const original = bandLimitedWhiteNoise("force", canonicalPsdConvention("force"), [10, 20], 2);
  const converted = convertPsd(original, { quantity: "force", excitationUnit: "N", frequencyUnit: "rad/s", densityUnit: "N²/(rad/s)", sidedness: "two-sided-even-positive" });
  expect(converted.points[0].frequency).toBeCloseTo(62.83185307179586, 12);
  expect(converted.points[0].density).toBeCloseTo(159154.94309189534, 8);
  expect(integratePsd(converted)).toBeCloseTo(20, 12);
  expect(normalizePsd(converted).points[0].density).toBeCloseTo(2, 12);
  const acceleration = bandLimitedWhiteNoise("acc", { quantity: "acceleration", excitationUnit: "mm/s²", frequencyUnit: "Hz", densityUnit: "(mm/s²)²/Hz", sidedness: "one-sided" }, [0, 10], 1000000);
  expect(integratePsd(acceleration)).toBe(10);
  expect(normalizePsd(acceleration).points[0].density).toBe(1);
});

const rectangle = () => bandLimitedWhiteNoise("rectangle", canonicalPsdConvention("force"), [10, 20], 2);
it.each([
  { frequencyUnit: undefined }, { densityUnit: undefined }, { excitationUnit: "m" }, { sidedness: "two-sided" },
  { densityUnit: "N²/Hz" }, { band: [10, 21] }, { band: [20, 10] },
  { points: [{ frequency: 10, density: 1 }, { frequency: 10, density: 2 }] },
  { points: [{ frequency: 20, density: 1 }, { frequency: 10, density: 2 }] },
  { points: [{ frequency: 10, density: -1 }, { frequency: 20, density: 2 }] },
  { points: [{ frequency: 10, density: Infinity }, { frequency: 20, density: 2 }] },
  { points: [{ frequency: NaN, density: 1 }, { frequency: 20, density: 2 }] },
])("rejects invalid or ambiguous input without repair: %j", (patch) => {
  expect(() => validatePsdInput({ ...rectangle(), ...patch })).toThrow();
});

it.each(["10,,2", "10,", "10,Infinity", "10,NaN", "0x10,2", "10,2\n10,3", "20,2\n10,2", "10,-2", "", "10,2\n\n20,2"])("rejects malformed CSV rows %s", (rows) => {
  expect(() => importPsdCsv(`frequency,density\n${rows}`, { name: "csv", ...canonicalPsdConvention("force"), band: [10, 20] })).toThrow();
});

it("rejects integral overflow and nonzero underflow while permitting a zero input", () => {
  expect(() => integratePsd(bandLimitedWhiteNoise("overflow", canonicalPsdConvention("force"), [0, 10], Number.MAX_VALUE))).toThrow();
  expect(() => integratePsd(bandLimitedWhiteNoise("underflow", canonicalPsdConvention("force"), [0, 0.01], Number.MIN_VALUE))).toThrow();
  expect(integratePsd(bandLimitedWhiteNoise("zero", canonicalPsdConvention("force"), [0, 10], 0))).toBe(0);
});
