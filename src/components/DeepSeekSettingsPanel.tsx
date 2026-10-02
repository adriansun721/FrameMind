import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PlugZap, Save, Trash2 } from "lucide-react";
import { DEEPSEEK_MODELS, type DeepSeekModel, type DeepSeekResult, type DeepSeekSettings } from "../../electron/contracts";

const modelLabels: Record<DeepSeekModel, string> = {
  "deepseek-flash": "DeepSeek-V4.1-Flash",
  "deepseek-v4-pro": "DeepSeek-V4-Pro",
};

export function DeepSeekSettingsPanel() {
  const [settings, setSettings] = useState<DeepSeekSettings | null>(null);
  const [model, setModel] = useState<DeepSeekModel>("deepseek-flash");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; success: boolean } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void window.frameMind?.getDeepSeekSettings().then((value) => {
      if (!active.current) return;
      setSettings(value); setModel(value.model);
      if (value.issue) setFeedback({ text: value.issue === "storage-error" ? "本机凭据无法读取，请重新保存或移除" : "本机安全存储不可用", success: false });
    }).catch(() => {
      if (active.current) setFeedback({ text: "无法读取连接设置", success: false });
    });
    return () => { active.current = false; };
  }, []);

  async function run(operation: () => Promise<DeepSeekResult>, clearKey: boolean) {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try {
      const result = await operation();
      if (!active.current) return;
      setSettings(result.settings); setModel(result.settings.model);
      setFeedback({ text: result.message, success: ["saved", "removed", "success"].includes(result.status) });
      if (clearKey) setApiKey("");
    } catch {
      if (active.current) setFeedback({ text: "连接操作失败，请重试", success: false });
    } finally { if (active.current) setBusy(false); }
  }
  const changed = !!apiKey || !!settings && model !== settings.model;
  return <section className="settings-deepseek" aria-label="DeepSeek 连接">
    <div className="settings-connection-heading"><h3>DeepSeek</h3><span>{settings?.configured ? "已配置本机凭据" : "未配置"}</span></div>
    <form onSubmit={(event) => {
      event.preventDefault();
      const request = { model, apiKey };
      setApiKey("");
      void run(() => window.frameMind.saveDeepSeekSettings(request), false);
    }}>
      <div className="settings-connection-fields">
        <label className="field"><span>模型</span><select aria-label="DeepSeek 模型" value={model} disabled={busy || !settings} onChange={(event) => { setModel(event.target.value as DeepSeekModel); setFeedback(null); }}>{DEEPSEEK_MODELS.map((value) => <option key={value} value={value}>{modelLabels[value]}</option>)}</select></label>
        <label className="field"><span>API Key</span><input aria-label="DeepSeek API Key" type="password" autoComplete="off" spellCheck={false} value={apiKey} disabled={busy || !settings} placeholder={settings?.configured ? "已保存；留空保留现有凭据" : "填写 API Key"} onChange={(event) => { setApiKey(event.target.value); setFeedback(null); }} /></label>
      </div>
      <div className="settings-connection-actions">
        <button className="button primary" type="submit" disabled={busy || !settings?.storageAvailable || !changed}><Save size={15} />保存连接</button>
        <button className="button ghost" type="button" disabled={busy || !settings?.configured || changed} onClick={() => void run(() => window.frameMind.testDeepSeekConnection(), true)}><PlugZap size={15} />测试连接</button>
        <button className="icon-button" type="button" aria-label="移除本机凭据" title="移除本机凭据" disabled={busy || !settings || !settings.configured && !settings.issue} onClick={() => void run(() => window.frameMind.removeDeepSeekCredential(), true)}><Trash2 size={15} /></button>
      </div>
    </form>
    <div className={`settings-connection-feedback ${feedback?.success ? "success" : ""}`} aria-live="polite" data-testid="deepseek-feedback">{busy ? <><LoaderCircle size={14} className="spin" />正在处理连接…</> : feedback?.text}</div>
  </section>;
}
