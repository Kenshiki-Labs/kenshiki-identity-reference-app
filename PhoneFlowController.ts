import type {Configuration, IdentityCaptureSession, PhoneCheckSnapshot} from '@kenshiki/identity-capture';

export type SavedPhoneCheck = {session: IdentityCaptureSession; snapshot: PhoneCheckSnapshot};
export type PhoneFlowState = {
  snapshot?: PhoneCheckSnapshot; busy: boolean; paused: boolean;
  sheet?: {kind: 'restart' | 'erase'} | {kind: 'error'; message: string};
};

/** Native SDK owns challenge identity, polling and encrypted receipts. JS only presents them. */
export class PhoneFlowController {
  state: PhoneFlowState = {busy: false, paused: false};
  private current?: IdentityCaptureSession;
  private unsubscribe?: () => void;
  private active?: Promise<void>;
  private drain?: Promise<void>;
  private epoch = 0;
  private closed = false;
  private eventRevision = 0;
  constructor(
    private readonly create: (configuration: Configuration) => Promise<IdentityCaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: PhoneFlowState) => void,
    saved?: SavedPhoneCheck,
  ) {
    if (saved) {
      this.state.snapshot = saved.snapshot;
      this.state.paused = saved.snapshot.pending;
      this.attach(saved.session);
    }
  }
  private update(patch: Partial<PhoneFlowState>) {
    if (this.closed) return;
    this.state = {...this.state, ...patch}; this.changed(this.state);
  }
  private attach(session: IdentityCaptureSession) {
    this.current = session;
    this.unsubscribe = session.subscribe(event => {
      if (event.type === 'phoneSnapshot' && this.current === session && !this.drain) {
        ++this.eventRevision; this.accept(event.snapshot);
      }
    });
  }
  private accept(snapshot: PhoneCheckSnapshot) {
    this.update({snapshot, paused: snapshot.pending ? this.state.paused : false});
    if (snapshot.failure) this.failure(snapshot.failure);
  }
  private failure(code?: string) {
    const message = code === 'compositionUnavailable'
      ? 'Text messaging is unavailable. Use an iPhone with text messaging enabled.'
      : ['phoneNotConfigured', 'notConfigured', 'invalidConfiguration', 'contextChanged', 'unauthorized'].includes(code ?? '')
        ? 'The phone service or checked ID is not available. Return to Identity and review your setup.'
        : code === 'recoveryRequired'
          ? 'Resume the existing check before starting another one. Your text may already have arrived.'
          : code === 'messageNotSent' ? 'The text was not sent. You can send the same message again.'
            : this.state.snapshot?.stage === 'finishing'
              ? 'The answer arrived but could not be saved. Save it again without sending another text.'
              : ['expired', 'unknownChallenge', 'conflict', 'refused'].includes(code ?? '')
                ? 'This challenge can no longer complete. Start a new check when you are ready.'
                : 'The check could not finish. Resume it to look for the same text. Your previous result is retained.';
    const revoked = code === 'contextChanged' || code === 'unauthorized';
    this.update({...(revoked ? {snapshot: undefined} : {}), sheet: {kind: 'error', message}});
  }
  private run(action: (session: IdentityCaptureSession) => Promise<PhoneCheckSnapshot>) {
    if (this.closed || this.active || this.drain) return Promise.resolve();
    const epoch = ++this.epoch;
    this.update({busy: true, sheet: undefined});
    const work = (async () => {
      try {
        if (!this.current) {
          const created = await this.create(this.configuration);
          if (this.closed || epoch !== this.epoch) { await created.release(); return; }
          this.attach(created);
        }
        const session = this.current;
        if (!session || this.closed || epoch !== this.epoch) return;
        const revision = this.eventRevision;
        const snapshot = await action(session);
        if (!this.closed && epoch === this.epoch && revision === this.eventRevision) this.accept(snapshot);
      } catch (error) {
        if (!this.closed && epoch === this.epoch) this.failure((error as {code?: string}).code);
      } finally {
        if (!this.closed && epoch === this.epoch) this.update({busy: false});
      }
    })();
    this.active = work;
    void work.finally(() => { if (this.active === work) this.active = undefined; });
    return work;
  }
  open = () => this.run(async session => {
    const snapshot = await session.phoneSnapshot();
    this.update({paused: snapshot.pending});
    return snapshot;
  });
  send = () => this.run(async session => {
    this.update({paused: false});
    return session.phoneSend(true);
  });
  resume = () => this.run(async session => {
    this.update({paused: false});
    return session.phoneResume();
  });
  save = () => this.run(session => session.phoneRetrySave());
  ask = (kind: 'restart' | 'erase') => { if (!this.state.busy && !this.drain) this.update({sheet: {kind}}); };
  dismiss = () => this.update({sheet: undefined});
  confirm = () => {
    const kind = this.state.sheet?.kind;
    if (kind === 'restart') return this.run(session => session.phoneStartOver(true));
    if (kind === 'erase') return this.run(async session => {
      await session.phoneCancel(); await session.phoneErase();
      this.update({snapshot: undefined, paused: false});
      return session.phoneSnapshot();
    });
    return Promise.resolve();
  };
  pause = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.drain) return this.drain;
    ++this.epoch;
    this.update({busy: true, sheet: undefined});
    const session = this.current;
    const work = (async () => {
      const [cancelled] = await Promise.allSettled([session?.phoneCancel(), this.active]);
      if (cancelled.status === 'rejected') throw cancelled.reason;
      if (session && this.current === session && !this.closed) {
        const snapshot = await session.phoneSnapshot();
        this.update({snapshot, paused: snapshot.pending});
      }
    })();
    this.drain = work;
    void work.then(() => {
      if (this.drain === work) { this.drain = undefined; this.update({busy: false}); }
    }, error => {
      if (this.drain === work) { this.drain = undefined; this.update({busy: false}); this.failure(error?.code); }
    });
    return work;
  };
  handoff = async (): Promise<SavedPhoneCheck | undefined> => {
    if (this.closed) return undefined;
    if (!this.state.snapshot && !this.active) { await this.dispose(); return undefined; }
    await this.pause();
    if (!this.current || !this.state.snapshot) { await this.dispose(); return undefined; }
    const result = {session: this.current, snapshot: this.state.snapshot};
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.current = undefined; this.closed = true;
    return result;
  };
  dispose = async () => {
    if (this.closed) return;
    this.closed = true; ++this.epoch;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    const session = this.current; this.current = undefined;
    await Promise.allSettled([session?.release(), this.active, this.drain]);
  };
}
