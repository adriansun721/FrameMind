import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

test("T06 keeps the workbench interactive while an analysis task is pending", async () => {
  const { app, page } = await launchFrameMind();
  try {
    await page.addInitScript(() => {
      class PendingWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage(): void {}
        terminate(): void {}
      }
      Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: PendingWorker });
    });
    await page.reload();

    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("button", { name: "取消计算" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("分析任务已启动");

    const canvas = page.locator(".viewport canvas");
    const beforeCamera = await page.getByLabel("三维模型视图").getAttribute("data-camera-state");
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2 + 50, bounds!.y + bounds!.height / 2 - 20, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByLabel("三维模型视图")).not.toHaveAttribute("data-camera-state", beforeCamera!);

    await page.getByRole("button", { name: "创建节点" }).click();
    const dialog = page.getByRole("dialog", { name: "创建空间节点" });
    await dialog.getByLabel("X 坐标").fill("1");
    await dialog.getByRole("button", { name: "添加到模型" }).click();
    await expect(page.getByRole("region", { name: "项目树" }).getByText("N1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消计算" }).click();
    await expect(page.getByRole("status")).toContainText("已创建 N1");
    await expect(page.getByRole("button", { name: "查看分析结果" })).toBeDisabled();

    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByRole("button", { name: "取消计算" })).toBeVisible();
    await page.getByRole("button", { name: "取消计算" }).click();
    await expect(page.getByRole("status")).toContainText("分析已取消");
  } finally {
    await app.close();
  }
});
