/** Recognize explicit local-computation requests, rather than mentions of calculation. */
export function calculationIntent(prompt: string): "request" | "cancel" | undefined {
  if (/(?:不要|不用|无需|取消|不必|暂不|先不|不需要|不|别)(?:再|继续|进行|现在|先|自动|本地|后续){0,3}(?:计算|求解|分析|重算|算一下)|(?:计算|求解|分析|重算)(?:先|暂时|现在)?(?:取消|暂停|停止)|(?:do not|don't|cancel).{0,15}(?:calculat|solv|analys)/i.test(prompt)) return "cancel";
  const action = /(?:并|然后|再|确认后|继续|请|帮我|执行|运行|开始|需要|要求|直接|现在|重新)(?:自动|本地|重新|继续|进行|做一次)?(?:计算|求解|重算|算一下|算一遍|运行分析|执行分析)(?!结果|是什么|原理|过程|失败)|^(?:计算|求解|重算|运行分析)(?!结果|是什么|原理|过程|失败)/;
  const modelAction = /(?:请|帮我|执行|开始|现在|继续|对).{0,8}(?:模型|结构|刚架|框架)(?:进行|运行|做一次|做)?(?:本地|静力|线弹性)?(?:分析|计算|求解|算一下|算一遍)/;
  const analyzeModel = /(?:请|帮我|继续|运行|执行)(?:进行|本地)?分析(?:当前|这个|该|已确认)?(?:模型|结构|刚架|框架)|^(?:请)?继续分析[。！.!\s]*$/;
  if (action.test(prompt.trim()) || modelAction.test(prompt) || analyzeModel.test(prompt.trim())
    || /(?:^|\b(?:and|then|please|now|continue)\s+)(?:calculate|solve|run analysis)\b/i.test(prompt.trim())) return "request";
  return undefined;
}
