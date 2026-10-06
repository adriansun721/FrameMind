import type { FrameProject } from "./project";
import { decodePsdSpectrum, normalizePsd, type PsdInput, type PsdSpectrum } from "./psd";

function replace(project: FrameProject, spectra: PsdSpectrum[], nextPsdNumber = project.nextPsdNumber): FrameProject {
  if (!Number.isSafeInteger(project.revision) || project.revision >= Number.MAX_SAFE_INTEGER) throw new Error("项目编号状态无法安全递增");
  return { ...project, psdSpectra: spectra, nextPsdNumber, revision: project.revision + 1, updatedAt: new Date().toISOString() };
}
export function addPsdSpectrum(project: FrameProject, input: PsdInput): FrameProject {
  if (!Number.isSafeInteger(project.nextPsdNumber) || project.nextPsdNumber < 1 || project.nextPsdNumber >= Number.MAX_SAFE_INTEGER) throw new Error("PSD 编号无法安全递增");
  const id = `PSD${project.nextPsdNumber}`;
  if (project.psdSpectra.some((s) => s.id === id)) throw new Error("PSD 编号重复");
  const spectrum = decodePsdSpectrum({ id, ...normalizePsd(input), interpolation: "linear", outsideBand: "zero" });
  return replace(project, [...project.psdSpectra, spectrum], project.nextPsdNumber + 1);
}
export function updatePsdSpectrum(project: FrameProject, id: string, input: PsdInput): FrameProject {
  if (!project.psdSpectra.some((s) => s.id === id)) throw new Error(`输入谱 ${id} 不存在`);
  const spectrum = decodePsdSpectrum({ id, ...normalizePsd(input), interpolation: "linear", outsideBand: "zero" });
  return replace(project, project.psdSpectra.map((s) => s.id === id ? spectrum : s));
}
export function deletePsdSpectrum(project: FrameProject, id: string): FrameProject {
  if (!project.psdSpectra.some((s) => s.id === id)) throw new Error(`输入谱 ${id} 不存在`);
  return replace(project, project.psdSpectra.filter((s) => s.id !== id));
}
