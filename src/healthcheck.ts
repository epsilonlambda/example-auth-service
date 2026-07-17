// Docker HEALTHCHECK probe; the slim base image ships no curl/wget.
const port = Number(process.env.PORT ?? 3000);

try {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
