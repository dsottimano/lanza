// Zero-dependency static server for the wiki. No npm packages — just Node stdlib.
// Usage: npm run dev   (override port with PORT=3000 npm run dev)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "wiki");
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
	// Strip query string, default to index.html, block path traversal.
	let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	if (pathname.endsWith("/")) pathname += "index.html";
	const filePath = normalize(join(ROOT, pathname));
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403).end("Forbidden");
		return;
	}
	try {
		const body = await readFile(filePath);
		res.writeHead(200, { "content-type": TYPES[extname(filePath)] ?? "application/octet-stream" });
		res.end(body);
	} catch {
		res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
		res.end('<h1>404</h1><p><a href="/">Back to the wiki home</a></p>');
	}
});

server.listen(PORT, () => {
	console.log(`\n  EmDash wiki running at  http://localhost:${PORT}/\n  Press Ctrl-C to stop.\n`);
});
