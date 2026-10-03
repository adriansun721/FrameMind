import { expect, type Locator, type Page } from "@playwright/test";

export const proposalDrawer = (page: Page) => page.locator(".proposal-drawer");
export async function closeProposalDrawer(page: Page) {
  const drawer = proposalDrawer(page);
  if (await drawer.count()) await drawer.getByRole("button", { name: /^(关闭详情|关闭编辑侧栏)$/ }).click();
}
export async function openProposalView(page: Page, card: Locator, view: "edit" | "details" | "actions") {
  const drawer = proposalDrawer(page);
  const suffix = view === "details" ? "详情" : "编辑";
  if (!await drawer.count() || !(await drawer.getAttribute("aria-label"))?.endsWith(suffix)) {
    await closeProposalDrawer(page);
    await card.getByRole("button", { name: view === "details" ? "详情" : "编辑", exact: true }).click();
  }
  await expect(drawer).toBeVisible();
  // Regression cases inspect each field; open the optional editor groups explicitly.
  if (view === "edit") for (const group of await drawer.locator(".proposal-editor-group").all()) {
    if (!await group.evaluate((element) => element.hasAttribute("open"))) await group.locator(":scope > summary").click();
  }
  if (view === "actions" && !await drawer.locator(".proposal-more-actions").evaluate((element) => element.hasAttribute("open"))) await drawer.getByText("更多操作", { exact: true }).click();
}
