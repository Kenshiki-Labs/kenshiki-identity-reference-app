import type { CaptureErrorCode, EnvironmentCheckSnapshot } from '@kenshiki/identity-capture';
import { CaptureFlowError } from '../identity/CaptureFlowError';
import { errorCode } from '../app/HolderText';
import type { SavedSSNCheck } from '../identity/SSNFlowController';

export type SavedEnvironmentCheck = SavedSSNCheck & { environment?: EnvironmentCheckSnapshot };
export type EnvironmentCheckState = {
  busy: boolean;
  opening: boolean;
  snapshot: EnvironmentCheckSnapshot | undefined;
  failure: CaptureErrorCode | undefined;
};

/** One retained SSN owner, one native environmental attempt; no measurements cross this controller. */
export class EnvironmentCheckController {
  state: EnvironmentCheckState = { busy: false, opening: true, snapshot: undefined, failure: undefined };
  private closed = false;
  private transferred = false;
  private epoch = 0;
  private active: Promise<void> | undefined;
  private draining: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  constructor(
    private readonly saved: SavedSSNCheck,
    private readonly changed: (state: EnvironmentCheckState) => void,
  ) {}
  private update(patch: Partial<EnvironmentCheckState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  fail = (error: unknown) =>
    this.update({ failure: errorCode(error) ?? 'operationFailed', snapshot: undefined });
  private run(action: () => Promise<EnvironmentCheckSnapshot>) {
    if (this.closed || this.active !== undefined || this.draining !== undefined) return Promise.resolve();
    const epoch = ++this.epoch;
    this.update({ busy: true, failure: undefined, snapshot: undefined });
    const pending = Promise.resolve().then(async () => {
      try {
        if (this.closed || epoch !== this.epoch) return;
        const snapshot = await action();
        if (!this.closed && epoch === this.epoch) this.update({ snapshot });
      } catch (error) {
        if (!this.closed && epoch === this.epoch) this.fail(error);
      } finally {
        if (!this.closed && epoch === this.epoch) this.update({ busy: false, opening: false });
      }
    });
    this.active = pending;
    pending.then(() => {
      if (this.active === pending) this.active = undefined;
    }, this.fail);
    return pending;
  }
  open = () => this.run(() => this.saved.session.environmentSnapshot());
  check = () => this.run(() => this.saved.session.environmentCheck(true));
  permission = (kind: 'location' | 'motion') =>
    this.run(() => this.saved.session.environmentPermission(kind, true));
  pause = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.draining !== undefined) return this.draining;
    const epoch = ++this.epoch;
    this.update({ busy: true, failure: undefined });
    const work = Promise.resolve().then(async () => {
      const [cancelled] = await Promise.allSettled([this.saved.session.cancel(), this.active]);
      if (this.closed || epoch !== this.epoch) return;
      if (cancelled.status === 'rejected') throw cancelled.reason;
      const snapshot = await this.saved.session.environmentSnapshot();
      if (!this.closed && epoch === this.epoch) this.update({ snapshot });
    });
    this.draining = work;
    const settled = () => {
      if (this.draining === work) this.draining = undefined;
      if (!this.closed && epoch === this.epoch) this.update({ busy: false, opening: false });
    };
    work.then(settled, (error) => {
      if (!this.closed && epoch === this.epoch) this.fail(error);
      settled();
    });
    return work;
  };
  handoff = async (accept?: (value: SavedEnvironmentCheck) => boolean): Promise<SavedEnvironmentCheck> => {
    if (this.closed) throw new CaptureFlowError('cancelled');
    await this.pause();
    if (this.closed) throw new CaptureFlowError('cancelled');
    const result: SavedEnvironmentCheck = {
      ...this.saved,
      ...(this.state.snapshot === undefined ? {} : { environment: this.state.snapshot }),
    };
    if (accept && !accept(result)) throw new CaptureFlowError('contextChanged');
    this.transferred = true;
    this.closed = true;
    ++this.epoch;
    return result;
  };
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    ++this.epoch;
    this.disposal = Promise.allSettled([
      this.transferred ? undefined : this.saved.session.release(),
      this.active,
      this.draining,
    ]).then(([released]) => {
      if (released.status === 'rejected') throw released.reason;
    });
    return this.disposal;
  };
}
