export interface SchedulerOptions {
  intervalMs: number;
  run: () => Promise<void>;
  onError: (error: unknown) => void;
}

export class ScanScheduler {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(private readonly options: SchedulerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error("Scheduler interval must be a positive number.");
    }
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    void this.runAndScheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async runAndScheduleNext(): Promise<void> {
    try {
      await this.options.run();
    } catch (error) {
      this.options.onError(error);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.runAndScheduleNext();
        }, this.options.intervalMs);
      }
    }
  }
}
