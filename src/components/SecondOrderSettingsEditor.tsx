import type { SecondOrderSettings } from "../domain/second-order";
import { SECOND_ORDER_MEANING } from "../domain/second-order";

export function SecondOrderSettingsEditor({ value, onChange }: { value: SecondOrderSettings; onChange(value: SecondOrderSettings): void }) {
  return <section aria-label="二阶求解设置"><p>{SECOND_ORDER_MEANING}</p><p>全部荷载等比例加载。只有加载平衡与响应细分均满足容差才发布结果；未收敛、失稳或预算终止明确失败。斜率上限 .05 rad，轴向应变上限 .01。</p>
    {([['loadSteps', '二阶加载步数'], ['maxIterations', '二阶每步迭代上限'], ['residualTolerance', '二阶平衡残差容差'], ['incrementTolerance', '二阶位移增量容差'], ['maxEquations', '二阶最大方程数'], ['meshTolerance', '二阶细分相对误差']] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input type="number" step="any" aria-label={label} value={value[key]} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} /></label>)}
    <label className="field"><span>二阶每杆最大单元</span><select aria-label="二阶每杆最大单元" value={value.maxDivisions} onChange={(e) => onChange({ ...value, maxDivisions: Number(e.target.value) })}>{[1, 2, 4, 8, 16].map((n) => <option key={n}>{n}</option>)}</select></label>
  </section>;
}
