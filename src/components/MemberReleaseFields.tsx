import type { MemberEndReleases } from "../domain/member-releases";

export function MemberReleaseFields({ value, onChange }: { value?: MemberEndReleases; onChange(value: MemberEndReleases): void }) {
  return <fieldset className="member-release-fields"><legend>杆端弯矩释放 · 局部轴</legend>
    {(["start", "end"] as const).map((end) => {
      const current = value?.[end];
      const code = current?.my ? current.mz ? "both" : "my" : current?.mz ? "mz" : "rigid";
      return <label className="field" key={end}><span>{end === "start" ? "起点弯矩释放" : "终点弯矩释放"}</span>
        <select aria-label={end === "start" ? "起点弯矩释放" : "终点弯矩释放"} value={code} onChange={(event) => {
          const code = event.currentTarget.value;
          onChange({ start: value?.start ?? { my: false, mz: false }, end: value?.end ?? { my: false, mz: false },
            [end]: { my: code === "my" || code === "both", mz: code === "mz" || code === "both" } });
        }}><option value="rigid">刚接</option><option value="my">释放局部 My</option><option value="mz">释放局部 Mz</option><option value="both">释放局部 My、Mz</option></select>
      </label>;
    })}
    <p className="field-help">My／Mz 随截面转角解释。节点支座使用全局自由度，单独设置；轴向、剪切与扭转保持连接。</p>
  </fieldset>;
}
