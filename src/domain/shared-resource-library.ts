import { validateMaterial, validateSection, type MaterialProperties, type SectionProperties } from "./project";

export interface CustomMaterial extends MaterialProperties { libraryId: string; }
export interface CustomSection extends SectionProperties { libraryId: string; }
export interface SharedResourceLibrary {
  version: 1;
  materials: CustomMaterial[];
  sections: CustomSection[];
}

const STORAGE_KEY = "framemind.shared-resource-library.v1";

export function emptySharedResourceLibrary(): SharedResourceLibrary {
  return { version: 1, materials: [], sections: [] };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("资源库数据格式无效");
  return value as Record<string, unknown>;
}

function textField(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("资源库名称或标识无效");
  return value.trim();
}

function numberField(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("资源库参数必须为有限数值");
  return value;
}

export function decodeSharedResourceLibrary(content: string): SharedResourceLibrary {
  const data = record(JSON.parse(content));
  if (data.version !== 1 || !Array.isArray(data.materials) || !Array.isArray(data.sections)) {
    throw new Error("资源库版本或数据格式不支持");
  }
  const materials = data.materials.map((value) => {
    const item = record(value);
    return { libraryId: textField(item.libraryId), ...validateMaterial("资源库", {
      name: textField(item.name), elasticModulusGPa: numberField(item.elasticModulusGPa),
      poissonRatio: numberField(item.poissonRatio), densityKgM3: numberField(item.densityKgM3),
    }) };
  });
  const sections = data.sections.map((value) => {
    const item = record(value);
    return { libraryId: textField(item.libraryId), ...validateSection("资源库", {
      ...(item.geometry !== undefined ? { geometry: item.geometry as NonNullable<SectionProperties["geometry"]> } : {}),
      name: textField(item.name), areaM2: numberField(item.areaM2),
      secondMomentYM4: numberField(item.secondMomentYM4), secondMomentZM4: numberField(item.secondMomentZM4),
      torsionalConstantM4: numberField(item.torsionalConstantM4),
    }) };
  });
  const ids = [...materials, ...sections].map((item) => item.libraryId);
  if (new Set(ids).size !== ids.length) throw new Error("资源库存在重复标识");
  return { version: 1, materials, sections };
}

export function loadSharedResourceLibrary(storage: Pick<Storage, "getItem">): SharedResourceLibrary {
  const content = storage.getItem(STORAGE_KEY);
  return content === null ? emptySharedResourceLibrary() : decodeSharedResourceLibrary(content);
}

export function saveSharedResourceLibrary(storage: Pick<Storage, "setItem">, library: SharedResourceLibrary): void {
  const validated = decodeSharedResourceLibrary(JSON.stringify(library));
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
}
