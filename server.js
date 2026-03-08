import express from 'express';
import { YtDlp, helpers } from 'ytdlp-nodejs';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Binary init ───────────────────────────────────────────────────────────
// @vercel/node bundles JS via ncc, so __dirname inside the function resolves
// to /var/task/ (project root), NOT node_modules/ytdlp-nodejs/.
// findYtdlpBinary() therefore looks in /var/task/bin/ — finds nothing —
// passes binaryPath:'' → spawn fails with exit code 127 (command not found).
//
// Fix: on cold start, download the Linux x64 binary to /tmp (writable on
// Vercel), cache the YtDlp instance in memory for warm requests.

const TMP_BIN_DIR  = '/tmp/ytdlp-bin';
const TMP_BIN_PATH = path.join(TMP_BIN_DIR, 'yt-dlp');  // Linux x64 filename

let ytdlpInstance = null;
let initPromise   = null;

async function initYtDlp() {
  if (ytdlpInstance) return ytdlpInstance;

  if (process.env.VERCEL) {
    if (!existsSync(TMP_BIN_PATH)) {
      console.log('[init] cold start — downloading yt-dlp to /tmp/ytdlp-bin ...');
      mkdirSync(TMP_BIN_DIR, { recursive: true });
      await helpers.downloadYtDlp(TMP_BIN_DIR);
      console.log('[init] yt-dlp ready →', TMP_BIN_PATH);
    } else {
      console.log('[init] yt-dlp found in /tmp, reusing');
    }
    ytdlpInstance = new YtDlp({ binaryPath: TMP_BIN_PATH });
  } else {
    ytdlpInstance = new YtDlp();  // local: uses default PATH / node_modules bin
  }

  return ytdlpInstance;
}

// Kick off init immediately on module load (non-blocking) so
// the binary is ready by the time the first real request arrives.
function getYtDlp() {
  if (!initPromise) initPromise = initYtDlp();
  return initPromise;
}

if (process.env.VERCEL) {
  getYtDlp().catch((err) => console.error('[init error]', err.message));
}

// ── Static files ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/info?url= ─────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  try {
    const ytdlp = await getYtDlp();
    const info  = await ytdlp.getInfoAsync(url);
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

// ── GET /api/formats?url= ───────────────────────────────────────────────
app.get('/api/formats', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });
  try {
    const ytdlp  = await getYtDlp();
    const result = await ytdlp.getFormatsAsync(url);
    const streamable = (result.formats ?? []).filter(
      (f) => f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none'
    );
    res.json(streamable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /stream?url=&quality=&type= ──────────────────────────────────────
// Pipes ytdlp PassThrough directly to HTTP response – no disk I/O.
app.get('/stream', async (req, res) => {
  const { url, quality = 'highest', type = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });

  console.log(`[stream] ${new Date().toISOString()} quality=${quality}`);

  try {
    res.setHeader('Content-Type', `video/${type}`);
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');

    const ytdlp   = await getYtDlp();
    const builder = ytdlp
      .stream(url)
      .filter('audioandvideo')
      .quality(quality)
      .type(type)
      .on('start',    ()    => console.log('[stream] started'))
      .on('progress', (p)   => process.stdout.write(`\r  ${p.percentage_str}  ${p.speed_str}   `))
      .on('end',      ()    => console.log('\n[stream] done'))
      .on('error',    (err) => {
        console.error('\n[stream error]', err.message);
        if (!res.headersSent) res.status(500).end();
      });

    const passthrough = builder.getStream();
    req.on('close', () => {
      console.log('\n[stream] client disconnected');
      passthrough.destroy();
    });
    passthrough.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Local dev server (Vercel sets process.env.VERCEL) ────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => console.log(`\n🎬  ytdlp Stream Player  →  http://localhost:${PORT}\n`));
}

export default app;
