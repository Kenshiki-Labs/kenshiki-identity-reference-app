import type { CaptureSession, DocumentCheckSnapshot } from '@kenshiki/identity-capture';

export type DocumentCheckPort = Pick<
  CaptureSession,
  | 'id'
  | 'documentCheckRestore'
  | 'documentCheck'
  | 'documentCheckAskAgain'
  | 'documentCheckCorrect'
  | 'cancel'
>;
export type DocumentCheckState = {
  snapshot: DocumentCheckSnapshot | undefined;
  busy: boolean;
  failure: { cause: unknown } | undefined;
};

/** One controller owns one session's pending work. Disposed work cannot publish to a new holder. */
export class DocumentCheckController {
  state: DocumentCheckState = { snapshot: undefined, busy: false, failure: undefined };
  private closed = false;
  private epoch = 0;
  private pending: Promise<DocumentCheckSnapshot> | undefined;

  constructor(
    private readonly session: DocumentCheckPort,
    private readonly changed: (state: DocumentCheckState) => void,
  ) {}

  private update(patch: Partial<DocumentCheckState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  private async run(action: () => Promise<DocumentCheckSnapshot>) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({ busy: true, failure: undefined });
    try {
      this.pending = action();
      const snapshot = await this.pending;
      if (epoch === this.epoch) this.update({ snapshot });
    } catch (failure) {
      if (epoch === this.epoch) this.update({ failure: { cause: failure } });
    } finally {
      if (epoch === this.epoch) {
        this.pending = undefined;
        this.update({ busy: false });
      }
    }
  }

  restore = () => this.run(() => this.session.documentCheckRestore());
  check = () => this.run(() => this.session.documentCheck(true));
  askAgain = () => this.run(() => this.session.documentCheckAskAgain(true));
  correct = (corrections: Record<string, string>) =>
    this.run(() => this.session.documentCheckCorrect(corrections, true));
  fail = (failure: unknown) => this.update({ failure: { cause: failure }, busy: false });

  pause = async () => {
    if (this.closed) return;
    const epoch = ++this.epoch;
    const pending = this.pending;
    this.update({ busy: true });
    try {
      const [cancelled] = await Promise.allSettled([this.session.cancel(), pending]);
      if (cancelled.status === 'rejected') throw cancelled.reason;
      const snapshot = await this.session.documentCheckRestore();
      if (epoch === this.epoch) this.update({ snapshot });
    } catch (failure) {
      if (epoch === this.epoch) this.update({ failure: { cause: failure } });
    } finally {
      if (epoch === this.epoch) {
        this.pending = undefined;
        this.update({ busy: false });
      }
    }
  };

  dispose() {
    this.closed = true;
    ++this.epoch;
    this.pending = undefined;
    this.state = { snapshot: undefined, busy: false, failure: undefined };
  }
}
