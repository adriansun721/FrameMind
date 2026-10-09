import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { applyCadAiVerification, buildCadAiVerificationInput, requestCadAiVerification, type CadMaterialResource, type CadResourceDraft, type CadResourceReview, type CadManualSectionInput, type CadSectionResource } from "../workspace/cad-resources";
import { sectionMechanicalProperties, SECTION_SHAPES, SECTION_DIMENSIONS, SECTION_SHAPE_FIELDS, validateSectionGeometry, type SectionGeometry } from "../domain/section-geometry";

const fields = [{ key: "areaM2", label: "A（m²）" }, { key: "secondMomentYM4", label: "Iy（m⁴）" }, { key: "secondMomentZM4", label: "Iz（m⁴）" }, { key: "torsionalConstantM4", label: "J（m⁴）" }] as const;
const emptyManual = (): CadManualSectionInput => ({ properties: { areaM2: 0, secondMomentYM4: 0, secondMomentZM4: 0, torsionalConstantM4: 0 }, reference: "", confirmed: false, rotationDegrees: 0 });
function initialManual(section: CadSectionResource | undefined, lineId: string): CadManualSectionInput {
  const rotationDegrees = section?.memberProfiles?.find((frame) => frame.centerlineId === lineId)?.rotationDegrees ?? 0;
  return { ...emptyManual(), properties: section?.properties ?? emptyManual().properties, originalProperties: section?.properties, rotationDegrees, originalRotationDegrees: rotationDegrees };
}

export function CadResourceReviewPanel({ review, draft, inputKey, onChange }: {
  review: CadResourceReview; draft: CadResourceDraft; inputKey: string; onChange: Dispatch<SetStateAction<CadResourceDraft>>;
}) {
  const [showSummary, setShowSummary] = useState(false), [responseText, setResponseText] = useState("");
  const [busy, setBusy] = useState(false), [formulaErrors, setFormulaErrors] = useState<Record<string, string>>({});
  const currentKey = useRef(inputKey); currentKey.current = inputKey;
  const active = useRef<AbortController | null>(null);
  const verification = draft.verification?.inputKey === inputKey ? draft.verification.ai : review.ai;
  // Closing the dialog or changing any inspected input cancels the request. A
  // late response can be retained by its caller, but never marks this draft passed.
  useEffect(() => () => {
    const controller = active.current;
    if (!controller) return;
    controller.abort(); active.current = null;
    onChange((previous) => previous.verification?.inputKey === inputKey && previous.verification.ai.status === "pending"
      ? { ...previous, verification: { inputKey, ai: { ...previous.verification.ai, status: "cancelled", error: "AI 核验已取消" } } } : previous);
  }, [inputKey, onChange]);
  const updateMaterial = (patch: Partial<CadMaterialResource>) => onChange((previous) => ({ ...previous, material: { ...previous.material, ...patch }, verification: undefined }));
  const updateManual = (lineId: string, patch: Partial<CadManualSectionInput>) => onChange((previous) => {
    const section = review.sections.find((item) => item.centerlineIds?.includes(lineId));
    return { ...previous, verification: undefined, manualSections: { ...previous.manualSections, [lineId]: { ...(previous.manualSections[lineId] ?? initialManual(section, lineId)), ...patch } } };
  });
  const confirmManual = (lineId: string, confirmed: boolean) => onChange((previous) => {
    const manual = previous.manualSections[lineId] ?? emptyManual(), recordedAt = new Date().toISOString();
    const last = previous.correctionHistory.filter((item) => item.sectionId === lineId).at(-1);
    return { ...previous, verification: undefined,
      manualSections: { ...previous.manualSections, [lineId]: { ...manual, confirmed, recordedAt, recordedBy: "user" } },
      correctionHistory: [...previous.correctionHistory, { sectionId: lineId, original: last?.replacement ?? manual.originalProperties, replacement: structuredClone(manual.properties), originalRotationDegrees: last?.rotationDegrees ?? manual.originalRotationDegrees, rotationDegrees: manual.rotationDegrees, geometry: manual.geometry ? structuredClone(manual.geometry) : undefined, reference: manual.reference, confirmed, recordedAt, recordedBy: "user" }],
    };
  });
  const runOnline = async () => {
    const controller = new AbortController(); active.current = controller;
    setBusy(true);
    const capturedKey = inputKey;
    onChange((previous) => ({ ...previous, verification: { inputKey: capturedKey, ai: { status: "pending", request: buildCadAiVerificationInput(review), origin: "online" } } }));
    const result = await requestCadAiVerification(review, window.frameMind, { signal: controller.signal });
    if (active.current !== controller) { setBusy(false); return; }
    if (currentKey.current === capturedKey) onChange((previous) => previous.verification?.inputKey === capturedKey ? ({ ...previous, verification: { inputKey: capturedKey, ai: result.ai } }) : previous);
    active.current = null; setBusy(false);
  };
  return <section className="cad-resource-review" aria-label="截面材料与刚接核验">
    <h3>截面、材料与刚接假设 · {review.status === "verified" ? "资源已核验" : review.status === "blocked" ? "存在阻塞" : "待用户补齐"}</h3>
    <p className="dialog-copy">材料、截面修正与刚接均需明确确认。修改后重新检查；AI 只读核验引用程序证据。</p>
    <div className="cad-resource-grid">{review.sections.map((section) => <article className={`cad-resource-card ${section.status}`} key={section.id}>
      <strong>{section.id}</strong><span>工程杆件：{section.memberIds.join("、") || "未关联"}</span>
      {section.properties && <dl>{fields.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{section.properties?.[key]?.toPrecision(8) ?? "未计算"}</dd></div>)}</dl>}
      <small>{section.basis.method} · {section.basis.applicability} · 不确定性：{section.basis.uncertainty}</small>
      <small>参考：{section.basis.references.join("；") || "未登记独立参考"}</small>
      <small>来源实体：{section.sourceEntityIds.map((id) => `#${id}`).join(", ")}</small>
      {section.memberProfiles?.map((frame) => <small key={frame.memberId}>{frame.memberId} · 求解局部转角 {frame.rotationDegrees.toPrecision(7)}° · y [{frame.localY.join(", ")}] · z [{frame.localZ.join(", ")}]</small>)}
      {section.issues.map((issue) => <span className="cad-resource-issue" key={issue}>{issue}</span>)}
      {(section.centerlineIds ?? []).map((lineId) => {
        const manual = draft.manualSections[lineId] ?? initialManual(section, lineId);
        return <details key={lineId} open={section.status === "blocked" || Boolean(draft.manualSections[lineId])}>
          <summary>人工补齐或修正 · {lineId}</summary>
          <fieldset className="cad-manual-section"><legend>全部参数、转角和独立参考由用户核对</legend>
            {fields.map(({ key, label }) => <label key={key}>{label}<input aria-label={`${lineId} ${label}`} type="number" step="any" value={manual.properties[key] || ""} onChange={(event) => updateManual(lineId, { confirmed: false, geometry: undefined, properties: { ...manual.properties, [key]: Number(event.target.value) } })} /></label>)}
            <label>按实测尺寸计算<select aria-label={`${lineId} 截面形状`} value={manual.geometry?.shape ?? ""} onChange={(event) => { const shape = event.target.value as SectionGeometry["shape"]; const geometry = shape ? Object.fromEntries([["shape", shape], ...SECTION_SHAPE_FIELDS[shape].map((key) => [key, 0])]) as SectionGeometry : undefined; updateManual(lineId, { geometry, confirmed: false }); }}><option value="">人工属性</option>{Object.entries(SECTION_SHAPES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
            {manual.geometry && SECTION_SHAPE_FIELDS[manual.geometry.shape].map((key) => <label key={key}>{SECTION_DIMENSIONS[key]}（m）<input aria-label={`${lineId} ${key}`} type="number" step="any" value={(manual.geometry as unknown as Record<string, number>)[key] || ""} onChange={(event) => updateManual(lineId, { geometry: { ...manual.geometry!, [key]: Number(event.target.value) } as SectionGeometry, confirmed: false })} /></label>)}
            {manual.geometry && <button type="button" className="button ghost" onClick={() => { try { const geometry = validateSectionGeometry(manual.geometry); updateManual(lineId, { geometry, properties: sectionMechanicalProperties(geometry), confirmed: false }); setFormulaErrors((previous) => ({ ...previous, [lineId]: "" })); } catch (cause) { setFormulaErrors((previous) => ({ ...previous, [lineId]: cause instanceof Error ? cause.message : "截面计算失败" })); } }}>从实测尺寸计算 A/I/J</button>}
            {formulaErrors[lineId] && <p role="alert">{formulaErrors[lineId]}</p>}
            <label>求解局部转角（°）<input aria-label={`${lineId} 求解局部转角`} type="number" step="any" value={manual.rotationDegrees ?? 0} onChange={(event) => updateManual(lineId, { rotationDegrees: Number(event.target.value), confirmed: false })} /></label>
            <label>独立参考<input aria-label={`${lineId} 独立参考`} value={manual.reference} onChange={(event) => updateManual(lineId, { reference: event.target.value, confirmed: false })} /></label>
            <label className="cad-joint-confirm"><input type="checkbox" checked={manual.confirmed} onChange={(event) => confirmManual(lineId, event.target.checked)} />确认 {lineId} 人工参数、局部轴与参考</label>
          </fieldset>
        </details>;
      })}
    </article>)}</div>
    <fieldset className="cad-resource-controls"><legend>材料（缺失时必须由用户确认）</legend>
      <label>名称<input aria-label="导入材料名称" value={draft.material.name ?? ""} onChange={(event) => updateMaterial({ name: event.target.value, confirmed: false })} /></label>
      {([{ key: "elasticModulusGPa", label: "导入材料弹性模量", text: "E（GPa）" }, { key: "poissonRatio", label: "导入材料泊松比", text: "ν" }, { key: "densityKgM3", label: "导入材料密度", text: "ρ（kg/m³）" }] as const).map(({ key, label, text }) => <label key={key}>{text}<input aria-label={label} type="number" step="any" value={draft.material[key] ?? ""} onChange={(event) => updateMaterial({ [key]: event.target.value === "" ? undefined : Number(event.target.value), confirmed: false })} /></label>)}
      <label className="cad-joint-confirm"><input type="checkbox" checked={Boolean(draft.material.confirmed)} onChange={(event) => updateMaterial({ confirmed: event.target.checked })} />确认材料来源与参数</label>
    </fieldset>
    <label className="cad-joint-confirm"><input type="checkbox" checked={draft.rigidJointsConfirmed} onChange={(event) => onChange((previous) => ({ ...previous, rigidJointsConfirmed: event.target.checked, verification: undefined }))} />我明确确认已审查的工程连接按刚接建模（几何接触不自动代表刚接）</label>
    <div className="cad-resource-checks"><strong>确定性检查</strong>{review.checks.map((check) => <div key={check.code} className={`cad-resource-check ${check.status}`}>
      <span>{check.status === "passed" ? "通过" : check.status === "failed" ? "阻塞" : "待确认"} · {check.code}</span><small>{check.message}</small>
      {check.severity === "warning" && <label><input type="checkbox" aria-label={`接受警告 ${check.code}`} checked={draft.acceptedWarningCodes.includes(check.code)} onChange={(event) => onChange((previous) => ({ ...previous, verification: undefined, acceptedWarningCodes: event.target.checked ? [...previous.acceptedWarningCodes, check.code] : previous.acceptedWarningCodes.filter((id) => id !== check.code) }))} />接受此警告</label>}
    </div>)}</div>
    <p>截面修正记录：{draft.correctionHistory.length} 条（关闭后重开保留；导出 JSON 保存完整记录）</p>
    <button className="button ghost" type="button" onClick={() => setShowSummary((value) => !value)}>{showSummary ? "隐藏" : "生成"} AI 只读核验摘要</button>
    {showSummary && <>
      <pre className="cad-ai-evidence">{JSON.stringify(buildCadAiVerificationInput(review), null, 2)}</pre>
      <button className="button ghost" disabled={busy} onClick={() => void runOnline()}>{busy ? "在线核验中…" : "在线 AI 只读核验"}</button>
      {busy && <button className="button ghost" onClick={() => active.current?.abort()}>取消核验</button>}
      <label className="cad-ai-response">离线粘贴响应（只用于复核，不作为在线通过证据）<textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} rows={4} /></label>
      <button className="button ghost" disabled={busy} onClick={() => { let response: unknown; try { response = JSON.parse(responseText); } catch { response = null; } const ai = applyCadAiVerification(review, response).ai; ai.origin = "manual"; onChange((previous) => ({ ...previous, verification: { inputKey, ai } })); }}>校验粘贴响应</button>
    </>}
    <p role="status">AI 状态：{verification.status} · {verification.origin ?? "尚未请求"}{verification.error ? ` · ${verification.error}` : ""}</p>
  </section>;
}
