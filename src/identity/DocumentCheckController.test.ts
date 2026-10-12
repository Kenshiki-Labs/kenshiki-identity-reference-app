import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import {
  DocumentCheckController,
  type DocumentCheckPort,
  type DocumentCheckState,
} from './DocumentCheckController';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';

const initial: DocumentCheckSnapshot = {
  captureID: 'synthetic',
  sourceSHA256: 'digest',
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};
function port(id: string): DocumentCheckPort {
  return {
    id,
    documentCheckRestore: async () => ({ ...initial, captureID: id }),
    documentCheck: async () => initial,
    documentCheckAskAgain: async () => initial,
    documentCheckCorrect: async () => initial,
    cancel: async () => {},
  };
}

test('a disposed session cannot publish an outstanding reply into the next session', async () => {
  let finish: ((value: DocumentCheckSnapshot) => void) | undefined;
  const first = port('first-holder');
  first.documentCheck = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const firstUpdates: DocumentCheckState[] = [];
  const old = new DocumentCheckController(first, (state) => firstUpdates.push(state));
  const pending = old.check();
  await old.dispose();
  const nextUpdates: DocumentCheckState[] = [];
  const next = new DocumentCheckController(port('second-holder'), (state) => nextUpdates.push(state));
  await next.restore();
  if (!finish) throw new Error('The first request did not start');
  const oldCount = firstUpdates.length;
  finish({ ...initial, captureID: 'first-holder' });
  await pending;
  expect(firstUpdates).toHaveLength(oldCount);
  expect(next.state.snapshot?.captureID).toBe('second-holder');
  expect(nextUpdates.every((state) => state.snapshot?.captureID !== 'first-holder')).toBe(true);
});

test('restoration never dispatches a paid check and duplicate presses share occupancy', async () => {
  const session = port('synthetic');
  const check = jest.fn(async () => initial);
  session.documentCheck = check;
  const controller = new DocumentCheckController(session, () => {});
  await controller.restore();
  expect(check).not.toHaveBeenCalled();
  await Promise.all([controller.check(), controller.check()]);
  expect(check).toHaveBeenCalledTimes(1);
});

test('failure is visible even when a provider rejects without an Error object', async () => {
  const session = port('synthetic');
  session.documentCheck = () => Promise.reject(undefined);
  const controller = new DocumentCheckController(session, () => {});
  await controller.check();
  expect(controller.state.failure).toEqual({ cause: undefined });
  expect(controller.state.busy).toBe(false);
});

test('native correction occupancy prevents duplicate sheets and disposal cancels pending entry', async () => {
  const session = port('synthetic');
  let finish: ((value: DocumentCheckSnapshot) => void) | undefined;
  const correction = jest.fn(
    () =>
      new Promise<DocumentCheckSnapshot>((resolve) => {
        finish = resolve;
      }),
  );
  session.documentCheckCorrect = correction;
  session.cancel = jest.fn(async () => {
    finish?.(initial);
  });
  const updates: DocumentCheckState[] = [];
  const controller = new DocumentCheckController(session, (state) => updates.push(state));
  const pending = controller.correct();
  await controller.correct();
  expect(correction).toHaveBeenCalledTimes(1);
  expect(correction).toHaveBeenCalledWith(true, documentCustodyPresentation());
  const count = updates.length;
  await controller.dispose();
  await pending;
  expect(session.cancel).toHaveBeenCalledTimes(1);
  expect(updates).toHaveLength(count);
  expect(controller.state.snapshot).toBeUndefined();
});
