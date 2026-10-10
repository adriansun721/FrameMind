import { rolldown } from "rolldown";
const bundle = await rolldown({ input: "scripts/reverse-native-domain.ts", platform: "node" });
try { await bundle.write({ file: "dist-electron/reverse-native-domain.cjs", format: "cjs" }); }
finally { await bundle.close(); }
