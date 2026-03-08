import express from 'express';
import { YtDlp, helpers } from 'ytdlp-nodejs';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Binary resolution ────────────────────────────────────────────────────────
//
// Strategy (fastest first):
//   1. ./bin/yt-dlp  ← bundled at build time via vercel-build + includeFiles
//      No download needed; zero cold-start penalty.
//   2. /tmp/ytdlp-bin/yt-dlp  ← fallback if bundle was skipped (local dev
//      or first deploy before build ran). Downloads once per container.
//
// WHY explicit binaryPath:
//   @vercel/node bundles JS so __dirname inside ytdlp-nodejs resolves to
//   /var/task/ (project root), not node_modules/ytdlp-nodejs/.
//   findYtdlpBinary() therefore looks in /var/task/bin/ and finds nothing
//   unless we either bundle it there OR pass binaryPath explicitly.

const BUNDLED_BIN  = path.join(__dirname, 'bin', 'yt-dlp');  // bundled path
const TMP_BIN_DIR  = '/tmp/ytdlp-bin';
const TMP_BIN_PATH = path.join(TMP_BIN_DIR, 'yt-dlp');       // fallback

let ytdlpInstance = null;
let initPromise   = null;

async function initYtDlp() {
  if (ytdlpInstance) return ytdlpInstance;

  let binaryPath;

  if (existsSync(BUNDLED_BIN)) {
    // ★ Fast path: binary was bundled at build time
    console.log('[init] using bundled binary at', BUNDLED_BIN);
    binaryPath = BUNDLED_BIN;
  } else {
    // Fallback: download to /tmp (writable on Vercel)
    if (!existsSync(TMP_BIN_PATH)) {
      console.log('[init] bundled binary not found — downloading to /tmp ...');
      mkdirSync(TMP_BIN_DIR, { recursive: true });
      await helpers.downloadYtDlp(TMP_BIN_DIR);
      console.log('[init] downloaded to', TMP_BIN_PATH);
    } else {
      console.log('[init] reusing /tmp binary');
    }
    binaryPath = TMP_BIN_PATH;
  }

  ytdlpInstance = new YtDlp({ binaryPath });
  return ytdlpInstance;
}

function getYtDlp() {
  if (!initPromise) initPromise = initYtDlp();
  return initPromise;
}

// Start init immediately at module load so the binary is ready
// by the time the first real request arrives.
getYtDlp().catch((err) => console.error('[init error]', err.message));

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

// ── Local dev server ───────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => console.log(`\n🎬  ytdlp Stream Player  →  http://localhost:${PORT}\n`));
}

export default app;
