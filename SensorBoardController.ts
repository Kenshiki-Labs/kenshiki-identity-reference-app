import {
  type CaptureSession,
  type Configuration,
  IdentityCaptureSession,
  type SensorBoardRequest,
  type SensorBoardState,
} from '@kenshiki/identity-capture';
import { t } from './locales/i18n';

export type SensorBoardPresentation = {
  board: SensorBoardState | null;
  busy: boolean;
  failure: string | null;
  sessionId: string | null;
};
type CreateSession = (configuration: Configuration) => Promise<CaptureSession>;

/** One queue owns all commands. A user action cancels and drains the live refresh first. */
export class SensorBoardController {
  private session: CaptureSession | null = null;
  private opening: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;
  private desiredRunning = true;
  private disposed = false;
  private refreshing = false;
  private pendingActions = 0;
  private board: SensorBoardState | null = null;
  private failure: string | null = null;
  private generation = 0;

  constructor(
    private readonly configuration: Configuration,
    private readonly changed: (state: SensorBoardPresentation) => void,
    private readonly create: CreateSession = IdentityCaptureSession.create,
    private readonly pauseMilliseconds = 1000,
  ) {}

  open(): Promise<void> {
    if (this.opening) return this.opening;
    this.opening = this.initialize();
    this.queue = this.opening;
    return this.opening;
  }

  private async initialize(): Promise<void> {
    if (this.disposed) return;
    if (!this.configuration.sensors) {
      this.fail(t('sensors.failure.notConfigured'));
      return;
    }
    try {
      const session = await this.create({ sensors: this.configuration.sensors });
      if (this.disposed) {
        await session.release();
        return;
      }
      this.session = session;
      this.board = await session.sensorBoard({ action: 'status' });
      if (this.disposed) return;
      if (this.active && this.desiredRunning)
        this.board = await session.sensorBoard({ action: 'resume', consent: true });
      if (this.disposed) return;
      this.publish();
      this.schedule();
    } catch {
      this.fail(t('sensors.failure.session'));
    }
  }

  async perform(request: SensorBoardRequest, updateIntent = true): Promise<void> {
    if (this.disposed) return;
    if (updateIntent) {
      if (request.action === 'pause' || request.action === 'erase') this.desiredRunning = false;
      if (request.action === 'resume') this.desiredRunning = true;
    }
    this.stopTimer();
    this.pendingActions += 1;
    this.generation += 1;
    this.publish();
    const current = this.session;
    const cancellation = this.refreshing && current ? current.cancel() : Promise.resolve();
    const work = Promise.all([this.queue, cancellation]).then(async () => {
      if (this.disposed || !this.session) return;
      this.failure = null;
      let answer = await this.session.sensorBoard(request);
      if (
        !this.disposed &&
        this.active &&
        this.desiredRunning &&
        answer.collection.paused &&
        request.action !== 'pause' &&
        request.action !== 'erase'
      )
        answer = await this.session.sensorBoard({ action: 'resume', consent: true });
      if (!this.disposed) this.board = answer;
    });
    this.queue = work.catch(() => {
      this.desiredRunning = false;
      if (this.board) this.board = { ...this.board, collection: { ...this.board.collection, paused: true } };
      this.fail(t('sensors.failure.requestUnfinished'));
    });
    try {
      await this.queue;
    } finally {
      this.pendingActions -= 1;
      this.publish();
      this.schedule();
    }
  }

  async setActive(active: boolean): Promise<void> {
    this.active = active;
    this.generation += 1;
    this.stopTimer();
    if (this.disposed || !this.session) return;
    if (!active) {
      await this.perform({ action: 'pause' }, false);
    } else {
      await this.perform(
        this.desiredRunning ? { action: 'resume', consent: true } : { action: 'status' },
        false,
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.stopTimer();
    const session = this.session;
    this.session = null;
    if (session) {
      try {
        await session.cancel();
        await this.queue;
        await session.release();
      } catch {
        throw new Error(t('sensors.failure.close'));
      }
    }
    await this.opening;
  }

  private schedule(): void {
    this.stopTimer();
    if (
      this.disposed ||
      !this.active ||
      !this.desiredRunning ||
      !this.session ||
      this.pendingActions ||
      this.board?.collection.paused
    )
      return;
    this.timer = setTimeout(() => {
      this.refresh().catch(() => this.fail(t('sensors.failure.refresh')));
    }, this.pauseMilliseconds);
  }

  private async refresh(): Promise<void> {
    const session = this.session;
    if (!session || this.disposed || !this.active || this.pendingActions) return;
    const generation = this.generation;
    this.refreshing = true;
    const work = this.queue.then(async () => {
      if (this.disposed || generation !== this.generation) return;
      const answer = await session.sensorBoard({ action: 'refresh', consent: true });
      if (!this.disposed && generation === this.generation && this.active) {
        this.board = answer;
        this.failure = null;
      }
    });
    this.queue = work.catch(() => {
      if (generation === this.generation) this.fail(t('sensors.failure.read'));
    });
    try {
      await this.queue;
    } finally {
      this.refreshing = false;
      this.publish();
      this.schedule();
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private fail(message: string): void {
    if (!this.disposed) {
      this.failure = message;
      this.publish();
    }
  }
  private publish(): void {
    if (!this.disposed)
      this.changed({
        board: this.board,
        busy: this.pendingActions > 0,
        failure: this.failure,
        sessionId: this.session?.id ?? null,
      });
  }
}
