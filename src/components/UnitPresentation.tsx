import { createContext, useContext, useState, type InputHTMLAttributes } from "react";
import { convertQuantity, unitDimension, unitPresentation, type UnitPresetId } from "../domain/units";

export const UnitPresetContext = createContext<UnitPresetId>("m-kN");
export const useUnits = () => unitPresentation(useContext(UnitPresetContext));

/** Drafts remain canonical strings. A switch never writes a formatted value back. */
export function UnitInput({ value, unit, onValueChange, list = false, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> & {
  value: string; unit: string; onValueChange(value: string): void; list?: boolean;
}) {
  const u = useUnits(); const displayedUnit = u.unit(unit);
  const [edit, setEdit] = useState<{ canonical: string; unit: string; text: string } | null>(null);
  const display = (text: string) => text.split(",").map((v) => v.trim() && Number.isFinite(Number(v)) ? String(u.value(Number(v), unit)) : v).join(list ? ", " : "");
  const text = edit?.canonical === value && edit.unit === displayedUnit ? edit.text : display(value);
  return <input {...props} type={list ? "text" : props.type ?? "number"} step="any" value={text} data-unit={displayedUnit} onChange={(event) => {
    const entered = event.target.value;
    let canonical: string;
    try {
      canonical = entered.split(",").map((v) => v.trim() && Number.isFinite(Number(v))
        ? String(convertQuantity(Number(v), unitDimension(unit), displayedUnit, unit)) : v).join(list ? ", " : "");
    } catch { canonical = "NaN"; }
    setEdit({ canonical, unit: displayedUnit, text: entered }); onValueChange(canonical);
  }} />;
}
