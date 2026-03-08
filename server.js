import express from 'express';
import { YtDlp } from 'ytdlp-nodejs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const ytdlp = new YtDlp();

app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/info?url=... ─────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  try {
    const info = await ytdlp.getInfoAsync(url);
    res.json({
      title:       info.title,
      thumbnail:   info.thumbnail,
      duration:    info.duration,
      uploader:    info.uploader,
      view_count:  info.view_count,
      upload_date: info.upload_date,
      description: info.description?.slice(0, 280) ?? '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/formats?url=... ───────────────────────────────────────────────
app.get('/api/formats', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  try {
    const result = await ytdlp.getFormatsAsync(url);
    const streamable = (result.formats ?? []).filter(
      (f) => f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none'
    );
    res.json(streamable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /stream?url=...&quality=...&type=... ──────────────────────────────
// Pipes ytdlp PassThrough directly to HTTP response – no disk I/O.
app.get('/stream', async (req, res) => {
  const { url, quality = 'highest', type = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });

  console.log(`[stream] ${new Date().toISOString()} quality=${quality} url=${url}`);

  try {
    res.setHeader('Content-Type', `video/${type}`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Vercel edge buffering

    const builder = ytdlp
      .stream(url)
      .filter('audioandvideo')
      .quality(quality)
      .type(type)
      .on('start',    ()    => console.log('[stream] started'))
      .on('progress', (p)   => process.stdout.write(`\r[stream] ${p.percentage_str}  ${p.speed_str}   `))
      .on('end',      ()    => console.log('\n[stream] done'))
      .on('error',    (err) => {
        console.error('\n[stream error]', err.message);
        if (!res.headersSent) res.status(500).end();
      });

    const passthrough = builder.getStream();

    req.on('close', () => {
      console.log('\n[stream] client disconnected – destroying');
      passthrough.destroy();
    });

    passthrough.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Local dev only (Vercel sets process.env.VERCEL at runtime) ─────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`\n🎬  ytdlp Stream Player  →  http://localhost:${PORT}\n`);
  });
}

export default app;
