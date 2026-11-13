export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';

/** Synchronous tap guards; React state alone updates too late for rapid taps. */
export class RecordingControls {
  phase: RecordingPhase = 'idle';
  private stopTask: Promise<void> | null = null;

  constructor(private readonly onChange: (phase: RecordingPhase) => void) {}

  private setPhase(phase: RecordingPhase): void {
    this.phase = phase;
    this.onChange(phase);
  }

  async start(begin: () => Promise<boolean>): Promise<boolean> {
    if (this.phase !== 'idle') return false;
    this.setPhase('starting');
    try {
      const started = await begin();
      this.setPhase(started ? 'recording' : 'idle');
      return started;
    } catch (error) {
      this.setPhase('idle');
      throw error;
    }
  }

  stop(finish: () => Promise<void>): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (this.phase !== 'recording') return Promise.resolve();
    this.setPhase('stopping');
    this.stopTask = Promise.resolve().then(finish).then(() => {
      this.setPhase('idle');
    }, (error) => {
      // Capture may still be active: offer Stop again, never a second Start.
      this.setPhase('recording');
      throw error;
    }).finally(() => { this.stopTask = null; });
    return this.stopTask;
  }
}
