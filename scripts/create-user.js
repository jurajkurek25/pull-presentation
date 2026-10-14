import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 8) {
  console.error('Použitie: npm run create-user -- <email> "<meno>" <heslo (min. 8 znakov)>');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || path.join(root, 'data/app.db'));
createUser(db, { email, name, password });
console.log(`Používateľ ${email} vytvorený.`);
