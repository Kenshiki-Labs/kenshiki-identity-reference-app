import type {
  CaptureEvent, Configuration, FaceComparison, IdentityCaptureSession,
  MRZObservation, PassportObservation, PassportReadOptions,
} from '@kenshiki/identity-capture';

// Host orchestration only. All parsing, acquisition, liveness and comparison use public SDK APIs.
export type Phase = 'intro' | 'scanning' | 'review' | 'reading' | 'passport' |
  'selfie' | 'captured' | 'comparing' | 'result';
type Recovery = 'scan' | 'read' | 'selfie' | 'compare' | 'dismiss';
export type FlowState = {
  phase: Phase; busy: boolean; preview: number; ready: boolean;
  session?: IdentityCaptureSession; mrz?: MRZObservation; passport?: PassportObservation;
  comparison?: FaceComparison; hint?: string; progress?: string;
  sheet?: {kind: 'recovery' | 'restart'; message: string; recovery: Recovery};
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
  constructor(
    private readonly create: (config: Configuration) => Promise<IdentityCaptureSession>,
    private readonly config: Configuration,
    private readonly changed: (state: FlowState) => void,
  ) {}
  private update(patch: Partial<FlowState>) {
    if (this.closed) return;
    this.state = {...this.state, ...patch}; this.changed(this.state);
  }
  private recovery(): Recovery {
    switch (this.state.phase) {
      case 'scanning': return 'scan';
      case 'reading': return 'read';
      case 'selfie': return 'selfie';
      case 'comparing': return 'compare';
      default: return 'dismiss';
    }
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.create(this.config);
    if (epoch !== this.epoch || this.closed) { await session.release(); throw {code: 'cancelled'}; }
    this.current = session;
    this.off = session.subscribe(event => {
      if (!this.closed && this.current === session && !this.state.sheet) this.event(event);
    });
    this.update({session}); return session;
  }
  private async run(phase: Phase, recovery: Recovery,
    work: (session: IdentityCaptureSession) => Promise<Partial<FlowState>>) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({phase, busy: true, sheet: undefined});
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      const patch = await work(session);
      if (epoch === this.epoch && !this.closed) this.update(patch);
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        const code = (error as {code?: string}).code ?? '';
        this.update({ready: false, sheet: {kind: 'recovery',
          recovery: code === 'invalidAccessKey' ? 'scan' : recovery,
          message: errors[code] ?? 'We could not finish this check. Please try again.'}});
      }
    } finally { if (epoch === this.epoch) this.update({busy: false}); }
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
    this.update({passport: undefined, comparison: undefined, progress: 'Connecting to your passport…'});
    return {passport: await session.readPassport({...mrz, consent: true, messages}), phase: 'passport'};
  });
  selfie = () => {
    if (!this.state.busy) this.update({ready: false, hint: 'Place your face inside the oval.', comparison: undefined});
    return this.run('selfie', 'selfie', async session => { await session.startSelfie(true); return {}; });
  };
  capture = () => this.run('selfie', 'selfie', async session => { await session.captureSelfie(); return {}; });
  compare = () => this.run('comparing', 'compare', async session =>
    ({comparison: await session.compareFace(), phase: 'result'}));
  recover = () => {
    if (this.state.busy) return Promise.resolve();
    const recovery = this.state.sheet?.recovery;
    this.update({sheet: undefined});
    switch (recovery) {
      case 'scan': return this.scan(); case 'read': return this.read();
      case 'selfie': return this.selfie(); case 'compare': return this.compare();
      default: return Promise.resolve();
    }
  };
  private async interrupt(sheet: NonNullable<FlowState['sheet']>) {
    const epoch = ++this.epoch;
    this.update({busy: true, ready: false, sheet});
    try { await this.current?.cancel(); }
    finally { if (epoch === this.epoch) this.update({busy: false}); }
  }
  pause = () => {
    if (this.closed || this.state.sheet || (!this.state.busy && this.recovery() === 'dismiss')) return Promise.resolve();
    return this.interrupt({kind: 'recovery', recovery: this.recovery(),
      message: 'Your check is paused. Continue when you are ready.'});
  };
  requestRestart = () => this.interrupt({kind: 'restart', recovery: this.recovery(),
    message: 'Start again with a new passport scan? This clears the captured data from this check.'});
  restart = async () => {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({busy: true}); this.off?.(); this.off = undefined;
    const old = this.current; this.current = undefined;
    await old?.release();
    if (epoch === this.epoch && !this.closed) { this.state = initial(); this.changed(this.state); }
  };
  dispose = async () => {
    this.closed = true; ++this.epoch; this.off?.(); this.off = undefined;
    const old = this.current; this.current = undefined; this.state = initial();
    await old?.release();
  };
  private event(event: CaptureEvent) {
    if (event.type === 'mrzObservation' && this.state.phase === 'scanning') {
      this.update({mrz: event.observation});
    } else if (event.type === 'passportProgress' && this.state.phase === 'reading') {
      const checking = ['transportComplete', 'passiveAuthentication'].includes(event.stage);
      this.update({progress: checking ? 'Checking the passport data…' : 'Keep your phone against the passport…'});
    } else if (event.type === 'previewChanged' && this.state.phase === 'selfie') {
      this.update({preview: this.state.preview + 1});
    } else if (event.type === 'selfieReadiness' && this.state.phase === 'selfie') {
      this.update({ready: event.permitsCapture,
        hint: event.permitsCapture ? 'Hold still.' : hints[event.reason ?? ''] ?? 'Keep looking at the camera.'});
    } else if (event.type === 'selfieCaptured' && this.state.phase === 'selfie') {
      this.update({phase: 'captured', ready: false});
    } else if (event.type === 'failure' &&
      ((event.capability === 'mrz' && this.state.phase === 'scanning') ||
       (event.capability === 'selfie' && this.state.phase === 'selfie'))) {
      void this.interrupt({kind: 'recovery', recovery: this.recovery(),
        message: errors[event.code] ?? 'The camera stopped. Please try again.'});
    }
  }
}
