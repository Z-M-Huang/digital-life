import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MAX_LINES = 500;
const DIRECTORIES = ['packages', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED_SEGMENTS = new Set([
  'coverage',
  'dist',
  'node_modules',
  '.git',
  'snapshots',
  '__snapshots__',
  'migrations',
  'generated',
]);

const shouldSkipFile = (filePath: string): boolean => {
  const baseName = path.basename(filePath);
  if (baseName === 'bun.lock') {
    return true;
  }

  if (!EXTENSIONS.has(path.extname(filePath))) {
    return true;
  }

  return filePath.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment));
};

const collectFiles = async (directory: string): Promise<string[]> => {
  const absoluteDirectory = path.join(ROOT, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_SEGMENTS.has(entry.name)) {
          return [];
        }

        return collectFiles(path.relative(ROOT, absolutePath));
      }

      if (shouldSkipFile(absolutePath)) {
        return [];
      }

      const details = await stat(absolutePath);
      return details.isFile() ? [absolutePath] : [];
    }),
  );

  return nestedFiles.flat();
};

const main = async (): Promise<void> => {
  const files = (await Promise.all(DIRECTORIES.map(collectFiles))).flat();
  const failures: string[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').length;
    if (lines > MAX_LINES) {
      failures.push(`${path.relative(ROOT, filePath)}: ${lines} lines`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Repository-authored source and test files must stay under ${MAX_LINES} lines.`,
        ...failures,
      ].join('\n'),
    );
  }

  console.log(`Validated ${files.length} source/test files under ${MAX_LINES} lines.`);
};

await main();
