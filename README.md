# ytdlp-nodejs · Stream Player Example

A self-contained **Express.js** application that demonstrates how to use [`ytdlp-nodejs`](https://github.com/iqbal-rashed/ytdlp-nodejs) to pipe yt-dlp video streams **directly into a browser `<video>` element** — no disk writes, no file storage.

## Features

- 🎬 **Direct browser streaming** — server pipes the yt-dlp output stream straight to the HTTP response
- 📋 **Video metadata** — fetches title, thumbnail, uploader, duration, and view count
- 🎚️ **Quality selector** — choose Highest / 720p / 480p / 360p / Lowest
- 💻 **Zero frontend dependencies** — plain HTML + CSS + JS
- 🔌 **Clean REST API** — `/api/info`, `/api/formats`, `/stream`
- ⚡ **Vercel-ready** — streams via `@vercel/node` with `maxDuration: 300`

## Requirements

- Node.js 18+
- `yt-dlp` binary (auto-downloaded via `vercel-build` script on Vercel, or run manually below)

## Local Setup

```bash
git clone https://github.com/ThinkFar/ytdlp-stream-example.git
cd ytdlp-stream-example
npm install

# Download the yt-dlp binary (one-time)
node -e "import('ytdlp-nodejs').then(m => m.helpers.downloadYtDlp())"

npm start
# → http://localhost:3000
```

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ThinkFar/ytdlp-stream-example)

Or import manually at [vercel.com/new](https://vercel.com/new) — `vercel.json` and the `vercel-build` script handle everything automatically.

## How the Stream Works

```
Browser  →  GET /stream?url=<yt-url>&quality=720p
              │
         Express handler
              │
         ytdlp.stream(url)
           .filter('audioandvideo')  ← single muxed file, no ffmpeg needed
           .quality('720p')
           .type('mp4')
           .getStream()              ← returns Node.js PassThrough
              │
         passThrough.pipe(res)       ← HTTP chunked transfer
              │
         <video src="/stream?...">   ← native browser playback
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/info?url=` | Video metadata (title, thumbnail, uploader…) |
| GET | `/api/formats?url=` | Available streamable (a+v) formats |
| GET | `/stream?url=&quality=&type=` | Raw video stream piped to response |

## Key Code

```js
// server.js
app.get('/stream', async (req, res) => {
  const { url, quality = 'highest', type = 'mp4' } = req.query;

  res.setHeader('Content-Type', `video/${type}`);
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Vercel edge buffering

  const passthrough = ytdlp
    .stream(url)
    .filter('audioandvideo')
    .quality(quality)
    .type(type)
    .getStream();               // PassThrough stream

  req.on('close', () => passthrough.destroy());
  passthrough.pipe(res);
});
```

## Credits

Built on [`ytdlp-nodejs`](https://github.com/iqbal-rashed/ytdlp-nodejs) by [iqbal-rashed](https://github.com/iqbal-rashed).
