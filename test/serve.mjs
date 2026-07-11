import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const root = new URL("./fixtures/", import.meta.url).pathname;
const types = { ".json": "application/json", ".ndjson": "text/plain" };
createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(req.url.slice(1))));
    res.setHeader("content-type", types[extname(req.url)] ?? "text/plain");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(8731, () => console.log("fixtures on :8731"));
