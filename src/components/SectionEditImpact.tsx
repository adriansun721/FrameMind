import type { FrameProject, FrameSection, FrameNode, FrameMember } from "../domain/project";
import type { ProjectEditReceipt } from "../domain/project-operations";
import { calculateMemberGeometry } from "../domain/member-geometry";
import { SectionGeometryPreview } from "./SectionGeometryPreview";
import { useUnits } from "./UnitPresentation";

export function SectionEditImpact({ project, receipt }: { project: FrameProject; receipt: ProjectEditReceipt }) {
  const u = useUnits();
  const sections = receipt.changes.filter((c) => c.kind === "section" && c.after).map((c) => c.after as FrameSection);
  // A mixed draft can create, move or delete endpoints along with section edits.
  // Resolve the final receipt before calculating the axes shown for confirmation.
  const finalObject = (kind: "node" | "member", id: string) => {
    const change = receipt.changes.find((c) => c.kind === kind && c.id === id);
    return change ? change.after : (kind === "node" ? project.nodes : project.members).find((item) => item.id === id);
  };
  const vector = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => n.toPrecision(5)).join(", ");
  return <section aria-label="截面影响预览">
    {sections.map((s) => <div key={s.id}><strong>{s.label} · {s.name}</strong><SectionGeometryPreview geometry={s.geometry} />
      <dl>{([ ["面积 A", s.areaM2, "m²"], ["Iy", s.secondMomentYM4, "m⁴"], ["Iz", s.secondMomentZM4, "m⁴"], ["J", s.torsionalConstantM4, "m⁴"] ] as const).map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{u.quantity(value, unit)}</dd></div>)}</dl>
    </div>)}
    <p>影响杆件 {receipt.affectedMemberIds.length} 根：{receipt.affectedMemberIds.join("、") || "无引用"}。共享编辑影响全部引用；面积改变同时影响已启用的自重。相关结果需要重算。</p>
    {receipt.affectedMemberIds.map((id) => {
      const member = finalObject("member", id) as FrameMember | undefined;
      if (!member) return null;
      const start = finalObject("node", member.startNodeId) as FrameNode | undefined;
      const end = finalObject("node", member.endNodeId) as FrameNode | undefined;
      if (!start || !end) return <p key={id}>{id} · 草案端点需确认后读回</p>;
      const axes = calculateMemberGeometry(start.position, end.position, member.rotationDegrees);
      const section = sections.find((s) => s.id === member.sectionId) ?? project.sections.find((s) => s.id === member.sectionId);
      return <details key={id}><summary>{member.label} · {id} · {section?.name} · {u.quantity(member.rotationDegrees, "°")}</summary>
        <SectionGeometryPreview geometry={section?.geometry} rotationDegrees={member.rotationDegrees} />
        <p>x = ({vector(axes.localX)}) · y = ({vector(axes.localY)}) · z = ({vector(axes.localZ)}) · 参考轴 {axes.referenceAxis}</p>
      </details>;
    })}
  </section>;
}
