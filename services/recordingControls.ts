export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/** Synchronous tap guards; React state alone updates too late for rapid taps. */
export class RecordingControls {
  phase: RecordingPhase = 'idle';
  private stopTask: Promise<void> | null = null;

  constructor(private readonly onChange: (phase: RecordingPhase) => void) {}

  private setPhase(phase: RecordingPhase): void {
    this.phase = phase;
    this.onChange(phase);
  }

  /** True while a take is in progress, whether capturing or paused. */
  get inSession(): boolean {
    return this.phase === 'recording' || this.phase === 'paused';
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

  /**
   * Pauses capture. `apply` pauses the microphone; if it throws, the phase
   * is left as it was, so the screen never claims a pause that didn't happen.
   */
  pause(apply: () => void): boolean {
    if (this.phase !== 'recording') return false;
    apply();
    this.setPhase('paused');
    return true;
  }

  resume(apply: () => void): boolean {
    if (this.phase !== 'paused') return false;
    apply();
    this.setPhase('recording');
    return true;
  }

  /** Ends the take from either a running or a paused recording. */
  stop(finish: () => Promise<void>): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (!this.inSession) return Promise.resolve();
    const before = this.phase;
    this.setPhase('stopping');
    this.stopTask = Promise.resolve().then(finish).then(() => {
      this.setPhase('idle');
    }, (error) => {
      // Capture may still be active: offer Stop again, never a second Start.
      this.setPhase(before);
      throw error;
    }).finally(() => { this.stopTask = null; });
    return this.stopTask;
  }
}
