import { expect, it } from "vitest";
import { calculationIntent } from "./analysis-intent";

it("distinguishes a computation request from discussion and revokes pending work on explicit cancellation", () => {
  for (const prompt of ["建立两层空间钢刚架并计算", "请计算当前模型", "确认后自动计算", "继续计算", "build a frame and solve", "建模并进行计算", "请对当前模型进行分析", "帮我把模型算一下", "请分析当前模型", "继续分析", "给不同节点加荷载并计算", "不改变荷载，继续计算"]) expect(calculationIntent(prompt), prompt).toBe("request");
  for (const prompt of ["解释计算过程", "请说明计算结果", "计算是什么", "如何计算", "请分析计算失败的原因", "请分析计算结果", "请计算结果说明一下"]) expect(calculationIntent(prompt), prompt).toBeUndefined();
  for (const prompt of ["不需要计算，先建模", "不要计算", "暂不分析", "不计算，只补齐支座条件", "计算先取消"]) expect(calculationIntent(prompt), prompt).toBe("cancel");
});
