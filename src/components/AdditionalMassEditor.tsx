import { useState } from "react";
import { validateAdditionalMass } from "../domain/additional-mass";
import { UnitInput, useUnits } from "./UnitPresentation";

export function AdditionalMassEditor({ kind, value, onCommit }: {
  kind: "point" | "line"; value: number; onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState<string>();
  const u = useUnits(), unit = kind === "point" ? "kg" : "kg/m", label = kind === "point" ? "附加点质量" : "附加线质量";
  return <form className="property-form" onSubmit={(e) => {
    e.preventDefault();
    try {
      if (!draft.trim()) throw new Error("请输入附加质量，0 表示移除");
      onCommit(validateAdditionalMass(Number(draft))); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "质量设置失败"); }
  }}>
    <h3>{label}</h3>
    <label className="field"><span>{label} ({u.unit(unit)})</span><UnitInput aria-label={label} value={draft} unit={unit} onValueChange={setDraft} required min="0" /></label>
    <p className="catalog-field-notes">各向同性平移质量，{kind === "line" ? "沿整杆参考轴均布" : "作用于当前工程节点"}；不含附加转动惯性。0 表示移除。仅用于动力质量，不自动生成静力自重。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" type="submit">保存{label}</button>
  </form>;
}
