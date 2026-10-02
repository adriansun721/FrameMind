import { test } from "@playwright/test";
const { runT33 } = require("../scripts/t33-workflow.cjs");

for (const theme of ["dark", "light"]) {
  test(`T33 ${theme}: completes the two-storey workflow from parameter completion to verified comparison and Word/PDF`, async () => {
    test.setTimeout(240_000);
    await runT33({ theme });
  });
}
