const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function normalizeRecentPlaceIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const placeId = Number(item);
    if (!Number.isSafeInteger(placeId) || placeId <= 0 || seen.has(placeId)) return [];
    seen.add(placeId);
    return [placeId];
  }).slice(0, 6);
}

async function readRecentPlaceIds(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return normalizeRecentPlaceIds(parsed?.placeIds);
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return [];
    return [];
  }
}

async function writeRecentPlaceIds(filePath, placeIds) {
  const safePlaceIds = normalizeRecentPlaceIds(placeIds);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.eclipse-taskbar-${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify({ placeIds: safePlaceIds })}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { normalizeRecentPlaceIds, readRecentPlaceIds, writeRecentPlaceIds };
