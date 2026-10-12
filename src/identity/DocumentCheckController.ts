import type { CaptureSession, DocumentCheckSnapshot, DocumentObservation } from '@kenshiki/identity-capture';
import { CaptureFlowError } from './CaptureFlowError';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';
import { documentCheckBelongsTo } from '../app/IdentityPrerequisites';

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
  loaded: boolean;
  failure: { cause: unknown } | undefined;
};

/** One controller owns one session's pending work. Disposed work cannot publish to a new holder. */
export class DocumentCheckController {
  state: DocumentCheckState = { snapshot: undefined, busy: false, loaded: false, failure: undefined };
  private closed = false;
  private correcting = false;
  private epoch = 0;
  private pending: Promise<DocumentCheckSnapshot> | undefined;

  constructor(
    private readonly session: DocumentCheckPort,
    private readonly changed: (state: DocumentCheckState) => void,
    private readonly document?: DocumentObservation,
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
      if (epoch === this.epoch) this.accept(snapshot);
    } catch (failure) {
      if (epoch === this.epoch) this.update({ failure: { cause: failure } });
    } finally {
      this.finish(epoch);
    }
  }

  private accept(snapshot: DocumentCheckSnapshot) {
    if (this.document && !documentCheckBelongsTo(this.document, snapshot))
      throw new CaptureFlowError('documentIntegrityFailure');
    this.update({ snapshot });
  }

  /** Completion belongs to the current operation; cancellation cannot release a successor's busy state. */
  private finish(epoch: number) {
    if (epoch !== this.epoch) return;
    this.pending = undefined;
    this.update({ busy: false, loaded: true });
  }

  restore = () => this.run(() => this.session.documentCheckRestore());
  check = () => this.run(() => this.session.documentCheck(true));
  askAgain = () => this.run(() => this.session.documentCheckAskAgain(true));
  correct = () =>
    this.run(async () => {
      this.correcting = true;
      try {
        return await this.session.documentCheckCorrect(true, documentCustodyPresentation());
      } finally {
        this.correcting = false;
      }
    });
  fail = (failure: unknown) => this.update({ failure: { cause: failure }, busy: false, loaded: true });

  pause = async () => {
    if (this.closed) return;
    const epoch = ++this.epoch;
    const pending = this.pending;
    this.update({ busy: true, failure: undefined });
    try {
      const [cancelled] = await Promise.allSettled([this.session.cancel(), pending]);
      if (cancelled.status === 'rejected') throw cancelled.reason;
      if (this.closed || epoch !== this.epoch) return;
      const snapshot = await this.session.documentCheckRestore();
      if (epoch === this.epoch) this.accept(snapshot);
    } catch (failure) {
      if (epoch === this.epoch) this.update({ failure: { cause: failure } });
    } finally {
      this.finish(epoch);
    }
  };

  async dispose() {
    this.closed = true;
    ++this.epoch;
    this.pending = undefined;
    this.state = { snapshot: undefined, busy: false, loaded: false, failure: undefined };
    if (this.correcting) await this.session.cancel();
  }
}
