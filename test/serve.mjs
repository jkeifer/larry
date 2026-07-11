import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const root = new URL("./fixtures/", import.meta.url).pathname;
const types = { ".json": "application/json", ".ndjson": "text/plain", ".html": "text/html" };
createServer(async (req, res) => {
  // Generated on the fly so no multi-MB fixture is committed to the repo.
  if (req.url === "/big-array.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ big: Array.from({ length: 250000 }, (_, i) => i) }));
    return;
  }
  // NDJSON served as application/json — the realistic trigger for larry's
  // NDJSON fallback, since the activation gate only fires for that
  // content-type (whereas /sample.ndjson above is served as text/plain and
  // won't activate larry until the forced-activation fallback exists).
  if (req.url === "/sample-ndjson-as-json") {
    res.setHeader("content-type", "application/json");
    res.end(await readFile(join(root, "sample.ndjson")));
    return;
  }
  if (req.url === "/malformed-as-json") {
    res.setHeader("content-type", "application/json");
    res.end('{"a": 1, "b": ');
    return;
  }
  // A JSON body served with the "wrong" content-type (text/plain) — the
  // realistic trigger for Task 11's forced-activation fallback, since the
  // activation gate's content-type check alone would never let larry run on
  // this page.
  if (req.url === "/catalog-as-text-plain") {
    res.setHeader("content-type", "text/plain");
    res.end(await readFile(join(root, "catalog.json")));
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
