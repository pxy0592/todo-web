import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(projectRoot, 'dist');
const requiredInputs = ['index.html', 'src', 'styles'];

for (const input of requiredInputs) {
  const inputPath = path.join(projectRoot, input);
  try {
    await access(inputPath);
  } catch {
    throw new Error(`Build input is missing: ${input}`);
  }
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await cp(path.join(projectRoot, 'index.html'), path.join(distDirectory, 'index.html'));
await cp(path.join(projectRoot, 'src'), path.join(distDirectory, 'src'), { recursive: true });
await cp(path.join(projectRoot, 'styles'), path.join(distDirectory, 'styles'), { recursive: true });

console.log(`Built static files in ${path.relative(projectRoot, distDirectory)}/`);
