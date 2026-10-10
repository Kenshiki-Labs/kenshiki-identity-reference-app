import type {
  CaptureErrorCode,
  CaptureSession,
  Configuration,
  SSNSessionSnapshot,
} from '@kenshiki/identity-capture';
import { CaptureFlowError } from './CaptureFlowError';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { t } from './locales/i18n';
import { SessionAcquisition } from './SessionAcquisition';

export type SavedSSNCheck = { session: CaptureSession; snapshot: SSNSessionSnapshot };
type Recovery = 'localSave' | 'entry' | 'open' | 'exit' | 'fresh' | 'resend';
export type SSNFlowState = {
  session?: CaptureSession | undefined;
  snapshot?: SSNSessionSnapshot | undefined;
  digits: string;
  busy: boolean;
  editing: boolean;
  sheet?:
    | (
        | { kind: 'confirmation' }
        | { kind: 'erase' }
        | { kind: 'recovery'; title: string; message: string; recovery: Recovery }
      )
    | undefined;
};
/** Codes that mean the check cannot run in this app as configured; the holder can only leave. */
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

/** The native SDK owns exact confirmation, single dispatch and encrypted local recovery.
 * This reference controller owns entry, presentation and the live session handoff only. */
export class SSNFlowController {
  state: SSNFlowState = { digits: '', busy: false, editing: false };
  private current?: CaptureSession | undefined;
  private closed = false;
  private epoch = 0;
  private active?: Promise<SSNSessionSnapshot> | undefined;
  private readonly acquisition = new SessionAcquisition();
  private disposal?: Promise<void> | undefined;
  private pausing = false;
  constructor(
    private readonly create: (configuration: Configuration) => Promise<CaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: SSNFlowState) => void,
    saved?: SavedSSNCheck,
  ) {
    if (saved) {
      this.current = saved.session;
      this.state = { ...this.state, session: saved.session, snapshot: redact(saved.snapshot) };
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
  private accept(snapshot: SSNSessionSnapshot, allowConfirmation: boolean) {
    const presented = allowConfirmation ? snapshot : redact(snapshot);
    this.update({
      snapshot: presented,
      digits: allowConfirmation ? snapshot.entryDigits : '',
      editing: !!presented.confirmation,
      sheet: presented.confirmation ? { kind: 'confirmation' } : undefined,
    });
  }
  private async recoverFailure(error: unknown, epoch: number) {
    let failure = error;
    try {
      if (this.current) {
        const snapshot = await this.current.ssnSnapshot();
        if (epoch === this.epoch && !this.closed) this.accept(snapshot, false);
      }
    } catch (readError) {
      failure = readError;
    }
    if (epoch === this.epoch && !this.closed) this.showFailure(errorCode(failure));
  }
  private async run(
    operation: (session: CaptureSession) => Promise<SSNSessionSnapshot>,
    allowConfirmation = false,
  ) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({ busy: true, sheet: undefined });
    let pending: Promise<SSNSessionSnapshot> | undefined;
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      pending = operation(session);
      this.active = pending;
      const snapshot = await pending;
      if (epoch === this.epoch && !this.closed) {
        this.accept(snapshot, allowConfirmation);
        if (snapshot.failure) this.showFailure(snapshot.failure);
      }
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        await this.recoverFailure(error, epoch);
      }
    } finally {
      if (this.active === pending) this.active = undefined;
      if (epoch === this.epoch) this.update({ busy: this.state.snapshot?.busy ?? false });
    }
  }
  open = async () => {
    if (!this.configuration.ssn) {
      this.update({
        sheet: {
          kind: 'recovery',
          title: t('ssn.sheet.notReadyTitle'),
          message: t('ssn.sheet.notConnected'),
          recovery: 'exit',
        },
      });
      return;
    }
    await this.run((session) => session.ssnSnapshot());
  };
  beginEntry = () => {
    if (this.closed || this.state.busy || this.state.snapshot?.state === 'finishing') return;
    this.update({ digits: '', editing: true, sheet: undefined });
  };
  setDigits = (value: string) => {
    if (!this.state.editing || this.state.busy || this.state.sheet) return;
    this.update({ digits: value.replace(/[^0-9]/g, '').slice(0, 9) });
  };
  requestConfirmation = () => {
    if (this.state.digits.length !== 9) return Promise.resolve();
    const digits = this.state.digits;
    return this.state.snapshot?.recoveryNeeded
      ? this.run((session) => session.ssnRequestFreshConfirmation(digits), true)
      : this.run((session) => session.ssnRequestConfirmation(digits), true);
  };
  confirm = () => {
    const id = this.state.snapshot?.confirmation?.id;
    if (!id || this.state.busy) return Promise.resolve();
    this.update({ digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot) });
    return this.run((session) => session.ssnConfirm(id));
  };
  resend = () => this.run((session) => session.ssnResendUnresolved());
  recover = () => this.run((session) => session.ssnRecover());
  edit = async () => {
    if (this.state.busy || this.state.snapshot?.state === 'finishing') return;
    const digits = this.state.snapshot?.confirmation?.digits ?? this.state.digits;
    const epoch = this.epoch + 1;
    await this.run((session) => session.ssnCancel());
    if (!this.closed && epoch === this.epoch && !this.state.sheet) this.update({ editing: true, digits });
  };
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const sheet = this.state.sheet;
    this.update({ sheet: undefined });
    if (sheet?.kind !== 'recovery') return Promise.resolve();
    if (sheet.recovery === 'open') return this.open();
    if (sheet.recovery === 'resend') return this.resend();
    if (sheet.recovery === 'localSave') return this.recover();
    if (sheet.recovery === 'entry' || sheet.recovery === 'fresh') this.beginEntry();
    return Promise.resolve();
  };
  /** Presents a rejected command in this screen's sheet. */
  fail = (error: unknown) => this.showFailure(errorCode(error));
  askErase = () => {
    if (!this.closed && !this.state.busy) this.update({ sheet: { kind: 'erase' } });
  };
  dismiss = () => {
    if (!this.state.busy) this.update({ sheet: undefined });
  };
  /** Revokes any confirmation, then erases this holder's SSN journal, receipts and custody key. */
  erase = () =>
    this.run(async (session) => {
      await session.ssnCancel();
      await session.ssnErase();
      this.update({ snapshot: undefined });
      return session.ssnSnapshot();
    });
  private failureSheet(
    code?: CaptureErrorCode,
  ): Extract<NonNullable<SSNFlowState['sheet']>, { kind: 'recovery' }> {
    if (code !== undefined && setupErrors[code] !== undefined)
      return {
        kind: 'recovery',
        title: t('ssn.sheet.notReadyTitle'),
        message: errorText(code, setupErrors, ''),
        recovery: 'exit',
      };
    if (this.state.snapshot?.state === 'finishing')
      return {
        kind: 'recovery',
        title: t('ssn.sheet.failedTitle'),
        message: t('ssn.sheet.localSave'),
        recovery: 'localSave',
      };
    if (this.state.snapshot?.recoveryNeeded)
      return {
        kind: 'recovery',
        title: t('ssn.notReceivedTitle'),
        message: t('ssn.sheet.unknown'),
        recovery: 'resend',
      };
    return {
      kind: 'recovery',
      title: t('ssn.sheet.failedTitle'),
      message: errorText(code, entryErrors, t('ssn.sheet.other')),
      recovery: code === 'storageUnavailable' || !this.state.snapshot ? 'open' : 'entry',
    };
  }
  private showFailure(code?: CaptureErrorCode) {
    const sheet = this.failureSheet(code);
    this.update({ digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet });
  }
  private async settle() {
    const session = this.current;
    const [cancelled, , acquired] = await Promise.allSettled([
      session?.ssnCancel(),
      this.active,
      this.acquisition.drain(),
    ]);
    if (cancelled.status === 'rejected') throw cancelled.reason;
    if (acquired.status === 'rejected') throw acquired.reason;
    if (!session || this.closed || session !== this.current) return;
    const snapshot = await session.ssnSnapshot();
    if (!this.closed && session === this.current) this.accept(snapshot, false);
  }
  pause = async () => {
    if (this.closed || this.pausing) return;
    this.pausing = true;
    const wasEditing = this.state.editing;
    const epoch = ++this.epoch;
    this.update({
      digits: '',
      snapshot: this.state.snapshot && redact(this.state.snapshot),
      sheet: undefined,
      busy: true,
    });
    try {
      await this.settle();
      if (epoch === this.epoch && !this.closed) {
        if (!this.state.snapshot)
          this.update({
            sheet: {
              kind: 'recovery',
              title: t('common.checkPaused'),
              message: t('ssn.sheet.pausedOpen'),
              recovery: 'open',
            },
          });
        else if (this.state.snapshot.recoveryNeeded)
          this.showFailure(this.state.snapshot.failure ?? undefined);
        else if (wasEditing && !this.state.snapshot?.receipt)
          this.update({
            sheet: {
              kind: 'recovery',
              title: t('common.checkPaused'),
              message: t('ssn.sheet.pausedEntry'),
              recovery: 'entry',
            },
          });
      }
    } catch (error) {
      if (epoch === this.epoch) this.fail(error);
    } finally {
      this.pausing = false;
      if (epoch === this.epoch) this.update({ busy: false });
    }
  };
  handoff = async (): Promise<SavedSSNCheck | undefined> => {
    if (this.closed) return undefined;
    ++this.epoch;
    this.update({
      digits: '',
      snapshot: this.state.snapshot && redact(this.state.snapshot),
      sheet: undefined,
      busy: true,
    });
    try {
      await this.settle();
    } catch (error) {
      this.update({ busy: false });
      this.fail(error);
      throw error;
    }
    if (!this.current || !this.state.snapshot) {
      await this.dispose();
      return undefined;
    }
    const result = { session: this.current, snapshot: redact(this.state.snapshot) };
    this.closed = true;
    this.current = undefined;
    return result;
  };
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.update({
      digits: '',
      snapshot: this.state.snapshot && redact(this.state.snapshot),
      sheet: undefined,
    });
    this.closed = true;
    ++this.epoch;
    const session = this.current;
    this.current = undefined;
    this.disposal = Promise.allSettled([session?.release(), this.active, this.acquisition.drain()]).then(
      ([released, , acquired]) => {
        if (released.status === 'rejected') throw released.reason;
        if (acquired.status === 'rejected') throw acquired.reason;
      },
    );
    return this.disposal;
  };
}

function redact(snapshot: SSNSessionSnapshot): SSNSessionSnapshot {
  return { ...snapshot, entryDigits: '', confirmation: null };
}
