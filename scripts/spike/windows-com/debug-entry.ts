import { fileURLToPath } from 'node:url';
console.log(JSON.stringify({ argv: process.argv, url: import.meta.url,
    filename: fileURLToPath(import.meta.url), main: import.meta.main }));
