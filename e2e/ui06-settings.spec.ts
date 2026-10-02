import { expect, test } from "@playwright/test";
import { launchFrameMind } from "./electron-app";

test("UI06 opens settings in a centered independent panel", async () => {
  const { app, page } = await launchFrameMind();

  const activityBar = page.getByRole("navigation", { name: "侧边导航" });
  const settingsButton = activityBar.getByRole("button", { name: "设置" });
  await expect(settingsButton).toBeVisible();

  const activityBarBox = await activityBar.boundingBox();
  const statusbarBox = await page.getByRole("status").boundingBox();
  const settingsButtonBox = await settingsButton.boundingBox();
  expect(activityBarBox).not.toBeNull();
  expect(statusbarBox).not.toBeNull();
  expect(settingsButtonBox).not.toBeNull();
  expect(settingsButtonBox!.y + settingsButtonBox!.height).toBeLessThanOrEqual(statusbarBox!.y);

  await settingsButton.click();

  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(settingsDialog.getByRole("region", { name: "常规设置" })).toBeVisible();

  const dialogBox = await settingsDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x + dialogBox!.width / 2).toBeCloseTo((await page.evaluate(() => window.innerWidth)) / 2, 0);
  expect(dialogBox!.y + dialogBox!.height / 2).toBeCloseTo((await page.evaluate(() => window.innerHeight)) / 2, 0);

  await settingsDialog.getByRole("button", { name: "关闭" }).click();
  await expect(settingsDialog).toBeHidden();

  await app.close();
});
