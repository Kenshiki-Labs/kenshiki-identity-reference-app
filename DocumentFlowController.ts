import type {
  CaptureEvent, Configuration, DocumentObservation, DocumentRecordSummary, IdentityCaptureSession,
} from '@kenshiki/identity-capture';

export type DocumentSide = 'front' | 'back';
export type SavedDocumentCapture = {session: IdentityCaptureSession; document: DocumentObservation};
export type SavedDocumentChoice = {workflowID: string; captureID: string; hasBack: boolean};
type Phase = 'loading' | 'saved' | 'intro' | 'front' | 'frontReview' | 'back' | 'result';
type Recovery = 'front' | 'back' | 'load' | 'recover' | 'snapshot' | 'settings' | 'details';
export type DocumentFlowState = {
  phase: Phase; busy: boolean; capturing: boolean; ready: boolean; preview: number;
  session?: IdentityCaptureSession; completed?: DocumentObservation; draft?: DocumentObservation;
  saved: SavedDocumentChoice[]; selected?: string; issue?: string | null;
  sheet?: {title: string; message: string; recovery: Recovery};
};
const initial = (): DocumentFlowState => ({phase: 'loading', busy: false, capturing: false,
  ready: false, preview: 0, saved: []});
export const isCompleteDocument = (value?: DocumentObservation) => !!(value?.front && value.back);

/** A scan draft never replaces a completed license until the SDK commits both sides. */
export class DocumentFlowController {
  state = initial();
  private epoch = 0;
  private closed = false;
  private current?: IdentityCaptureSession;
  private off?: () => void;
  private activeWork?: Promise<void>;
  private side: DocumentSide = 'front';
  constructor(
    private readonly create: (configuration: Configuration) => Promise<IdentityCaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: DocumentFlowState) => void,
    saved?: SavedDocumentCapture,
  ) {
    if (saved) {
      this.current = saved.session;
      this.state = {...initial(), session: saved.session,
        phase: isCompleteDocument(saved.document) ? 'result' : 'frontReview',
        completed: isCompleteDocument(saved.document) ? saved.document : undefined,
        draft: isCompleteDocument(saved.document) ? undefined : saved.document};
      this.listen(saved.session);
    }
  }
  private update(patch: Partial<DocumentFlowState>) {
    if (this.closed) return;
    this.state = {...this.state, ...patch}; this.changed(this.state);
  }
  private listen(session: IdentityCaptureSession) {
    this.off = session.subscribe(event => {
      if (!this.closed && this.current === session && !this.state.sheet) this.event(event);
    });
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.create(this.configuration);
    if (this.closed || epoch !== this.epoch) { await session.release(); throw {code: 'cancelled'}; }
    this.current = session; this.listen(session); this.update({session}); return session;
  }
  private async run(phase: Phase, recovery: Recovery,
    work: (session: IdentityCaptureSession, epoch: number) => Promise<void>) {
    if (this.closed || this.state.busy || this.state.capturing) return;
    const epoch = ++this.epoch;
    this.update({phase, busy: true, sheet: undefined, issue: undefined});
    let pending: Promise<void> | undefined;
    try {
      const session = await this.session(epoch);
      if (this.closed || epoch !== this.epoch) return;
      pending = work(session, epoch); this.activeWork = pending; await pending;
    } catch (error) {
      if (!this.closed && epoch === this.epoch) {
        this.update({capturing: false, ready: false, sheet: this.failure(error, recovery)});
      }
    } finally {
      if (this.activeWork === pending) this.activeWork = undefined;
      if (epoch === this.epoch) this.update({busy: false});
    }
  }
  open = () => {
    if (this.current) return Promise.resolve();
    return this.run('loading', 'load', async (session, epoch) => {
      const records = await session.listDocuments();
      if (this.closed || epoch !== this.epoch) return;
      const saved = groupDocuments(records);
      this.update({saved});
      if (saved.length === 1) {
        this.update({selected: saved[0].captureID});
        const observation = await session.recoverDocument(saved[0].captureID);
        if (!this.closed && epoch === this.epoch) this.accept(observation);
      } else this.update({phase: saved.length ? 'saved' : 'intro'});
    });
  };
  recoverSaved = (captureID: string) => this.run('loading', 'recover', async (session, epoch) => {
    this.update({selected: captureID});
    const observation = await session.recoverDocument(captureID);
    if (!this.closed && epoch === this.epoch) this.accept(observation);
  });
  startFront = () => this.start('front');
  startBack = () => this.start('back');
  private start(side: DocumentSide) {
    if (this.closed || this.state.busy || this.state.capturing) return Promise.resolve();
    if (side === 'back' && !this.state.draft?.front) return Promise.resolve();
    this.side = side;
    if (side === 'front') this.update({draft: undefined});
    this.update({ready: false});
    return this.run(side, side, async session => {
      await session.startDocument({consent: true, side});
    });
  }
  capture = () => {
    if (!this.state.ready) return Promise.resolve();
    return this.run(this.side, this.side, async session => {
      this.update({capturing: true, ready: false});
      await session.captureDocument();
    });
  };
  private accept(observation: DocumentObservation, reveal = true) {
    if (isCompleteDocument(observation)) {
      this.update({completed: observation, draft: undefined, capturing: false, ready: false,
        ...(reveal ? {phase: 'result' as const} : {})});
    } else if (observation.front) {
      this.update({draft: observation, capturing: false, ready: false,
        ...(reveal ? {phase: 'frontReview' as const} : {})});
    }
  }
  private failure(error: unknown, fallback: Recovery): NonNullable<DocumentFlowState['sheet']> {
    const code = (error as {code?: string}).code ?? '';
    if (['camera_permission_denied', 'cameraPermissionDenied'].includes(code)) return {
      title: 'Allow camera access', message: 'Open Settings to allow camera access, then return to continue.', recovery: 'settings'};
    if (['back_camera_unavailable', 'cameraUnavailable', 'unavailable', 'camera_permission_restricted', 'cameraPermissionRestricted'].includes(code)) return {
      title: 'Camera unavailable', message: 'This device cannot start the camera check. You can return to your saved results.', recovery: 'details'};
    if (['invalidConfiguration', 'invalid_configuration'].includes(code)) return {
      title: 'Capture is not available', message: 'Driver’s license capture has not been set up for this app.', recovery: 'details'};
    const storage = ['load', 'recover', 'snapshot'].includes(fallback) || ['documentCustodyFailed', 'documentCheckpointFailed'].includes(code);
    return {title: storage ? 'Saved scan could not be opened' : 'Let’s try that again',
      message: storage ? 'Your saved scan could not be read. Try again without clearing it.' :
        code === 'cancelled' ? 'Your scan is paused. Continue when you are ready.' :
          'The photo could not be completed. Keep the whole card in view and try again.', recovery: fallback};
  }
  private async settle(reveal: boolean) {
    const session = this.current;
    await Promise.allSettled([session?.cancel(), this.activeWork]);
    if (!session || this.closed || this.current !== session) return;
    // A native capture can commit before its event crosses the bridge. Read back the settled
    // snapshot before showing retained results so images and observations remain paired.
    try {
      const observation = await session.documentResult();
      if (!this.closed && this.current === session) this.accept(observation, reveal);
    } catch (error) {
      const code = (error as {code?: string}).code;
      if (code !== 'documentUnavailable') throw error;
    }
  }
  pause = async () => {
    if (this.closed || this.state.sheet || !['front', 'back', 'loading'].includes(this.state.phase)) return;
    const epoch = ++this.epoch;
    const recovery: Recovery = this.state.phase === 'loading' ? 'load' : this.side;
    this.update({busy: true, ready: false, capturing: false,
      sheet: {title: 'Scan paused', message: 'Continue when you are ready. Your saved results are kept.', recovery}});
    try { await this.settle(false); }
    catch (error) { if (epoch === this.epoch) this.update({sheet: this.failure(error, 'snapshot')}); }
    finally { if (epoch === this.epoch) this.update({busy: false}); }
  };
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const recovery = this.state.sheet?.recovery; this.update({sheet: undefined});
    if (recovery === 'load') return this.reload();
    if (recovery === 'recover' && this.state.selected) return this.recoverSaved(this.state.selected);
    if (recovery === 'details' || recovery === 'snapshot') return this.backToDetails();
    return (recovery === 'back' || recovery === 'settings' && this.side === 'back') && this.state.draft?.front
      ? this.startBack() : this.startFront();
  };
  private reload = () => this.run('loading', 'load', async (session, epoch) => {
    const choices = groupDocuments(await session.listDocuments());
    if (epoch !== this.epoch || this.closed) return;
    this.update({saved: choices});
    if (choices.length === 1) {
      this.update({selected: choices[0].captureID});
      const observation = await session.recoverDocument(choices[0].captureID);
      if (epoch === this.epoch && !this.closed) this.accept(observation);
    } else this.update({phase: choices.length ? 'saved' : 'intro'});
  });
  backToDetails = async () => {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({busy: true, capturing: false, ready: false});
    try {
      await this.settle(false);
      if (epoch === this.epoch && !this.closed) this.update({sheet: undefined,
        phase: this.state.completed ? 'result' : this.state.draft?.front ? 'frontReview' : 'intro'});
    } catch (error) { if (epoch === this.epoch) this.update({sheet: this.failure(error, 'snapshot')}); }
    finally { if (epoch === this.epoch) this.update({busy: false}); }
  };
  handoff = async (): Promise<SavedDocumentCapture | undefined> => {
    if (this.closed) return undefined;
    ++this.epoch; this.update({busy: true, ready: false, capturing: false});
    try { await this.settle(false); }
    catch (error) { this.update({busy: false, sheet: this.failure(error, 'snapshot')}); throw error; }
    const document = this.state.completed ?? this.state.draft;
    if (!this.current || !document?.front) { await this.dispose(); return undefined; }
    const result = {session: this.current, document};
    this.closed = true; this.off?.(); this.off = undefined; this.current = undefined;
    return result;
  };
  dispose = async () => {
    this.closed = true; ++this.epoch; this.off?.(); this.off = undefined;
    const session = this.current; this.current = undefined;
    await Promise.allSettled([session?.release(), this.activeWork]);
  };
  private event(event: CaptureEvent) {
    if (event.type === 'previewChanged' && event.kind === 'document') this.update({preview: this.state.preview + 1});
    else if (event.type === 'documentProgress' && ['front', 'back'].includes(this.state.phase)) {
      this.update({ready: event.ready, issue: event.issue});
    } else if (event.type === 'documentCaptured' && ['front', 'back'].includes(this.state.phase)) {
      this.accept(event.observation);
    } else if (event.type === 'failure' && event.capability === 'document') {
      const sheet = this.failure({code: event.code}, this.side);
      void this.failCamera(sheet);
    }
  }
  private async failCamera(sheet: NonNullable<DocumentFlowState['sheet']>) {
    const epoch = ++this.epoch;
    this.update({busy: true, ready: false, capturing: false, sheet});
    try { await this.settle(false); }
    catch (error) { if (epoch === this.epoch) this.update({sheet: this.failure(error, 'snapshot')}); }
    finally { if (epoch === this.epoch) this.update({busy: false}); }
  }
}

/** Capture UUID order is not time order. One explicit choice represents each workflow. */
export function groupDocuments(records: DocumentRecordSummary[]): SavedDocumentChoice[] {
  const choices = new Map<string, SavedDocumentChoice>();
  for (const record of records) {
    const existing = choices.get(record.workflowID);
    if (!existing || record.side === 'back') choices.set(record.workflowID, {
      workflowID: record.workflowID, captureID: record.captureID, hasBack: record.side === 'back' || existing?.hasBack === true,
    });
  }
  return [...choices.values()];
}
