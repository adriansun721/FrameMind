import type { Page } from "@playwright/test";

export async function createNode(page: Page, coordinates: [string, string, string]) {
  await page.getByRole("button", { name: "创建节点" }).click();
  const dialog = page.getByRole("dialog", { name: "创建空间节点" });
  for (const [label, value] of [["X 坐标", coordinates[0]], ["Y 坐标", coordinates[1]], ["Z 坐标", coordinates[2]]] as const) {
    await dialog.getByLabel(label).fill(value);
  }
  await dialog.getByRole("button", { name: "添加到模型" }).click();
}
