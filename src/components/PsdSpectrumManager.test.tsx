import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createProject } from "../domain/project";
import { applyProjectEdits } from "../domain/project-operations";
import { bandLimitedWhiteNoise, canonicalPsdConvention } from "../domain/psd";
import { PsdSpectrumManager } from "./PsdSpectrumManager";

afterEach(cleanup);

it("previews and converts an input table with unchanged physical variance then saves canonical values", () => {
  const onChange = vi.fn();
  render(<PsdSpectrumManager project={createProject()} onChange={onChange} onClose={() => {}} />);
  expect(screen.getByTestId("psd-variance")).toHaveTextContent("输入均方值：20 kN²");
  fireEvent.change(screen.getByLabelText("目标激励量单位"), { target: { value: "N" } });
  fireEvent.change(screen.getByLabelText("目标频率单位"), { target: { value: "rad/s" } });
  fireEvent.change(screen.getByLabelText("目标谱约定"), { target: { value: "two-sided-even-positive" } });
  fireEvent.click(screen.getByRole("button", { name: "转换当前谱" }));
  expect(screen.getByTestId("psd-variance")).toHaveTextContent("输入均方值：20 kN²");
  expect(screen.getByLabelText("点 1 密度")).toHaveValue(159154.94309189534);
  fireEvent.click(screen.getByRole("button", { name: "保存输入谱" }));
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange.mock.calls[0][0].psdSpectra[0]).toMatchObject({ densityUnit: "kN²/Hz", sidedness: "one-sided", frequencyUnit: "Hz", band: [10, 20] });
});

it("blocks a stale loaded spectrum after external editing while preserving unrelated project edits", () => {
  const properties = bandLimitedWhiteNoise("original", canonicalPsdConvention("force"), [10, 20], 2);
  const original = applyProjectEdits(createProject(), [{ type: "create_psd_spectrum", properties }]).project;
  const onChange = vi.fn();
  const { rerender } = render(<PsdSpectrumManager project={original} onChange={onChange} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /PSD1 · original/ }));
  fireEvent.change(screen.getByLabelText("输入谱名称"), { target: { value: "local edit" } });
  const modified = applyProjectEdits(original, [{ type: "update_psd_spectrum", id: "PSD1", properties: { ...properties, name: "external edit" } }]).project;
  rerender(<PsdSpectrumManager project={modified} onChange={onChange} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "保存输入谱" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("已变化");
  fireEvent.click(screen.getByRole("button", { name: "删除输入谱" }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /PSD1 · external edit/ }));
  const unrelated = applyProjectEdits(modified, [{ type: "create_node", position: { x: 1, y: 0, z: 0 } }]).project;
  rerender(<PsdSpectrumManager project={unrelated} onChange={onChange} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "保存输入谱" }));
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange.mock.calls[0][0].nodes).toHaveLength(1);
});

it("refuses empty table values and missing CSV units without replacing data or committing", () => {
  const onChange = vi.fn();
  render(<PsdSpectrumManager project={createProject()} onChange={onChange} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("PSD CSV 内容"), { target: { value: "frequency,density\n10,1\n20,1" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并导入 CSV" }));
  expect(screen.getByRole("alert")).toHaveTextContent("不能为空");
  expect(screen.getByLabelText("点 1 密度")).toHaveValue(2);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("点 1 密度"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "保存输入谱" })).toBeDisabled();
  expect(screen.queryByTestId("psd-variance")).toBeNull();
});
