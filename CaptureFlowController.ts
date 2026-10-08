import type {
  CaptureEvent, Configuration, FaceComparison, IdentityCaptureSession,
  MRZObservation, PassportObservation, PassportReadOptions, CompletedResultDescriptor,
} from '@kenshiki/identity-capture';

// Host orchestration only. All parsing, acquisition, liveness and comparison use public SDK APIs.
export type Phase = 'loading' | 'saved' | 'intro' | 'scanning' | 'review' | 'reading' | 'passport' |
  'selfie' | 'captured' | 'comparing' | 'result';
type Recovery = 'load' | 'save' | 'scan' | 'read' | 'selfie' | 'compare' | 'dismiss' | 'settings' | 'details';
export type FlowState = {
  saved?: CompletedResultDescriptor[];
  phase: Phase; busy: boolean; preview: number; ready: boolean;
  session?: IdentityCaptureSession; mrz?: MRZObservation; passport?: PassportObservation;
  passportMRZ?: MRZObservation;
  comparison?: FaceComparison; hint?: string; progress?: string;
  sheet?: {kind: 'recovery' | 'restart'; message: string; recovery: Recovery};
};
/** The receiving app owns this review session. Configured encrypted results survive its release. */
export type CompletedCapture = {
  session: IdentityCaptureSession; mrz?: MRZObservation; passport: PassportObservation;
  comparison?: FaceComparison;
};
const initial = (): FlowState => ({phase: 'intro', busy: false, preview: 0, ready: false});
const messages: PassportReadOptions['messages'] = {
  presenting: 'Hold the top of your phone against your passport.',
  authenticating: 'Connecting — {progress}%', reading: 'Reading passport — {progress}%',
  activeAuthentication: 'Checking the chip.', transportFinishing: 'Read complete.',
  failure: 'We could not finish reading your passport. Please try again.',
};
const errors: Record<string, string> = {
  unavailable: 'This device cannot start this camera check.',
  unsupported: 'This device cannot read a passport chip.',
  cameraPermissionDenied: 'Allow camera access in Settings, then try again.',
  cameraPermissionRestricted: 'Camera access is restricted on this device.',
  trustAnchorsUnavailable: 'Passport verification is not available. Please contact support.',
  trustAnchorNotFound: 'We could not verify this passport’s issuer. Please contact support.',
  invalidConfiguration: 'This check is not configured. Please contact support.',
  connectionLost: 'The connection to your passport was lost. Hold the phone still and try again.',
  multipleTags: 'Move other contactless cards away and try again.',
  dataIntegrityFailure: 'We could not verify the passport data. Try reading the passport again.',
  invalidAccessKey: 'The printed details could not open the chip. Scan your passport again.',
  cancelled: 'The check was stopped. You can try again when you are ready.',
  depthUnavailable: 'We could not measure your face. Clear the front camera and try again.',
  busy: 'The previous camera request is still finishing. Wait a moment, then try again.',
};
const hints: Record<string, string> = {
  noFaceObserved: 'Place your face inside the oval.', outsideGuide: 'Move your face inside the oval.',
  multipleFacesObserved: 'Only one person should be in view.',
  eyesClosed: 'Open your eyes.', blinkNotObserved: 'Blink once, then open your eyes.',
  blinkExpired: 'Blink once more, then keep your eyes open.',
  depthFlat: 'Look directly at the camera with your face inside the oval.',
  depthUnavailable: 'Clear the front camera and keep your face in view.',
};

export class CaptureFlowController {
  state: FlowState = initial();
  private epoch = 0;
  private closed = false;
  private off?: () => void;
  private current?: IdentityCaptureSession;
  private pendingComparison = false;
  private activeWork?: Promise<Partial<FlowState>>;
  constructor(
    private readonly create: (config: Configuration) => Promise<IdentityCaptureSession>,
    private readonly config: Configuration,
    private readonly changed: (state: FlowState) => void,
    completed?: CompletedCapture,
  ) {
    if (completed) {
      this.current = completed.session;
      this.state = {...initial(), ...completed, passportMRZ: completed.mrz,
        phase: completed.comparison ? 'result' : 'passport'};
      this.listen(completed.session);
    }
  }
  private update(patch: Partial<FlowState>) {
    if (this.closed) return;
    this.state = {...this.state, ...patch}; this.changed(this.state);
  }
  open = () => {
    if (this.current || !this.config.results) return Promise.resolve();
    return this.run('loading', 'load', async session => {
      const saved = (await session.listResults()).filter(record => record.kind === 'passport-read-v1');
      if (saved.length === 1) return this.restore(session, saved[0].workflowID);
      return {saved, phase: saved.length ? 'saved' : 'intro'};
    });
  };
  recoverSaved = (workflowID: string) => this.run('loading', 'load', session => this.restore(session, workflowID));
  private async restore(session: IdentityCaptureSession, workflowID: string): Promise<Partial<FlowState>> {
    const records = await session.listResults();
    const passport = await session.recoverPassport(workflowID);
    const face = records.find(record => record.workflowID === workflowID && record.kind === 'face-comparison-v1');
    // An earlier face result must never be shown against a replacement passport photo.
    const comparison = face?.artifacts.some(artifact => artifact.role === 'reference' && artifact.sha256 === passport.portraitSHA256)
      ? await session.recoverFace(workflowID) : undefined;
    return {passport, mrz: passport.printedMRZ, passportMRZ: passport.printedMRZ,
      comparison, phase: comparison ? 'result' : 'passport'};
  }
  private recovery(): Recovery {
    switch (this.state.phase) {
      case 'scanning': return 'scan';
      case 'reading': return 'read';
      case 'selfie': return 'selfie';
      case 'comparing': return 'selfie';
      default: return 'dismiss';
    }
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.create(this.config);
    if (epoch !== this.epoch || this.closed) { await session.release(); throw {code: 'cancelled'}; }
    this.current = session;
    this.listen(session);
    this.update({session}); return session;
  }
  private listen(session: IdentityCaptureSession) {
    this.off = session.subscribe(event => {
      if (!this.closed && this.current === session && !this.state.sheet) this.event(event);
    });
  }
  private async run(phase: Phase, recovery: Recovery,
    work: (session: IdentityCaptureSession) => Promise<Partial<FlowState>>) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({phase, busy: true, sheet: undefined});
    let pending: Promise<Partial<FlowState>> | undefined;
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      pending = work(session);
      this.activeWork = pending;
      const patch = await pending;
      if (epoch === this.epoch && !this.closed) this.update(patch);
      else if (!this.closed && this.current === session && ('passport' in patch || 'comparison' in patch)) {
        // Native completion can win before cancel while its Promise is still crossing the
        // bridge. Reconcile committed evidence, without reopening the interrupted screen.
        const {phase: _phase, ...evidence} = patch;
        this.update(evidence);
        const sheet = this.state.sheet;
        if (sheet) this.update({sheet: {...sheet, recovery: 'details',
          message: sheet.kind === 'recovery' ? 'This check completed. Your results are ready to review.' : sheet.message}});
      }
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        const code = (error as {code?: string}).code ?? '';
        if (code === 'cancelled' && phase === 'reading') {
          this.update({phase: this.resultsPhase(), mrz: this.state.passportMRZ ?? this.state.mrz,
            progress: undefined, sheet: undefined});
          return;
        }
        const next = code === 'resultSaveFailed' ? 'save' : this.errorRecovery(code, recovery);
        this.update({ready: false, sheet: {kind: 'recovery',
          recovery: next,
          message: code === 'resultSaveFailed' ? 'The check completed, but its result could not be saved. Try saving again without repeating the check.' : errors[code] ?? 'We could not finish this check. Please try again.'}});
      }
    } finally {
      if (this.activeWork === pending) this.activeWork = undefined;
      if (epoch === this.epoch) { this.update({busy: false}); this.compareWhenReady(); }
    }
  }
  scan = () => {
    if (!this.state.busy) this.update({mrz: undefined, ready: false});
    return this.run('scanning', 'scan', async session => { await session.startMRZ(true); return {}; });
  };
  review = () => this.run('scanning', 'scan', async session =>
    ({mrz: await session.captureMRZ(), phase: 'review'}));
  read = () => this.run('reading', 'read', async session => {
    const mrz = this.state.mrz;
    if (!mrz) throw {code: 'invalidAccessKey'};
    this.update({progress: 'Connecting to your passport…'});
    return {passport: await session.readPassport({...mrz, consent: true, messages}), passportMRZ: mrz,
      comparison: undefined, phase: 'passport'};
  });
  selfie = () => {
    if (this.closed || this.state.busy) return Promise.resolve();
    if (Object.values(this.state.passport?.correspondence ?? {}).includes('differs')) {
      this.update({sheet: {kind: 'recovery', recovery: 'scan',
        message: 'The printed details and chip differ. Scan the passport again before comparing a selfie.'}});
      return Promise.resolve();
    }
    this.update({ready: false, hint: 'Place your face inside the oval.'});
    return this.run('selfie', 'selfie', async session => { await session.startSelfie(true); return {}; });
  };
  capture = () => this.run('selfie', 'selfie', async session => { await session.captureSelfie(); return {}; });
  compare = () => this.run('comparing', 'selfie', async session =>
    ({comparison: await session.compareFace(), phase: 'result'}));
  recover = () => {
    if (this.state.busy) return Promise.resolve();
    const recovery = this.state.sheet?.recovery;
    this.update({sheet: undefined});
    switch (recovery) {
      case 'load': return this.run('loading', 'load', async session => {
        const saved = (await session.listResults()).filter(record => record.kind === 'passport-read-v1');
        return {saved, phase: saved.length ? 'saved' : 'intro'};
      });
      case 'save': return this.run(this.state.phase, 'save', async session => {
        const saved = await session.retryResultSave();
        return 'documentNumber' in saved
          ? {passport: saved, mrz: saved.printedMRZ, passportMRZ: saved.printedMRZ, comparison: undefined, phase: 'passport'}
          : {comparison: saved, phase: 'result'};
      });
      case 'scan': return this.scan(); case 'read': return this.read();
      case 'selfie': return this.selfie(); case 'compare': return this.compare();
      case 'settings': return this.state.phase === 'selfie' ? this.selfie() : this.scan();
      case 'details': this.update({phase: this.resultsPhase(), mrz: this.state.passportMRZ ?? this.state.mrz}); return Promise.resolve();
      default: return Promise.resolve();
    }
  };
  private resultsPhase(): Phase {
    return this.state.passport ? this.state.comparison ? 'result' : 'passport' : this.state.mrz ? 'review' : 'intro';
  }
  private errorRecovery(code: string, fallback: Recovery): Recovery {
    if (code === 'cameraPermissionDenied') return 'settings';
    if (['unavailable', 'unsupported', 'cameraPermissionRestricted', 'trustAnchorsUnavailable',
      'trustAnchorNotFound', 'invalidConfiguration'].includes(code)) return 'details';
    if (code === 'invalidAccessKey') return 'scan';
    if (['invalidCapture', 'depthEvidenceUnavailable', 'selfieUnavailable', 'comparisonUnavailable'].includes(code)) return 'selfie';
    if (['invalidReference', 'referenceUnavailable'].includes(code)) return 'read';
    return fallback;
  }
  private async interrupt(sheet: NonNullable<FlowState['sheet']>) {
    const epoch = ++this.epoch;
    this.pendingComparison = false;
    this.update({busy: true, ready: false, sheet});
    const pending = this.activeWork;
    try { await Promise.allSettled([this.current?.cancel(), pending]); }
    finally { if (epoch === this.epoch) this.update({busy: false}); }
  }
  pause = () => {
    if (this.closed || this.state.sheet || (!this.state.busy && this.recovery() === 'dismiss')) return Promise.resolve();
    return this.interrupt({kind: 'recovery', recovery: this.recovery(),
      message: 'Your check is paused. Continue when you are ready.'});
  };
  requestRestart = () => this.interrupt({kind: 'restart', recovery: this.recovery(),
    message: 'Start a new passport scan? Previously saved results stay on this phone until you erase them.'});
  restart = async () => {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.pendingComparison = false;
    this.update({busy: true}); this.off?.(); this.off = undefined;
    const old = this.current; this.current = undefined;
    await Promise.allSettled([old?.release(), this.activeWork]);
    if (epoch === this.epoch && !this.closed) { this.state = initial(); this.changed(this.state); }
  };
  dispose = async () => {
    this.pendingComparison = false;
    this.closed = true; ++this.epoch; this.off?.(); this.off = undefined;
    const old = this.current; this.current = undefined; this.state = initial();
    await Promise.allSettled([old?.release(), this.activeWork]);
  };
  /** Transfers ownership before the flow unmounts. No evidence is released by this method. */
  handoff = async (): Promise<CompletedCapture> => {
    if (this.closed || this.state.busy || !this.current || !this.state.passport) {
      throw new Error('No completed passport check is ready');
    }
    const result = {session: this.current, mrz: this.state.passportMRZ,
      passport: this.state.passport, comparison: this.state.comparison};
    this.closed = true; ++this.epoch; this.pendingComparison = false;
    this.off?.(); this.off = undefined; this.current = undefined;
    this.state = initial();
    await result.session.cancel();
    return result;
  };
  private compareWhenReady() {
    if (this.pendingComparison && !this.closed && !this.state.busy && !this.state.sheet) {
      this.pendingComparison = false;
      void this.compare();
    }
  }
  private event(event: CaptureEvent) {
    if (event.type === 'mrzObservation' && this.state.phase === 'scanning') {
      this.update({mrz: event.observation});
    } else if (event.type === 'passportProgress' && this.state.phase === 'reading') {
      const checking = ['transportComplete', 'passiveAuthentication'].includes(event.stage);
      const progress = event.progress != null && Number.isFinite(event.progress)
        ? ` — ${Math.round(Math.max(0, Math.min(100, event.progress)))}%` : '';
      const group = event.group && /^(DG\d{1,2}|SOD|COM)$/.test(event.group) ? ` (${event.group})` : '';
      this.update({progress: checking ? 'Checking the passport data…' :
        event.stage === 'reading' ? `Reading passport${group}${progress}. Keep your phone still.` :
        event.stage === 'authenticating' ? `Connecting${progress}. Keep your phone still.` : 'Keep your phone against the passport…'});
    } else if (event.type === 'previewChanged' && this.state.phase === 'selfie') {
      this.update({preview: this.state.preview + 1});
    } else if (event.type === 'selfieReadiness' && this.state.phase === 'selfie') {
      this.update({ready: event.permitsCapture,
        hint: event.permitsCapture ? 'Hold still.' : hints[event.reason ?? ''] ?? 'Keep looking at the camera.'});
    } else if (event.type === 'selfieCaptured' && this.state.phase === 'selfie') {
      this.update({phase: 'captured', ready: false});
      this.pendingComparison = true;
      this.compareWhenReady();
    } else if (event.type === 'failure' &&
      ((event.capability === 'mrz' && this.state.phase === 'scanning') ||
       (event.capability === 'selfie' && this.state.phase === 'selfie'))) {
      void this.interrupt({kind: 'recovery', recovery: this.errorRecovery(event.code, this.recovery()),
        message: errors[event.code] ?? 'The camera stopped. Please try again.'});
    }
  }
}
