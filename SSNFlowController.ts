import type {Configuration, IdentityCaptureSession, SSNSessionSnapshot, SSNVerificationFailure} from '@kenshiki/identity-capture';

export type SavedSSNCheck = {session: IdentityCaptureSession; snapshot: SSNSessionSnapshot};
type Recovery = 'status' | 'entry' | 'open' | 'exit';
export type SSNFlowState = {
  session?: IdentityCaptureSession; snapshot?: SSNSessionSnapshot;
  digits: string; busy: boolean; editing: boolean;
  sheet?: {kind: 'confirmation'} | {kind: 'recovery'; title: string; message: string; recovery: Recovery};
};

/** The SDK owns operation allocation, confirmation tokens and status-first recovery.
 * This example owns only transient entry, presentation and the live session handoff. */
export class SSNFlowController {
  state: SSNFlowState = {digits: '', busy: false, editing: true};
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
      this.state = {...this.state, session: saved.session, snapshot: redact(saved.snapshot),
        editing: !saved.snapshot.receipt && !saved.snapshot.recoveryNeeded};
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
      editing: !!presented.confirmation || !snapshot.receipt && !snapshot.recoveryNeeded,
      sheet: presented.confirmation ? {kind: 'confirmation'} : undefined});
  }
  private async run(operation: (session: IdentityCaptureSession) => Promise<SSNSessionSnapshot>,
    allowConfirmation = false) {
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
        // A failed submission may already own a durable operation. Read its current state;
        // an error never authorizes allocating a second request from JavaScript.
        try {
          if (this.current) {
            const snapshot = await this.current.ssnSnapshot();
            if (epoch === this.epoch && !this.closed) this.accept(snapshot, false);
          }
        }
        catch { /* Keep the last known operation; expose a retry without deleting it. */ }
        if (epoch === this.epoch && !this.closed) this.showFailure((error as {code?: string}).code);
      }
    } finally {
      if (this.active === pending) this.active = undefined;
      if (epoch === this.epoch) this.update({busy: this.state.snapshot?.busy ?? false});
    }
  }
  open = async () => {
    if (!this.configuration.ssn) {
      this.update({sheet: {kind: 'recovery', title: 'This check is not ready',
        message: 'This app needs a connected document and phone check before checking your Social Security number.', recovery: 'exit'}});
      return;
    }
    await this.run(session => session.ssnSnapshot());
  };
  setDigits = (value: string) => {
    if (this.state.busy || this.state.snapshot?.recoveryNeeded || this.state.sheet) return;
    this.update({digits: value.replace(/[^0-9]/g, '').slice(0, 9)});
  };
  requestConfirmation = () => {
    if (this.state.snapshot?.recoveryNeeded) return this.recover();
    if (this.state.digits.length !== 9) return Promise.resolve();
    const digits = this.state.digits;
    return this.run(session => session.ssnRequestConfirmation(digits), true);
  };
  confirm = () => {
    const id = this.state.snapshot?.confirmation?.id;
    if (!id || this.state.busy) return Promise.resolve();
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot)});
    return this.run(session => session.ssnConfirm(id));
  };
  recover = () => this.run(session => session.ssnRecover());
  edit = async () => {
    if (this.state.busy || this.state.snapshot?.recoveryNeeded) return;
    const digits = this.state.snapshot?.confirmation?.digits ?? this.state.digits;
    const epoch = this.epoch + 1;
    await this.run(session => session.ssnCancel());
    if (!this.closed && epoch === this.epoch && !this.state.sheet) this.update({editing: true, digits});
  };
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const sheet = this.state.sheet;
    this.update({sheet: undefined});
    if (sheet?.kind === 'recovery' && sheet.recovery === 'open') return this.open();
    return this.state.snapshot?.recoveryNeeded ? this.recover() : this.edit();
  };
  private showFailure(code?: string) {
    const failure = code as SSNVerificationFailure | undefined;
    const unavailable = ['ssnUnavailable', 'ssnNotConfigured', 'invalidConfiguration', 'contextChanged', 'unauthorized'].includes(code ?? '');
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: {
      kind: 'recovery', title: unavailable ? 'This check is not ready' : 'The check could not finish',
      message: unavailable ? 'Return to Identity. This app needs to reconnect the check before you can continue.' :
        failure === 'storageUnavailable' ? 'The saved check could not be opened. Try again without starting another check.' :
          this.state.snapshot?.recoveryNeeded ? 'Your request may still finish. Check its status before trying again.' :
            failure === 'invalidRequest' || failure === 'confirmationRequired' ? 'Enter your number again and confirm every digit before continuing.' :
              'Try again when you are ready. Any saved check is kept.',
      recovery: unavailable ? 'exit' : failure === 'storageUnavailable' || !this.state.snapshot ? 'open' : this.state.snapshot.recoveryNeeded ? 'status' : 'entry',
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
      if (epoch === this.epoch && !this.closed && (wasEditing || this.state.snapshot?.recoveryNeeded)) this.update({sheet: {kind: 'recovery', title: 'Check paused',
        message: this.state.snapshot?.recoveryNeeded ? 'Your request is saved. Check its status to continue.' : 'Enter your number again when you are ready.',
        recovery: this.state.snapshot?.recoveryNeeded ? 'status' : 'entry'}});
    } catch (error) { if (epoch === this.epoch) this.showFailure((error as {code?: string}).code); }
    finally { this.pausing = false; if (epoch === this.epoch) this.update({busy: false}); }
  };
  handoff = async (): Promise<SavedSSNCheck | undefined> => {
    if (this.closed) return undefined;
    ++this.epoch;
    this.update({digits: '', snapshot: this.state.snapshot && redact(this.state.snapshot), sheet: undefined, busy: true});
    try { await this.settle(); }
    catch (error) { this.update({busy: false}); this.showFailure((error as {code?: string}).code); throw error; }
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

/** Do not checkpoint an SSN entry or confirmation in React state handed to the adopting screen. */
function redact(snapshot: SSNSessionSnapshot): SSNSessionSnapshot {
  return {...snapshot, entryDigits: '', confirmation: null};
}
