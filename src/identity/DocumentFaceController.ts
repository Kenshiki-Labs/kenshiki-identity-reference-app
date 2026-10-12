import type { CaptureErrorCode, CaptureEvent, DocumentFaceSnapshot } from '@kenshiki/identity-capture';
import { CaptureFlowError } from './CaptureFlowError';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { errorCode } from '../app/HolderText';

export type SavedDocumentFace = SavedDocumentCapture & { snapshot?: DocumentFaceSnapshot };
export type DocumentFaceState = {
  phase: 'intro' | 'preparing' | 'selfie' | 'comparing' | 'result';
  busy: boolean;
  ready: boolean;
  preview: number;
  snapshot: DocumentFaceSnapshot | undefined;
  failure: { code: CaptureErrorCode } | undefined;
};

/** Owns a handed-off license session. The native owner resolves and compares its retained portrait. */
export class DocumentFaceController {
  state: DocumentFaceState = {
    phase: 'intro',
    busy: false,
    ready: false,
    preview: 0,
    snapshot: undefined,
    failure: undefined,
  };
  private closed = false;
  private epoch = 0;
  private active: Promise<void> | undefined;
  private draining: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private off: (() => void) | undefined;
  private captured = false;
  private settlementFailed = false;

  constructor(
    private readonly saved: SavedDocumentCapture,
    private readonly changed: (state: DocumentFaceState) => void,
    private readonly documentOperationID: string,
  ) {
    this.off = saved.session.subscribe((event) => this.event(event), this.fail);
  }
  private update(patch: Partial<DocumentFaceState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private bound(snapshot: DocumentFaceSnapshot) {
    const front = this.saved.document.front;
    if (
      !front ||
      !this.saved.document.back ||
      !this.documentOperationID ||
      snapshot.captureID !== front.captureID ||
      snapshot.sourceSHA256 !== front.sha256 ||
      snapshot.documentOperationID !== this.documentOperationID
    )
      throw new CaptureFlowError('invalidResponse');
    return snapshot;
  }
  private accept(snapshot: DocumentFaceSnapshot) {
    this.update({
      snapshot: this.bound(snapshot),
      phase: snapshot.state === 'completed' ? 'result' : 'intro',
    });
  }
  private run(work: (epoch: number) => Promise<void>) {
    if (this.closed || this.active !== undefined || this.draining !== undefined) return Promise.resolve();
    const epoch = ++this.epoch;
    this.update({ busy: true, failure: undefined });
    const pending = Promise.resolve().then(async () => {
      try {
        if (this.current(epoch)) await work(epoch);
      } catch (error) {
        if (this.current(epoch)) this.fail(error);
      } finally {
        if (this.current(epoch)) this.update({ busy: false });
      }
    });
    this.active = pending;
    pending.then(() => {
      if (this.active === pending) this.active = undefined;
      this.compareWhenReady();
    }, this.fail);
    return pending;
  }
  private current(epoch: number) {
    return !this.closed && epoch === this.epoch;
  }
  open = () =>
    this.settlementFailed
      ? this.pause()
      : this.run(async (epoch) => {
          const snapshot = await this.saved.session.documentFaceSnapshot();
          if (this.current(epoch)) this.accept(snapshot);
        });
  start = (): Promise<void> => {
    if (this.settlementFailed && !this.closed) return this.pause().then(this.start);
    if (this.closed || this.active !== undefined || this.draining !== undefined) return Promise.resolve();
    this.captured = false;
    this.update({ phase: 'preparing', ready: false, snapshot: undefined });
    return this.run(async (epoch) => {
      const snapshot = await this.saved.session.documentFacePrepare(true);
      if (!this.current(epoch)) return;
      this.bound(snapshot);
      this.update({ phase: 'selfie', preview: this.state.preview + 1 });
      await this.saved.session.startSelfie(true);
    });
  };
  capture = () => {
    if (this.state.phase !== 'selfie' || !this.state.ready || this.state.failure) return Promise.resolve();
    return this.run(async () => {
      await this.saved.session.captureSelfie();
    });
  };
  retrySave = () =>
    this.settlementFailed
      ? this.pause()
      : this.run(async (epoch) => {
          const snapshot = await this.saved.session.documentFaceRetrySave();
          if (this.current(epoch)) this.accept(snapshot);
        });
  private compareWhenReady() {
    if (
      this.closed ||
      this.active !== undefined ||
      this.draining !== undefined ||
      !this.captured ||
      this.state.failure
    )
      return;
    this.captured = false;
    this.update({ phase: 'comparing', ready: false });
    this.run(async (epoch) => {
      const snapshot = await this.saved.session.documentFaceCompare();
      if (this.current(epoch)) this.accept(snapshot);
    }).catch(this.fail);
  }
  private event(event: CaptureEvent) {
    if (this.closed || this.draining !== undefined || this.state.failure || this.state.phase !== 'selfie')
      return;
    if (event.type === 'selfieReadiness') this.update({ ready: event.permitsCapture });
    else if (event.type === 'previewChanged' && event.kind === 'selfie')
      this.update({ preview: this.state.preview + 1 });
    else if (event.type === 'documentSelfieCaptured') {
      // The validated event is only a signal. No admission metadata, hash or image is retained here.
      this.captured = true;
      this.update({ ready: false });
      this.compareWhenReady();
    } else if (event.type === 'failure' && event.capability === 'selfie') {
      this.pause().then(() => this.fail({ code: event.code }), this.fail);
    }
  }
  pause = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.draining !== undefined) return this.draining;
    const epoch = ++this.epoch;
    this.captured = false;
    this.update({ busy: true, ready: false, failure: undefined });
    const work = Promise.resolve().then(async () => {
      const [cancelled] = await Promise.allSettled([this.saved.session.cancel(), this.active]);
      if (!this.current(epoch)) return;
      if (cancelled.status === 'rejected') {
        this.settlementFailed = true;
        throw cancelled.reason;
      }
      this.settlementFailed = false;
      const snapshot = await this.saved.session.documentFaceSnapshot();
      if (this.current(epoch)) this.accept(snapshot);
    });
    this.draining = work;
    const settled = () => {
      if (this.draining === work) this.draining = undefined;
      if (this.current(epoch)) this.update({ busy: false });
    };
    work.then(settled, (error) => {
      if (this.current(epoch)) this.fail(error);
      settled();
    });
    return work;
  };
  handoff = async (accept?: (value: SavedDocumentFace) => boolean): Promise<SavedDocumentFace> => {
    if (this.closed) throw new CaptureFlowError('cancelled');
    await this.pause();
    if (this.closed) throw new CaptureFlowError('cancelled');
    const result: SavedDocumentFace = {
      ...this.saved,
      ...(this.state.snapshot === undefined ? {} : { snapshot: this.state.snapshot }),
    };
    if (accept && !accept(result)) throw new CaptureFlowError('contextChanged');
    this.closed = true;
    ++this.epoch;
    this.off?.();
    this.off = undefined;
    return result;
  };
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    const transferred = this.closed;
    this.closed = true;
    ++this.epoch;
    this.captured = false;
    this.off?.();
    this.off = undefined;
    this.disposal = Promise.allSettled([
      transferred ? undefined : this.saved.session.release(),
      this.active,
      this.draining,
    ]).then(([release]) => {
      if (release.status === 'rejected') throw release.reason;
    });
    return this.disposal;
  };
  fail = (error: unknown) => {
    this.captured = false;
    this.update({ ready: false, failure: { code: errorCode(error) ?? 'operationFailed' } });
  };
}
