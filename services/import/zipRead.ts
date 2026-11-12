/**
 * Inflates one zip entry while counting what comes out, aborting as soon as
 * it passes `maxChars`. Declared sizes in a zip can lie; this is the bound
 * that holds regardless.
 */
import type JSZip from 'jszip';

// internalStream exists at runtime but is missing from JSZip's typings.
interface StringStream {
  on(event: 'data', cb: (chunk: string) => void): StringStream;
  on(event: 'error', cb: (error: Error) => void): StringStream;
  on(event: 'end', cb: () => void): StringStream;
  pause(): StringStream;
  resume(): StringStream;
}

export function readEntryBounded(entry: JSZip.JSZipObject, maxChars: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let total = 0;
    let done = false;
    const stream = (entry as unknown as { internalStream(type: 'string'): StringStream }).internalStream('string');
    stream
      .on('data', (chunk: string) => {
        if (done) return;
        total += chunk.length;
        if (total > maxChars) {
          done = true;
          stream.pause();
          reject(new Error('File is too large (over 10 MB)'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', (error: Error) => {
        if (done) return;
        done = true;
        reject(error);
      })
      .on('end', () => {
        if (done) return;
        done = true;
        resolve(chunks.join(''));
      })
      .resume();
  });
}
