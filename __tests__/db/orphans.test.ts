import { orphanedFiles } from '../../services/db/orphans';

describe('orphanedFiles', () => {
  const notes = [
    { id: '100', audioUri: 'file:///docs/audio/100.wav' },
    { id: 'imp_1_0', audioUri: null },
  ];
  test('audio not referenced by any note is orphaned', () => {
    expect(orphanedFiles({ audio: ['100.wav', '200.wav'], timelines: [] }, notes)).toEqual({ audio: ['200.wav'], timelines: [] });
  });
  test('timelines and peaks of missing notes are orphaned', () => {
    expect(
      orphanedFiles({ audio: [], timelines: ['100.json', '100.peaks.json', '300.json', '300.peaks.json'] }, notes).timelines
    ).toEqual(['300.json', '300.peaks.json']);
  });
  test('unknown files are left alone', () => {
    expect(orphanedFiles({ audio: ['readme.txt'], timelines: ['notes.txt'] }, notes)).toEqual({ audio: [], timelines: [] });
  });
});

describe('recordings in progress', () => {
  test('audio created after the cutoff is never orphaned', () => {
    const result = orphanedFiles({ audio: ['note-1000.wav', 'note-5000.wav'], timelines: [] }, [], 3000);
    expect(result.audio).toEqual(['note-1000.wav']);
  });
});
