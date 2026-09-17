import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { generateSelfSignedCert } from './cert-utils.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const certPath = process.env.SSL_CERT_PATH
  ? path.resolve(projectRoot, process.env.SSL_CERT_PATH)
  : path.join(projectRoot, 'certs', 'cert.pem');

const keyPath = process.env.SSL_KEY_PATH
  ? path.resolve(projectRoot, process.env.SSL_KEY_PATH)
  : path.join(projectRoot, 'certs', 'key.pem');

console.log(`\n🔐 WebTerm Self-Signed Certificate Generator`);
console.log(`------------------------------------------`);
console.log(`Target Key : ${keyPath}`);
console.log(`Target Cert: ${certPath}`);
console.log(`------------------------------------------\n`);

generateSelfSignedCert(certPath, keyPath, 365);

console.log(`\n🎉 Certificate generation complete! You can now start the server in HTTPS mode.\n`);
