import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { UnitInput, UnitPresetContext } from "./UnitPresentation";
import samples from "../../docs/evidence/plan2/T2-14/wire-samples.json";
import { decodeProject, decodeAnalysisResult } from "../domain/project-file";
import { attachAnalysisResult } from "../domain/project";
import { LoadCaseManager } from "./LoadCaseManager";
import type { UnitPresetId } from "../domain/units";

afterEach(cleanup);

it("keeps draft precision and incomplete editing text when switching presentation", () => {
  function Editor() {
    const [value, setValue] = useState("1000000000.125");
    const [preset, setPreset] = useState<UnitPresetId>("m-kN");
    return <UnitPresetContext.Provider value={preset}><UnitInput aria-label="坐标" value={value} unit="m" onValueChange={setValue} /><output>{value}</output><button onClick={() => setPreset(preset === "m-kN" ? "mm-N" : "m-kN")}>切换</button></UnitPresetContext.Provider>;
  }
  render(<Editor />);
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("status").textContent).toBe("1000000000.125");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByLabelText("坐标")).toHaveValue(1000000000125);
  fireEvent.change(screen.getByLabelText("坐标"), { target: { value: "0.001" } });
  expect(screen.getByRole("status").textContent).toBe("0.000001");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByLabelText("坐标")).toHaveValue(.000001);
});

it("shows load-case response comparisons in the selected preset", () => {
  const sample = samples.find((entry) => entry.id === "axial")!;
  const project = attachAnalysisResult(decodeProject(JSON.stringify(sample.project)), decodeAnalysisResult(sample.result));
  const { rerender } = render(<UnitPresetContext.Provider value="mm-N"><LoadCaseManager project={project} onChange={() => {}} onSelfWeight={() => {}} onClose={() => {}} /></UnitPresetContext.Provider>);
  expect(screen.getByRole("columnheader", { name: "位移 XYZ (mm)" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "反力 XYZ (N)" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "0.016, 0, 0" })).toBeVisible();
  rerender(<UnitPresetContext.Provider value="m-kN"><LoadCaseManager project={project} onChange={() => {}} onSelfWeight={() => {}} onClose={() => {}} /></UnitPresetContext.Provider>);
  expect(screen.getByRole("columnheader", { name: "位移 XYZ (m)" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "0.000016, 0, 0" })).toBeVisible();
});
