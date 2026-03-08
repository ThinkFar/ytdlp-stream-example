/**
 * Vercel build script — downloads the yt-dlp Linux x64 binary into ./bin/
 * so it is bundled via includeFiles and available instantly at runtime
 * with zero cold-start download delay.
 */
import { helpers } from 'ytdlp-nodejs';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR   = join(__dirname, '..', 'bin'); // project root ./bin/

mkdirSync(BIN_DIR, { recursive: true });

console.log('\u2b07\ufe0f  Downloading yt-dlp binary to ./bin/ ...');
try {
  const outPath = await helpers.downloadYtDlp(BIN_DIR);
  console.log('\u2705  yt-dlp ready at:', outPath);
} catch (err) {
  console.error('\u274c  Failed to download yt-dlp:', err.message);
  process.exit(1); // fail the build so the issue is visible
}
