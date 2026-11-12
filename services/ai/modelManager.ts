/**
 * Downloads and tracks models that WhisprNotes fetches itself (whisper.cpp
 * weights). ExecuTorch models are fetched by the library on first load.
 *
 * Downloads land as `<file>.part` and are renamed only once the byte count
 * matches the server's Content-Length, so an interrupted download (network
 * drop, app killed) is never mistaken for an installed model.
 */
import { createDownloadTask, directories, getExistingDownloadTasks } from '@kesha-antonov/react-native-background-downloader';
import { Directory, File, Paths } from 'expo-file-system';

import { MODEL_CATALOG, ModelId } from './modelCatalog';
import { isDownloadComplete } from './tiers';

export type ModelStatus = 'absent' | 'downloading' | 'ready';

type Listener = (id: ModelId, status: ModelStatus, progress: number) => void;
const listeners = new Set<Listener>();
const progressById = new Map<ModelId, number>();
const active = new Map<ModelId, { stop: () => Promise<void> }>();

export function subscribeModels(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(id: ModelId, status: ModelStatus, progress: number) {
  progressById.set(id, progress);
  listeners.forEach((l) => l(id, status, progress));
}

function modelsDir(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function modelFile(id: ModelId): File | null {
  const info = MODEL_CATALOG[id];
  return info.fileName ? new File(modelsDir(), info.fileName) : null;
}

/** Plain filesystem path (no file:// scheme), as native inference libraries expect. */
export function modelPath(id: ModelId): string | null {
  const file = modelFile(id);
  return file && file.exists ? decodeURI(file.uri.replace(/^file:\/\//, '')) : null;
}

export function status(id: ModelId): ModelStatus {
  if (active.has(id)) return 'downloading';
  const file = modelFile(id);
  return file?.exists ? 'ready' : 'absent';
}

export function progress(id: ModelId): number {
  return progressById.get(id) ?? 0;
}

export async function download(id: ModelId): Promise<void> {
  const info = MODEL_CATALOG[id];
  if (info.delivery !== 'manual' || !info.url || !info.fileName) {
    throw new Error(`${id} is downloaded automatically when first used`);
  }
  if (status(id) !== 'absent') return;

  // Resume tracking of a download that survived an app restart.
  const existing = (await getExistingDownloadTasks()).find((t) => t.id === id);
  if (existing) await existing.stop();

  const dir = modelsDir();
  const part = new File(dir, `${info.fileName}.part`);
  if (part.exists) part.delete();
  const destination = `${directories.documents}/models/${info.fileName}.part`;

  await new Promise<void>((resolve, reject) => {
    let expected: number | null = null;
    const task = createDownloadTask({ id, url: info.url!, destination, isAllowedOverMetered: true })
      .begin(({ expectedBytes }) => {
        expected = expectedBytes > 0 ? expectedBytes : null;
        notify(id, 'downloading', 0);
      })
      .progress(({ bytesDownloaded, bytesTotal }) => {
        const total = bytesTotal > 0 ? bytesTotal : info.approxBytes;
        notify(id, 'downloading', Math.min(0.999, bytesDownloaded / total));
      })
      .done(({ bytesDownloaded, bytesTotal }) => {
        active.delete(id);
        const total = expected ?? (bytesTotal > 0 ? bytesTotal : null);
        try {
          const written = part.exists ? part.size ?? bytesDownloaded : 0;
          if (!isDownloadComplete(written, total)) {
            if (part.exists) part.delete();
            throw new Error('Download was incomplete');
          }
          const final = new File(dir, info.fileName!);
          if (final.exists) final.delete();
          part.move(final);
          notify(id, 'ready', 1);
          resolve();
        } catch (error) {
          notify(id, 'absent', 0);
          reject(error);
        }
      })
      .error(({ error }) => {
        active.delete(id);
        if (part.exists) part.delete();
        notify(id, 'absent', 0);
        reject(new Error(error));
      });

    active.set(id, { stop: () => task.stop() });
    notify(id, 'downloading', 0);
    task.start();
  });
}

export async function cancelDownload(id: ModelId): Promise<void> {
  const task = active.get(id);
  active.delete(id);
  await task?.stop();
  const info = MODEL_CATALOG[id];
  if (info.fileName) {
    const part = new File(modelsDir(), `${info.fileName}.part`);
    if (part.exists) part.delete();
  }
  notify(id, 'absent', 0);
}

export function remove(id: ModelId): void {
  const file = modelFile(id);
  if (file?.exists) file.delete();
  notify(id, 'absent', 0);
}

/** Bytes used by models WhisprNotes downloaded itself. */
export function diskUsage(): number {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) return 0;
  return dir.list().reduce((sum, entry) => sum + (entry instanceof File ? entry.size ?? 0 : 0), 0);
}
