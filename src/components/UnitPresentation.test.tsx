import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { UnitInput, UnitPresetContext } from "./UnitPresentation";
import type { UnitPresetId } from "../domain/units";

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
