import { useState } from "react";
import { getMemberSectionForces, type AnalysisResult, type MemberAnalysisResult } from "../domain/analysis";

export function MemberSectionQuery({ result, member, onLocate }: { result: AnalysisResult; member: MemberAnalysisResult; onLocate?: (position: number) => void }) {
  const [position, setPosition] = useState(String(member.length / 2));
  const label = result.input.members.find((item) => item.id === member.memberId)?.label ?? member.memberId;
  let forces: number[] | undefined; let error: string | undefined;
  try {
    if (!position.trim()) throw new Error("沿杆位置不能为空");
    forces = getMemberSectionForces(result, member.memberId, Number(position)).forces;
  } catch (failure) { error = failure instanceof Error ? failure.message : "沿杆查询不可用"; }
  return <div className="member-section-query" aria-label={`${label} 沿杆内力`} onClick={(event) => event.stopPropagation()}>
    <label className="field"><span>距起点 x（m） · 0–{member.length.toFixed(3)}</span><input type="number" step="any" min={0} max={member.length} aria-label={`${label} 沿杆位置`} value={position} aria-invalid={!!error} onChange={(event) => setPosition(event.target.value)} /></label>
    <button type="button" className="query-locate-button" aria-label={`定位 ${label} 结果位置`} onClick={() => { if (position.trim() && Number.isFinite(Number(position))) onLocate?.(Number(position)); }}>定位</button>
    <small>局部轴 · 正 x 面截面内力</small>
    {error ? <span role="alert">{error}</span> : <dl>{["N", "Vy", "Vz", "T", "My", "Mz"].map((name, index) => <div key={name}><dt>{name}</dt><dd data-testid={`${label}-section-${name}`} title={forces![index].toPrecision(10)}>{forces![index].toFixed(3)} {index < 3 ? "kN" : "kN·m"}</dd></div>)}</dl>}
  </div>;
}
