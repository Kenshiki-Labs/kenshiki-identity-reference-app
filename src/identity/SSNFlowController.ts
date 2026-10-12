import type {
  CaptureErrorCode,
  CaptureSession,
  Configuration,
  DocumentCustodyPresentation,
  SSNSessionSnapshot,
} from '@kenshiki/identity-capture';
import { CaptureFlowError } from './CaptureFlowError';
import { type ErrorText, errorCode, errorText } from '../app/HolderText';
import { t } from '../locales/i18n';
import { SessionAcquisition } from '../app/SessionAcquisition';

export type SavedSSNCheck = { session: CaptureSession; snapshot: SSNSessionSnapshot };
type Recovery = 'entry' | 'open' | 'exit' | 'resend';
export type SSNFlowState = {
  session?: CaptureSession | undefined;
  snapshot?: SSNSessionSnapshot | undefined;
  busy: boolean;
  opening: boolean;
  sheet?:
    | { kind: 'erase' }
    | { kind: 'recovery'; title: string; message: string; recovery: Recovery }
    | undefined;
};
const setupErrors: ErrorText = {
  ssnNotConfigured: t('ssn.setupError.ssnNotConfigured'),
  invalidConfiguration: t('ssn.setupError.invalidConfiguration'),
  notConfigured: t('ssn.setupError.notConfigured'),
  unauthorized: t('ssn.setupError.unauthorized'),
  contextChanged: t('ssn.setupError.contextChanged'),
};
const entryErrors: ErrorText = {
  storageUnavailable: t('ssn.entryError.storageUnavailable'),
  rateLimited: t('ssn.entryError.rateLimited'),
  confirmationRequired: t('ssn.entryError.confirmationRequired'),
  invalidRequest: t('ssn.entryError.invalidRequest'),
  busy: t('ssn.entryError.busy'),
};

/** Native UI owns digits and exact confirmation. React orchestrates safe status and session custody. */
export class SSNFlowController {
  state: SSNFlowState = { busy: false, opening: true };
  private current?: CaptureSession | undefined;
  private closed = false;
  private epoch = 0;
  private active?: Promise<SSNSessionSnapshot> | undefined;
  private readonly acquisition = new SessionAcquisition();
  private disposal?: Promise<void> | undefined;
  private draining: Promise<void> | undefined;
  private settlementFailed = false;
  constructor(
    private readonly create: (configuration: Configuration) => Promise<CaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: SSNFlowState) => void,
    saved?: SavedSSNCheck,
    private readonly presentation?: DocumentCustodyPresentation,
  ) {
    if (saved) {
      this.current = saved.session;
      this.state = { ...this.state, session: saved.session, snapshot: saved.snapshot };
    }
  }
  private update(patch: Partial<SSNFlowState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.acquisition.open(
      () => this.create(this.configuration),
      () => !this.closed && epoch === this.epoch,
      (created) => {
        this.current = created;
        this.update({ session: created });
      },
    );
    if (!session) throw new CaptureFlowError('cancelled');
    return session;
  }
  private accept(snapshot: SSNSessionSnapshot) {
    this.update({ snapshot, opening: false, sheet: undefined });
    if (snapshot.failure) this.showFailure(snapshot.failure);
  }
  private async run(operation: (session: CaptureSession) => Promise<SSNSessionSnapshot>) {
    if (this.closed || this.state.busy || this.draining !== undefined) return;
    const epoch = ++this.epoch;
    this.update({ busy: true, sheet: undefined });
    let pending: Promise<SSNSessionSnapshot> | undefined;
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      pending = operation(session);
      this.active = pending;
      const snapshot = await pending;
      if (epoch === this.epoch && !this.closed) this.accept(snapshot);
    } catch (error) {
      if (epoch === this.epoch && !this.closed) await this.recoverFailure(error, epoch);
    } finally {
      if (this.active === pending) this.active = undefined;
      if (epoch === this.epoch) this.update({ busy: this.state.snapshot?.busy ?? false });
    }
  }
  private async recoverFailure(error: unknown, epoch: number) {
    let failure = error;
    try {
      if (this.current) {
        const snapshot = await this.current.ssnSnapshot();
        if (epoch === this.epoch && !this.closed) this.accept(snapshot);
      }
    } catch (readError) {
      failure = readError;
    }
    if (epoch === this.epoch && !this.closed) this.showFailure(errorCode(failure));
  }
  open = async () => {
    if (!this.configuration.ssn) {
      this.showFailure('ssnNotConfigured');
      return;
    }
    await this.run((session) => session.ssnSnapshot());
  };
  beginEntry = async (): Promise<void> => {
    if (this.closed || this.state.busy || this.state.snapshot?.recoveryNeeded) return;
    if (this.settlementFailed) {
      await this.pause();
      if (this.state.sheet || this.closed) return;
    }
    if (!this.presentation) {
      this.showFailure('invalidConfiguration');
      return;
    }
    const presentation = this.presentation;
    await this.run((session) => session.ssnEntry(presentation));
  };
  recover = () => this.run((session) => session.ssnRecover());
  resend = () => this.recover();
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const sheet = this.state.sheet;
    this.update({ sheet: undefined });
    if (sheet?.kind !== 'recovery') return Promise.resolve();
    if (sheet.recovery === 'open') return this.open();
    if (sheet.recovery === 'resend') return this.recover();
    if (sheet.recovery === 'entry') return this.beginEntry();
    return Promise.resolve();
  };
  fail = (error: unknown) => this.showFailure(errorCode(error));
  askErase = () => {
    if (!this.closed && !this.state.busy) this.update({ sheet: { kind: 'erase' } });
  };
  dismiss = () => {
    if (!this.state.busy) this.update({ sheet: undefined });
  };
  erase = () =>
    this.run(async (session) => {
      await session.ssnCancel();
      await session.ssnErase();
      this.update({ snapshot: undefined });
      return session.ssnSnapshot();
    });
  private showFailure(code?: CaptureErrorCode) {
    this.update({
      opening: false,
      snapshot: code === 'contextChanged' ? undefined : this.state.snapshot,
      sheet: recoverySheet(code, this.state.snapshot),
    });
  }
  pause = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.draining !== undefined) return this.draining;
    const epoch = ++this.epoch;
    this.update({ busy: true, sheet: undefined });
    const session = this.current;
    const work = Promise.resolve().then(async () => {
      const [cancelled, , acquired] = await Promise.allSettled([
        session?.ssnCancel(),
        this.active,
        this.acquisition.drain(),
      ]);
      if (this.closed || epoch !== this.epoch) return;
      if (cancelled.status === 'rejected') {
        this.settlementFailed = true;
        throw cancelled.reason;
      }
      if (acquired.status === 'rejected') throw acquired.reason;
      this.settlementFailed = false;
      if (session && session === this.current) {
        const snapshot = await session.ssnSnapshot();
        if (!this.closed && epoch === this.epoch) this.accept(snapshot);
      } else this.showFailure();
    });
    this.draining = work;
    const finish = () => {
      if (this.draining === work) this.draining = undefined;
      if (epoch === this.epoch) this.update({ busy: false });
    };
    work.then(finish, (error) => {
      if (epoch === this.epoch) this.fail(error);
      finish();
    });
    return work;
  };
  handoff = async (accept?: (value: SavedSSNCheck) => boolean): Promise<SavedSSNCheck | undefined> => {
    if (this.closed) {
      await this.disposal;
      return undefined;
    }
    if (this.state.sheet?.kind === 'recovery' && this.state.sheet.recovery === 'exit') {
      await this.dispose();
      return undefined;
    }
    await this.pause();
    if (this.closed) throw new CaptureFlowError('cancelled');
    if (!this.current || !this.state.snapshot) {
      await this.dispose();
      return undefined;
    }
    const result = { session: this.current, snapshot: this.state.snapshot };
    if (accept && !accept(result)) throw new CaptureFlowError('contextChanged');
    this.closed = true;
    ++this.epoch;
    this.current = undefined;
    return result;
  };
  get disposalStarted() {
    return this.disposal !== undefined;
  }
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    ++this.epoch;
    const session = this.current;
    this.current = undefined;
    this.disposal = Promise.allSettled([
      session?.release(),
      this.active,
      this.draining,
      this.acquisition.drain(),
    ]).then(([released, , , acquired]) => {
      if (released.status === 'rejected') throw released.reason;
      if (acquired.status === 'rejected') throw acquired.reason;
    });
    return this.disposal;
  };
}

/** Keep setup failures, unresolved purchases, and local entry recovery distinct. */
function recoverySheet(
  code: CaptureErrorCode | undefined,
  snapshot: SSNSessionSnapshot | undefined,
): Extract<NonNullable<SSNFlowState['sheet']>, { kind: 'recovery' }> {
  if (code !== undefined && setupErrors[code] !== undefined) {
    return {
      kind: 'recovery',
      title: t('ssn.sheet.notReadyTitle'),
      message: errorText(code, setupErrors, ''),
      recovery: 'exit',
    };
  }
  if (snapshot?.recoveryNeeded) {
    return {
      kind: 'recovery',
      title: t('ssn.notReceivedTitle'),
      message: t('ssn.sheet.unknown'),
      recovery: 'resend',
    };
  }
  return {
    kind: 'recovery',
    title: t('ssn.sheet.failedTitle'),
    message: errorText(code, entryErrors, t('ssn.sheet.other')),
    recovery: code === 'storageUnavailable' || !snapshot ? 'open' : 'entry',
  };
}
