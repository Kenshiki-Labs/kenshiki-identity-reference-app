import type {CaptureErrorCode, Configuration, IdentityCaptureSession, SSNSessionSnapshot} from '@kenshiki/identity-capture';
import {errorCode, errorText, type ErrorText} from './HolderText';
import {t} from './locales/i18n';

export type SavedSSNCheck = {session: IdentityCaptureSession; snapshot: SSNSessionSnapshot};
type Recovery = 'localSave' | 'entry' | 'open' | 'exit' | 'fresh';
export type SSNFlowState = {
  session?: IdentityCaptureSession; snapshot?: SSNSessionSnapshot;
  digits: string; busy: boolean; editing: boolean;
  sheet?: {kind: 'confirmation'} | {kind: 'erase'} | {kind: 'recovery'; title: string; message: string; recovery: Recovery};
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
  state: SSNFlowState = {digits: '', busy: false, editing: false};
  private current?: IdentityCaptureSession;
  private closed = false;
  private epoch = 0;
  private active?: Promise<SSNSessionSnapshot>;
  private pausing = false;
  constructor(
    private readonly create: (configuration: Configuration) => Promise<IdentityCaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: SSNFlowState) => void,
    saved?: SavedSSNCheck,
  ) {
    if (saved) {
      this.current = saved.session;
      this.state = {...this.state, session: saved.session, snapshot: redact(saved.snapshot)};
    }
  }
  private update(patch: Partial<SSNFlowState>) {
    if (this.closed) return;
    this.state = {...this.state, ...patch}; this.changed(this.state);
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.create(this.configuration);
    if (this.closed || epoch !== this.epoch) { await session.release(); throw {code: 'cancelled'}; }
    this.current = session; this.update({session}); return session;
  }
  private accept(snapshot: SSNSessionSnapshot, allowConfirmation: boolean) {
    const presented = allowConfirmation ? snapshot : redact(snapshot);
    this.update({snapshot: presented, digits: allowConfirmation ? snapshot.entryDigits : '',
      editing: !!presented.confirmation,
      sheet: presented.confirmation ? {kind: 'confirmation'} : undefined});
  }
  private async run(operation: (session: IdentityCaptureSession) => Promise<SSNSessionSnapshot>, allowConfirmation = false) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({busy: true, sheet: undefined});
    let pending: Promise<SSNSessionSnapshot> | undefined;
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      pending = operation(session); this.active = pending;
      const snapshot = await pending;
      if (epoch === this.epoch && !this.closed) {
        this.accept(snapshot, allowConfirmation);
        if (snapshot.failure) this.showFailure(snapshot.failure);
      }
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        let failure = error;
        try {
          if (this.current) {
            const snapshot = await this.current.ssnSnapshot();
            if (epoch === this.epoch && !this.closed) this.accept(snapshot, false);
          }
        } catch (readError) { failure = readError; }
        if (epoch === this.epoch && !this.closed) this.showFailure(errorCode(failure));
      }
    } finally {
      if (this.active === pending) this.active = undefined;
      if (epoch === this.epoch) this.update({busy: this.state.snapshot?.busy ?? false});
    }
  }
  open = async () => {
    if (!this.configuration.ssn) {
      this.update({sheet: {kind: 'recovery', title: t('ssn.sheet.notReadyTitle'),
        message: t('ssn.sheet.notConnected'), recovery: 'exit'}});
      return;
    }
    await this.run(session => session.ssnSnapshot());
  };
  beginEntry = () => {
    if (this.closed || this.state.busy || this.state.snapshot?.state === 'finishing') return;
    this.update({digits: '', editing: true, sheet: undefined});
  };
  setDigits = (value: string) => {
    if (!this.state.editing || this.state.busy || this.state.sheet) return;
    this.update({digits: value.replace(/[^0-9]/g, '').slice(0, 9)});
  };
  requestConfirmation = () => {
    if (this.state.digits.length !== 9) return Promise.resolve();
    const digits = this.state.digits;
    return this.state.snapshot?.recoveryNeeded
      ? this.run(session => session.ssnRequestFreshConfirmation(digits), true)
      : this.run(session => session.ssnRequestConfirmation(digits), true);
  };
  confirm = () => {
    const id = this.state.snapshot?.confirmation?.id;
    if (!id || this.state.busy) return Promise.resolve();
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot)});
    return this.run(session => session.ssnConfirm(id));
  };
  recover = () => this.run(session => session.ssnRecover());
  edit = async () => {
    if (this.state.busy || this.state.snapshot?.state === 'finishing') return;
    const digits = this.state.snapshot?.confirmation?.digits ?? this.state.digits;
    const epoch = this.epoch + 1;
    await this.run(session => session.ssnCancel());
    if (!this.closed && epoch === this.epoch && !this.state.sheet) this.update({editing: true, digits});
  };
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const sheet = this.state.sheet;
    this.update({sheet: undefined});
    if (sheet?.kind !== 'recovery') return Promise.resolve();
    if (sheet.recovery === 'open') return this.open();
    if (sheet.recovery === 'localSave') return this.recover();
    if (sheet.recovery === 'entry' || sheet.recovery === 'fresh') this.beginEntry();
    return Promise.resolve();
  };
  /** Presents a rejected command in this screen's sheet. */
  fail = (error: unknown) => this.showFailure(errorCode(error));
  askErase = () => { if (!this.closed && !this.state.busy) this.update({sheet: {kind: 'erase'}}); };
  dismiss = () => { if (!this.state.busy) this.update({sheet: undefined}); };
  /** Revokes any confirmation, then erases this holder's SSN journal, receipts and custody key. */
  erase = () => this.run(async session => {
    await session.ssnCancel(); await session.ssnErase();
    this.update({snapshot: undefined});
    return session.ssnSnapshot();
  });
  private showFailure(code?: CaptureErrorCode) {
    const unavailable = code !== undefined && setupErrors[code] !== undefined;
    const localSave = this.state.snapshot?.state === 'finishing';
    const unknown = this.state.snapshot?.recoveryNeeded && !localSave;
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: {
      kind: 'recovery', title: unavailable ? t('ssn.sheet.notReadyTitle') : unknown ? t('ssn.notReceivedTitle') : t('ssn.sheet.failedTitle'),
      message: unavailable ? errorText(code, setupErrors, '') :
        localSave ? t('ssn.sheet.localSave') :
          unknown ? t('ssn.sheet.unknown') :
            errorText(code, entryErrors, t('ssn.sheet.other')),
      recovery: unavailable ? 'exit' : localSave ? 'localSave' : unknown ? 'fresh' :
        code === 'storageUnavailable' || !this.state.snapshot ? 'open' : 'entry',
    }});
  }
  private async settle() {
    const session = this.current;
    const [cancelled] = await Promise.allSettled([session?.ssnCancel(), this.active]);
    if (cancelled.status === 'rejected') throw cancelled.reason;
    if (!session || this.closed || session !== this.current) return;
    const snapshot = await session.ssnSnapshot();
    if (!this.closed && session === this.current) this.accept(snapshot, false);
  }
  pause = async () => {
    if (this.closed || this.pausing) return;
    this.pausing = true;
    const wasEditing = this.state.editing;
    const epoch = ++this.epoch;
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: undefined, busy: true});
    try {
      await this.settle();
      if (epoch === this.epoch && !this.closed) {
        if (!this.state.snapshot) this.update({sheet: {kind: 'recovery', title: t('common.checkPaused'),
          message: t('ssn.sheet.pausedOpen'), recovery: 'open'}});
        else if (this.state.snapshot.recoveryNeeded) this.showFailure(this.state.snapshot.failure ?? undefined);
        else if (wasEditing && !this.state.snapshot?.receipt) this.update({sheet: {kind: 'recovery', title: t('common.checkPaused'),
          message: t('ssn.sheet.pausedEntry'), recovery: 'entry'}});
      }
    } catch (error) { if (epoch === this.epoch) this.fail(error); }
    finally { this.pausing = false; if (epoch === this.epoch) this.update({busy: false}); }
  };
  handoff = async (): Promise<SavedSSNCheck | undefined> => {
    if (this.closed) return undefined;
    ++this.epoch;
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: undefined, busy: true});
    try { await this.settle(); }
    catch (error) { this.update({busy: false}); this.fail(error); throw error; }
    if (!this.current || !this.state.snapshot) { await this.dispose(); return undefined; }
    const result = {session: this.current, snapshot: redact(this.state.snapshot)};
    this.closed = true; this.current = undefined; return result;
  };
  dispose = async () => {
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: undefined});
    this.closed = true; ++this.epoch;
    const session = this.current; this.current = undefined;
    await Promise.allSettled([session?.release(), this.active]);
  };
}

function redact(snapshot: SSNSessionSnapshot): SSNSessionSnapshot {
  return {...snapshot, entryDigits: '', confirmation: null};
}
