import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const version = fs.readFileSync(path.join(root, "src/lib/version.js"), "utf8");
const engine = fs.readFileSync(path.join(root, "src/lib/engine.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/ui.js"), "utf8");

const packed = html
  .replace('<link rel="stylesheet" href="src/styles.css">', "<style>\n" + css + "\n</style>")
  .replace(
    /<script src="src\/lib\/version.js"><\/script>\s*<script src="src\/lib\/engine.js"><\/script>\s*<script src="src\/ui.js"><\/script>/,
    "<script>\n" + version + "\n" + engine + "\n" + ui + "\n</script>"
  );

const out = path.join(root, "rPDU Power v1.html");
fs.writeFileSync(out, packed);
if (packed.includes('src="src/') || packed.includes("src/styles.css")) {
  throw new Error("Pack left external file references in the laptop copy.");
}
console.log("Wrote " + out);
