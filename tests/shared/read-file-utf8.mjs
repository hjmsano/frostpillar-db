import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
export const readFileUtf8 = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};
