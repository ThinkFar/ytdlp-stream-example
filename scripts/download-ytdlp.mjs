/**
 * Vercel build script: downloads the yt-dlp binary into node_modules
 * so it is bundled with the serverless function deployment.
 */
import { helpers } from 'ytdlp-nodejs';

console.log('⬇️  Downloading yt-dlp binary...');
try {
  await helpers.downloadYtDlp();
  console.log('✅  yt-dlp binary ready');
} catch (err) {
  // Non-fatal: yt-dlp may already exist in PATH
  console.warn('⚠️  downloadYtDlp skipped:', err.message);
}
