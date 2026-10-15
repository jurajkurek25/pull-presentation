import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || path.join(root, 'data/app.db'));
const port = Number(process.env.PORT || 3000);
// Hotspot shown as a "connect to Wi-Fi" QR code on the intro slide; WIFI_SSID= (empty) hides it.
const wifiSsid = process.env.WIFI_SSID ?? 'jurajkurek.com';
createApp({ db, publicUrl: process.env.PUBLIC_URL, wifiSsid }).listen(port, () => {
  console.log(`Server beží na http://localhost:${port}`);
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    console.log('Zatiaľ neexistuje žiadny admin. Vytvor ho: npm run create-user -- <email> <meno> <heslo>');
  }
});
