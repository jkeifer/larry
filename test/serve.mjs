import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const root = new URL("./fixtures/", import.meta.url).pathname;
const types = { ".json": "application/json", ".ndjson": "text/plain" };
createServer(async (req, res) => {
  // Generated on the fly so no multi-MB fixture is committed to the repo.
  if (req.url === "/big-array.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ big: Array.from({ length: 250000 }, (_, i) => i) }));
    return;
  }
  try {
    const body = await readFile(join(root, decodeURIComponent(req.url.slice(1))));
    res.setHeader("content-type", types[extname(req.url)] ?? "text/plain");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(8731, () => console.log("fixtures on :8731"));
