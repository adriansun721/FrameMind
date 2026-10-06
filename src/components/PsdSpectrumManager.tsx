import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { FrameProject } from "../domain/project";
import { applyProjectEdits } from "../domain/project-operations";
import { unitPresentation } from "../domain/units";
import { bandLimitedWhiteNoise, canonicalPsdConvention, convertPsd, importPsdCsv, integratePsd, normalizePsd, psdDensityUnit, psdSpectrumInput, validatePsdInput, type PsdConvention, type PsdInput } from "../domain/psd";

type Draft = Omit<PsdInput, "band" | "points"> & { band: [string, string]; points: { frequency: string; density: string }[] };
const draftOf = (input: PsdInput): Draft => ({ ...input, band: [String(input.band[0]), String(input.band[1])], points: input.points.map((p) => ({ frequency: String(p.frequency), density: String(p.density) })) });
function numeric(text: string): number {
  if (!text.trim()) throw new Error("PSD 数值不能为空");
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error("PSD 数值必须有限");
  return value;
}
const inputOf = (draft: Draft): PsdInput => validatePsdInput({ ...draft, band: draft.band.map(numeric), points: draft.points.map((p) => ({ frequency: numeric(p.frequency), density: numeric(p.density) })) });
const conventionOf = (input: Draft): PsdConvention => ({ quantity: input.quantity, excitationUnit: input.excitationUnit, frequencyUnit: input.frequencyUnit, densityUnit: input.densityUnit, sidedness: input.sidedness });

function PsdPreview({ input }: { input: PsdInput }) {
  const maxDensity = Math.max(...input.points.map((p) => p.density));
  const x = (frequency: number) => 55 + ((frequency - input.band[0]) / (input.band[1] - input.band[0])) * 500;
  const y = (density: number) => 160 - (maxDensity ? density / maxDensity : 0) * 130;
  const path = input.points.map((p, i) => `${i ? "L" : "M"} ${x(p.frequency)} ${y(p.density)}`).join(" ");
  const variance = integratePsd(input), canonicalUnit = canonicalPsdConvention(input.quantity).excitationUnit;
  return <section className="psd-preview" aria-label="输入 PSD 预览">
    <h3>输入谱预览</h3>
    <svg viewBox="0 0 600 210" role="img" aria-label={`输入 PSD 曲线，${input.band[0]} 至 ${input.band[1]} ${input.frequencyUnit}`}>
      <path d="M55 20V160H560" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--accent, #3182ce)" strokeWidth="2" />
      <text x="55" y="180">{Number(input.band[0].toPrecision(6))}</text><text x="540" y="180" textAnchor="end">{Number(input.band[1].toPrecision(6))}</text>
      <text x="300" y="200" textAnchor="middle">频率（{input.frequencyUnit}）</text>
      <text x="55" y="14">PSD（{input.densityUnit}） · 上限 {Number(maxDensity.toPrecision(6))}</text>
    </svg>
    <p data-testid="psd-variance">输入均方值：{Number(variance.toPrecision(10))} {canonicalUnit.includes("/") ? `(${canonicalUnit})` : canonicalUnit}² · 输入激励 RMS：{Number(Math.sqrt(variance).toPrecision(10))} {canonicalUnit}</p>
    <p>分段线性插值 · 梯形积分 · 频段外为零。此处是输入激励统计量；结构响应尚未计算。</p>
  </section>;
}

export function PsdSpectrumManager({ project, onChange, onClose }: { project: FrameProject; onChange(project: FrameProject): void; onClose(): void }) {
  const units = unitPresentation(project.displayUnitPreset);
  // New resources have an editable name; template validation happens when applied.
  const blank = (): Draft => ({ name: "带限白噪声", ...canonicalPsdConvention("force"), excitationUnit: units.unit("kN"), densityUnit: psdDensityUnit(units.unit("kN"), "Hz"), band: ["10", "20"], points: [{ frequency: "10", density: "2" }, { frequency: "20", density: "2" }] });
  const [draft, setDraft] = useState<Draft>(blank);
  const [editingId, setEditingId] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [level, setLevel] = useState("2");
  const [targetUnit, setTargetUnit] = useState<string>(units.unit("kN"));
  const [targetFrequency, setTargetFrequency] = useState<PsdConvention["frequencyUnit"]>("Hz");
  const [targetSide, setTargetSide] = useState<PsdConvention["sidedness"]>("one-sided");
  const [csv, setCsv] = useState("");
  const [csvUnit, setCsvUnit] = useState("");
  const [csvFrequency, setCsvFrequency] = useState("");
  const [csvDensity, setCsvDensity] = useState("");
  const [csvSide, setCsvSide] = useState("");
  const [csvBand, setCsvBand] = useState<[string, string]>(["", ""]);
  const fileGeneration = useRef(0);
  const unitOptions = draft.quantity === "force" ? ["kN", "N"] : ["m/s²", "mm/s²"];
  const densityOptions = unitOptions.flatMap((u) => (["Hz", "rad/s"] as const).map((f) => psdDensityUnit(u, f)));
  let preview: PsdInput | undefined, previewError: string | undefined;
  try { preview = inputOf(draft); integratePsd(preview); } catch (cause) { preview = undefined; previewError = cause instanceof Error ? cause.message : "输入谱无效"; }
  const attempt = (action: () => void) => { try { action(); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : "PSD 操作失败"); } };
  const choose = (id: string) => {
    fileGeneration.current++;
    const spectrum = project.psdSpectra.find((s) => s.id === id);
    const next = spectrum ? draftOf(psdSpectrumInput(spectrum)) : blank();
    setEditingId(id); setDraft(next); setTargetUnit(next.excitationUnit); setTargetFrequency(next.frequencyUnit); setTargetSide(next.sidedness); setPage(0); setError(undefined); setNotice(undefined); setCsv(""); setCsvUnit(""); setCsvFrequency(""); setCsvDensity(""); setCsvSide(""); setCsvBand(["", ""]);
  };
  return <div className="dialog-backdrop"><section className="node-dialog wide-dialog psd-dialog" role="dialog" aria-modal="true" aria-labelledby="psd-title">
    <header><h2 id="psd-title">随机输入谱管理</h2><button className="icon-button" aria-label="关闭随机输入谱管理" onClick={onClose}><X size={17} /></button></header>
    <div className="dialog-form">
      <p>准备可复用输入 PSD。保存时统一为单边 Hz；频段外为零。</p>
      <div className="load-case-list" aria-label="已保存输入谱">{project.psdSpectra.map((s) => <button className={`load-case-row ${s.id === editingId ? "active" : ""}`} key={s.id} onClick={() => choose(s.id)}><span>{s.id} · {s.name}</span><small>{s.band.join("–")} Hz · {s.densityUnit}</small></button>)}</div>
      <button className="button ghost" onClick={() => choose("")}>新建输入谱</button>
      <label className="field"><span>输入谱名称</span><input aria-label="输入谱名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="field"><span>激励物理量</span><select aria-label="激励物理量" value={draft.quantity} onChange={(e) => {
        const quantity = e.target.value as PsdInput["quantity"], convention = canonicalPsdConvention(quantity);
        setDraft({ ...draft, ...convention }); setTargetUnit(convention.excitationUnit); setTargetFrequency("Hz"); setTargetSide("one-sided"); setCsvUnit(""); setCsvDensity(""); setNotice("已按新物理量重新定义输入数据，请核对密度数值。");
      }}><option value="force">随机力</option><option value="acceleration">平动加速度</option></select></label>
      <p>当前表格：{draft.excitationUnit} · {draft.frequencyUnit} · {draft.densityUnit} · {draft.sidedness === "one-sided" ? "单边谱" : "双边偶谱正频半轴（完整面积为正半轴两倍）"}</p>
      <div className="psd-fields">{([0, 1] as const).map((index) => <label className="field" key={index}><span>有效频段{index ? "上限" : "下限"}（{draft.frequencyUnit}）</span><input aria-label={`有效频段${index ? "上限" : "下限"}`} type="number" step="any" value={draft.band[index]} onChange={(e) => { const band = [...draft.band] as [string, string]; band[index] = e.target.value; setDraft({ ...draft, band }); }} /></label>)}</div>
      <div className="load-case-table-scroll"><table aria-label="PSD 点表"><thead><tr><th>点</th><th>频率（{draft.frequencyUnit}）</th><th>密度（{draft.densityUnit}）</th><th /></tr></thead><tbody>{draft.points.slice(page * 50, page * 50 + 50).map((point, i) => {
        const index = page * 50 + i;
        return <tr key={index}><td>{index + 1}</td>{(["frequency", "density"] as const).map((key) => <td key={key}><input aria-label={`点 ${index + 1} ${key === "frequency" ? "频率" : "密度"}`} type="number" step="any" value={point[key]} onChange={(e) => setDraft({ ...draft, points: draft.points.map((p, n) => n === index ? { ...p, [key]: e.target.value } : p) })} /></td>)}<td><button className="button ghost" aria-label={`删除点 ${index + 1}`} onClick={() => { setDraft({ ...draft, points: draft.points.filter((_, n) => n !== index) }); setPage(0); }}>删除</button></td></tr>;
      })}</tbody></table></div>
      <div className="load-case-actions"><button className="button ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{draft.points.length} 点 · 第 {page + 1} 页</span><button className="button ghost" disabled={(page + 1) * 50 >= draft.points.length} onClick={() => setPage(page + 1)}>下一页</button><button className="button ghost" disabled={draft.points.length >= 10000} onClick={() => { setPage(Math.floor(draft.points.length / 50)); setDraft({ ...draft, points: [...draft.points, { frequency: "", density: "" }] }); }}>添加 PSD 点</button></div>
      <details><summary>带限白噪声模板</summary><label className="field"><span>模板谱密度（{draft.densityUnit}）</span><input aria-label="模板谱密度" type="number" step="any" value={level} onChange={(e) => setLevel(e.target.value)} /></label><button className="button ghost" onClick={() => attempt(() => { setDraft(draftOf(bandLimitedWhiteNoise(draft.name, conventionOf(draft), draft.band.map(numeric) as [number, number], numeric(level)))); setPage(0); setNotice("模板已载入表格，请保存输入谱。"); })}>应用带限白噪声模板</button></details>
      <details><summary>转换单位与谱约定</summary><p>转换同时修改频率轴和密度，保持规范单位的物理谱面积。</p>
        <label className="field"><span>目标激励量单位</span><select aria-label="目标激励量单位" value={targetUnit} onChange={(e) => setTargetUnit(e.target.value)}>{unitOptions.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="field"><span>目标频率单位</span><select aria-label="目标频率单位" value={targetFrequency} onChange={(e) => setTargetFrequency(e.target.value as PsdConvention["frequencyUnit"])}><option>Hz</option><option>rad/s</option></select></label>
        <label className="field"><span>目标谱约定</span><select aria-label="目标谱约定" value={targetSide} onChange={(e) => setTargetSide(e.target.value as PsdConvention["sidedness"])}><option value="one-sided">单边谱</option><option value="two-sided-even-positive">双边偶谱正频半轴</option></select></label>
        <button className="button ghost" onClick={() => attempt(() => { const converted = convertPsd(inputOf(draft), { quantity: draft.quantity, excitationUnit: targetUnit, frequencyUnit: targetFrequency, densityUnit: psdDensityUnit(targetUnit, targetFrequency), sidedness: targetSide }); setDraft(draftOf(converted)); setNotice("已转换频率轴与谱密度，物理谱面积核查通过。"); })}>转换当前谱</button>
      </details>
      <details><summary>导入 PSD CSV</summary><p>UTF-8，两列 frequency,density。先明确全部单位、谱约定和有效频段；导入不自动排序或补点。</p>
        <label className="field"><span>选择 CSV 文件</span><input aria-label="选择 PSD CSV 文件" type="file" accept=".csv,text/csv" onChange={(e) => {
          const file = e.target.files?.[0], generation = ++fileGeneration.current;
          if (!file) return;
          if (file.size > 2000000) { setError("PSD CSV 超出 2 MB 预算"); return; }
          void file.text().then((text) => { if (generation === fileGeneration.current) { setCsv(text); setError(undefined); } }).catch(() => { if (generation === fileGeneration.current) setError("读取 PSD CSV 失败"); });
        }} /></label>
        <label className="field"><span>CSV 内容</span><textarea aria-label="PSD CSV 内容" rows={5} value={csv} onChange={(e) => { fileGeneration.current++; setCsv(e.target.value); }} placeholder={'frequency,density\n10,2\n20,2'} /></label>
        {([['CSV 激励量单位', csvUnit, setCsvUnit, unitOptions], ['CSV 频率单位', csvFrequency, setCsvFrequency, ['Hz', 'rad/s']], ['CSV 谱密度单位', csvDensity, setCsvDensity, densityOptions], ['CSV 谱约定', csvSide, setCsvSide, ['one-sided', 'two-sided-even-positive']]] as const).map(([label, value, setValue, choices]) => <label className="field" key={label}><span>{label}</span><select aria-label={label} value={value} onChange={(e) => setValue(e.target.value)}><option value="">请选择，禁止猜测</option>{choices.map((v) => <option key={v} value={v}>{v === "one-sided" ? "单边谱" : v === "two-sided-even-positive" ? "双边偶谱正频半轴" : v}</option>)}</select></label>)}
        <div className="psd-fields">{([0, 1] as const).map((i) => <label className="field" key={i}><span>CSV 频段{i ? "上限" : "下限"}</span><input aria-label={`CSV 频段${i ? "上限" : "下限"}`} type="number" step="any" value={csvBand[i]} onChange={(e) => { const band = [...csvBand] as [string, string]; band[i] = e.target.value; setCsvBand(band); }} /></label>)}</div>
        <button className="button ghost" onClick={() => attempt(() => {
          const imported = importPsdCsv(csv, { name: draft.name, quantity: draft.quantity, excitationUnit: csvUnit, frequencyUnit: csvFrequency as PsdConvention["frequencyUnit"], densityUnit: csvDensity, sidedness: csvSide as PsdConvention["sidedness"], band: csvBand.map(numeric) as [number, number] });
          setDraft(draftOf(imported)); setPage(0); setTargetUnit(imported.excitationUnit); setTargetFrequency(imported.frequencyUnit); setTargetSide(imported.sidedness); setNotice("CSV 已验证并载入表格，请核对预览并保存输入谱。");
        })}>验证并导入 CSV</button>
      </details>
      {preview ? <PsdPreview input={preview} /> : <p className="form-error" aria-live="polite">预览不可用：{previewError}</p>}
      {notice && <p role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="load-case-actions"><button className="button primary" disabled={!preview} onClick={() => attempt(() => {
        const properties = inputOf(draft), outcome = applyProjectEdits(project, [editingId ? { type: "update_psd_spectrum", id: editingId, properties } : { type: "create_psd_spectrum", properties }]);
        onChange(outcome.project); const id = editingId || outcome.project.psdSpectra.at(-1)!.id; setEditingId(id); setDraft(draftOf(normalizePsd(properties))); setNotice(`已保存 ${id}，采用单边 Hz 规范单位。`);
      })}>保存输入谱</button><button className="button ghost" disabled={!editingId} onClick={() => attempt(() => { onChange(applyProjectEdits(project, [{ type: "delete_psd_spectrum", id: editingId }]).project); choose(""); })}>删除输入谱</button></div>
    </div>
  </section></div>;
}
