import { describe, expect, it } from "vitest";
import { decodeSharedResourceLibrary, emptySharedResourceLibrary, loadSharedResourceLibrary, saveSharedResourceLibrary, type SharedResourceLibrary } from "./shared-resource-library";

const library: SharedResourceLibrary = {
  version: 1,
  materials: [{ libraryId: "custom-steel", name: "课程钢材", elasticModulusGPa: 206, poissonRatio: 0.3, densityKgM3: 7850 }],
  sections: [{ libraryId: "custom-box", name: "课程截面", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0002, torsionalConstantM4: 0.00015 }],
};

describe("shared resource library persistence", () => {
  it("starts empty and restores material and section parameters across sessions", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadSharedResourceLibrary(storage)).toEqual(emptySharedResourceLibrary());
    saveSharedResourceLibrary(storage, library);
    const restored = loadSharedResourceLibrary(storage);
    expect(restored.materials[0]).toEqual({ libraryId: "custom-steel", name: "课程钢材", elasticModulusGPa: 206, poissonRatio: 0.3, densityKgM3: 7850 });
    expect(restored.sections[0]).toEqual({ libraryId: "custom-box", name: "课程截面", areaM2: 0.01, secondMomentYM4: 0.0001, secondMomentZM4: 0.0002, torsionalConstantM4: 0.00015 });
    restored.materials[0].name = "修改副本";
    expect(loadSharedResourceLibrary(storage).materials[0].name).toBe("课程钢材");
  });

  it.each([
    "{bad json", JSON.stringify({ ...library, version: 2 }),
    JSON.stringify({ ...library, materials: [{ ...library.materials[0], elasticModulusGPa: -1 }] }),
    JSON.stringify({ ...library, materials: [{ ...library.materials[0], poissonRatio: 0.5 }] }),
    JSON.stringify({ ...library, sections: [{ ...library.sections[0], areaM2: "0.01" }] }),
    JSON.stringify({ ...library, sections: [{ ...library.sections[0], name: " " }] }),
    JSON.stringify({ ...library, sections: [{ ...library.sections[0], libraryId: "custom-steel" }] }),
  ])("rejects invalid or unsupported persisted data", (content) => {
    expect(() => decodeSharedResourceLibrary(content)).toThrow();
  });

  it("preserves the previous stored data when a write fails", () => {
    let content = JSON.stringify(library);
    const storage = { getItem: () => content, setItem: () => { throw new Error("Storage full"); } };
    expect(() => saveSharedResourceLibrary(storage, emptySharedResourceLibrary())).toThrow("Storage full");
    expect(loadSharedResourceLibrary(storage)).toEqual(library);
    content = "broken";
    expect(() => loadSharedResourceLibrary(storage)).toThrow();
  });
});
