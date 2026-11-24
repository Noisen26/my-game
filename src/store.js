// Minimal lagring: JSON-fil för metadata, filsystem för bilder.
// Originalen ligger i en katalog som webbservern aldrig exponerar.
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function createStore(dir) {
  const originals = join(dir, 'originals');
  const previews = join(dir, 'previews');
  const dbFile = join(dir, 'db.json');
  let db = { artworks: [] };
  let writing = Promise.resolve();

  const persist = () =>
    (writing = writing.then(async () => {
      const tmp = dbFile + '.tmp';
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, dbFile);
    }));

  return {
    async init() {
      await mkdir(originals, { recursive: true });
      await mkdir(previews, { recursive: true });
      try {
        db = JSON.parse(await readFile(dbFile, 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
    list: () => [...db.artworks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    get: (id) => db.artworks.find((a) => a.id === id),
    previewPath: (id) => join(previews, `${id}.jpg`),
    async add(record, original, preview) {
      await writeFile(join(originals, `${record.id}.${record.format}`), original);
      await writeFile(join(previews, `${record.id}.jpg`), preview);
      db.artworks.push(record);
      await persist();
    },
    async remove(id) {
      const rec = db.artworks.find((a) => a.id === id);
      if (!rec) return;
      db.artworks = db.artworks.filter((a) => a.id !== id);
      await persist();
      await unlink(join(originals, `${id}.${rec.format}`)).catch(() => {});
      await unlink(join(previews, `${id}.jpg`)).catch(() => {});
    },
  };
}
