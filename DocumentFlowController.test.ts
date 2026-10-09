import type {
  CaptureEvent,
  CaptureSession,
  DocumentObservation,
  DocumentRecordSummary,
} from '@kenshiki/identity-capture';
import { mockSession as makeSession, required } from './__tests__/support';
import { DocumentFlowController, groupDocuments } from './DocumentFlowController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function tick() {
  for (let i = 0; i < 12; ++i) await Promise.resolve();
}
const front: DocumentObservation = {
  workflowID: 'first',
  front: {
    captureID: 'front',
    sha256: 'front-digest',
    side: 'front',
    pdf417: null,
    pdf417Status: 'notRequested',
    sideCorrespondence: null,
  },
  back: null,
};
const complete: DocumentObservation = {
  ...front,
  back: {
    captureID: 'back',
    sha256: 'back-digest',
    side: 'back',
    pdf417Status: 'readable',
    sideCorrespondence: { jurisdiction: 'matches', documentNumber: 'found', frontReading: 'read' },
    pdf417: {
      status: 'readable',
      fields: { DAC: 'SYNTHETIC', DCS: 'SPECIMEN', DAQ: 'TEST123' },
      version: 10,
      issuerIIN: '636000',
      jurisdictionVersion: 0,
      missingRequiredElements: [],
    },
  },
};
const replacement: DocumentObservation = {
  workflowID: 'second',
  front: { ...required(front.front), captureID: 'new-front', sha256: 'new-front-digest' },
  back: { ...required(complete.back), captureID: 'new-back', sha256: 'new-back-digest' },
};
const records: DocumentRecordSummary[] = [
  { workflowID: 'first', ...required(complete.front) },
  { workflowID: 'first', ...required(complete.back) },
];
function fixture(saved?: DocumentObservation) {
  let listener!: (event: CaptureEvent) => void;
  let snapshot = saved;
  const off = jest.fn();
  const native = {
    id: 'document-session',
    subscribe: jest.fn((fn: (event: CaptureEvent) => void) => {
      listener = fn;
      return off;
    }),
    listDocuments: jest.fn(async (): Promise<DocumentRecordSummary[]> => []),
    recoverDocument: jest.fn(async (_id: string) => {
      snapshot = complete;
      return complete;
    }),
    startDocument: jest.fn(async (_options: { consent: boolean; side: 'front' | 'back' }) => {}),
    captureDocument: jest.fn(async () => {}),
    documentResult: jest.fn(async () => {
      if (!snapshot) throw { code: 'documentUnavailable' };
      return snapshot;
    }),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  };
  const session = makeSession(native);
  const create = jest.fn(async () => session);
  const changed = jest.fn();
  const controller = new DocumentFlowController(
    create,
    {},
    changed,
    saved ? { session, document: saved } : undefined,
  );
  return {
    controller,
    native,
    create,
    changed,
    off,
    session,
    commit: (value: DocumentObservation) => {
      snapshot = value;
    },
    emit: (value: CaptureEvent) => listener(value),
  };
}
function ready(f: ReturnType<typeof fixture>, side: 'front' | 'back') {
  f.emit({ type: 'documentProgress', side, phase: 'capturing', ready: true, issue: null });
}
function captured(f: ReturnType<typeof fixture>, value: DocumentObservation) {
  f.commit(value);
  f.emit({ type: 'documentCaptured', observation: value });
}

test('front and back capture lead to review, completed results and explicit native ownership handoff', async () => {
  const f = fixture();
  const c = f.controller;
  await c.open();
  expect(c.state.phase).toBe('intro');
  await c.startFront();
  ready(f, 'front');
  await c.capture();
  captured(f, front);
  expect(c.state.phase).toBe('frontReview');
  expect(c.state.completed).toBeUndefined();
  await c.startBack();
  ready(f, 'back');
  await c.capture();
  captured(f, complete);
  expect(c.state.phase).toBe('result');
  const result = await c.handoff();
  expect(result).toEqual({ session: f.session, document: complete });
  await c.dispose();
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.native.startDocument.mock.calls).toEqual([
    [{ consent: true, side: 'front' }],
    [{ consent: true, side: 'back' }],
  ]);
});
test('capture waits for readiness and repeated taps cannot start a second command', async () => {
  const f = fixture();
  await f.controller.open();
  await f.controller.startFront();
  await f.controller.capture();
  expect(f.native.captureDocument).not.toHaveBeenCalled();
  const command = deferred<void>();
  f.native.captureDocument.mockImplementationOnce(() => command.promise);
  ready(f, 'front');
  const pending = f.controller.capture();
  await tick();
  ready(f, 'front');
  await f.controller.capture();
  expect(f.native.captureDocument).toHaveBeenCalledTimes(1);
  command.resolve();
  await pending;
  captured(f, front);
  expect(f.controller.state.phase).toBe('frontReview');
});
test('a failed replacement keeps the completed pair and hands off its bound photos', async () => {
  const f = fixture(complete);
  f.native.startDocument.mockRejectedValueOnce({ code: 'backCameraUnavailable' });
  await f.controller.startFront();
  expect(f.controller.state.sheet?.recovery).toBe('details');
  const result = await f.controller.handoff();
  expect(result?.document).toBe(complete);
  expect(f.native.release).not.toHaveBeenCalled();
});
test('cancelling an unfinished back replacement restores the old pair and retries from the front', async () => {
  const f = fixture(complete);
  await f.controller.startFront();
  captured(f, { ...replacement, back: null });
  await f.controller.startBack();
  f.native.cancel.mockImplementationOnce(async () => {
    f.commit(complete);
  });
  await f.controller.pause();
  expect(f.controller.state.completed).toBe(complete);
  expect(f.controller.state.draft).toBeUndefined();
  f.emit({ type: 'documentProgress', side: 'back', phase: 'capturing', ready: true, issue: null });
  expect(f.controller.state.ready).toBe(false);
  await f.controller.retry();
  expect(f.native.startDocument).toHaveBeenLastCalledWith({ consent: true, side: 'front' });
});
test('a first front photo survives backgrounding and can be handed off for a later back capture', async () => {
  const f = fixture();
  await f.controller.open();
  await f.controller.startFront();
  captured(f, front);
  await f.controller.startBack();
  await f.controller.pause();
  const result = await f.controller.handoff();
  expect(result?.document).toBe(front);
  const resumed = new DocumentFlowController(f.create, {}, jest.fn(), result);
  expect(resumed.state.phase).toBe('frontReview');
  await resumed.startBack();
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.native.startDocument).toHaveBeenLastCalledWith({ consent: true, side: 'back' });
});
test('a committed pair whose event is delayed is reconciled before cancelled results are exposed', async () => {
  const f = fixture(complete);
  await f.controller.startFront();
  captured(f, { ...replacement, back: null });
  await f.controller.startBack();
  ready(f, 'back');
  const capture = deferred<void>();
  const cancel = deferred<void>();
  f.native.captureDocument.mockImplementationOnce(() => capture.promise);
  f.native.cancel.mockImplementationOnce(() => cancel.promise);
  const capturing = f.controller.capture();
  await tick();
  const pausing = f.controller.pause();
  f.commit(replacement);
  capture.resolve();
  await capturing;
  expect(f.controller.state.busy).toBe(true);
  cancel.resolve();
  await pausing;
  expect(f.controller.state.completed).toBe(replacement);
  expect(f.controller.state.phase).toBe('back');
  expect((await f.controller.handoff())?.document.back?.sha256).toBe('new-back-digest');
});
test('camera failure waits for the native cancellation boundary before allowing retry', async () => {
  const f = fixture();
  await f.controller.open();
  await f.controller.startFront();
  const cancel = deferred<void>();
  f.native.cancel.mockImplementationOnce(() => cancel.promise);
  f.emit({ type: 'failure', capability: 'document', code: 'captureFailed' });
  expect(f.controller.state.busy).toBe(true);
  await f.controller.retry();
  expect(f.native.startDocument).toHaveBeenCalledTimes(1);
  cancel.resolve();
  await tick();
  await f.controller.retry();
  expect(f.native.startDocument).toHaveBeenCalledTimes(2);
});
test('closing during session creation releases the late session without opening camera or saved records', async () => {
  const f = fixture();
  const created = deferred<CaptureSession>();
  const c = new DocumentFlowController(() => created.promise, {}, jest.fn());
  const opening = c.open();
  await c.dispose();
  created.resolve(f.session);
  await opening;
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.native.listDocuments).not.toHaveBeenCalled();
});
test('release fences queued capture events and unsubscribes only once', async () => {
  const f = fixture();
  await f.controller.open();
  await f.controller.startFront();
  await f.controller.dispose();
  f.emit({ type: 'documentCaptured', observation: complete });
  await f.controller.dispose();
  expect(f.controller.state.completed).toBeUndefined();
  expect(f.off).toHaveBeenCalledTimes(1);
  expect(f.native.release).toHaveBeenCalledTimes(1);
});
test('one saved workflow is restored once without starting the camera', async () => {
  const f = fixture();
  f.native.listDocuments.mockResolvedValueOnce(records);
  await f.controller.open();
  expect(f.controller.state.phase).toBe('result');
  expect(f.native.recoverDocument).toHaveBeenCalledWith('back');
  expect(f.native.startDocument).not.toHaveBeenCalled();
});
test('multiple saved workflows require explicit choice and group both sides into one item', async () => {
  const f = fixture();
  const second = { workflowID: 'second', ...required(replacement.front) };
  f.native.listDocuments.mockResolvedValueOnce([...records, second]);
  await f.controller.open();
  expect(f.controller.state.phase).toBe('saved');
  expect(f.controller.state.saved).toHaveLength(2);
  expect(f.native.recoverDocument).not.toHaveBeenCalled();
  await f.controller.recoverSaved('new-front');
  expect(f.native.recoverDocument).toHaveBeenCalledWith('new-front');
  expect(groupDocuments([required(records[1]), required(records[0])])).toEqual([
    { workflowID: 'first', captureID: 'back', hasBack: true },
  ]);
});
test('saved-list and recovery failures cannot masquerade as an empty store or start a new scan', async () => {
  const f = fixture();
  f.native.listDocuments.mockRejectedValueOnce({ code: 'documentCustodyFailed' });
  await f.controller.open();
  expect(f.controller.state.sheet?.title).toBe('Saved scan could not be opened');
  expect(f.controller.state.phase).toBe('loading');
  expect(f.native.startDocument).not.toHaveBeenCalled();
  f.native.listDocuments.mockResolvedValueOnce(records);
  f.native.recoverDocument.mockRejectedValueOnce({ code: 'documentCheckpointFailed' });
  await f.controller.retry();
  expect(f.controller.state.sheet?.title).toBe('Saved scan could not be opened');
  expect(f.native.startDocument).not.toHaveBeenCalled();
});
test('only the explicit no-evidence result permits an empty exit; damaged custody keeps a recovery sheet', async () => {
  const f = fixture();
  await f.controller.open();
  expect(await f.controller.handoff()).toBeUndefined();
  expect(f.native.release).toHaveBeenCalledTimes(1);
  const corrupt = fixture(complete);
  corrupt.native.documentResult.mockRejectedValueOnce({ code: 'documentCustodyFailed' });
  await expect(corrupt.controller.handoff()).rejects.toEqual({ code: 'documentCustodyFailed' });
  expect(corrupt.controller.state.sheet?.recovery).toBe('snapshot');
  expect(corrupt.native.release).not.toHaveBeenCalled();
  expect(corrupt.controller.state.completed).toBe(complete);
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
