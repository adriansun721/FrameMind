const { runT33 } = require("./t33-workflow.cjs");

async function verify() {
  for (const theme of ["dark", "light"]) {
    console.log(`T33 real DeepSeek complete workflow: ${theme}`);
    const report = await runT33({ theme, online: true });
    console.log(JSON.stringify({ status: "passed", theme, model: report.model, pdfPages: report.pdfPages, ...report.verified }));
  }
}
verify().catch((error) => { console.error(JSON.stringify({ status: "failed", errorType: error.name, errorCode: error.code })); process.exitCode = 1; });
