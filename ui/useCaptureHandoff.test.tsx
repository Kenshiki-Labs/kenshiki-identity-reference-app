import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCaptureHandoff } from './useCaptureHandoff';

test('automatic handoff waits for settled evidence and never loops after failure', async () => {
  const first = {};
  const second = {};
  const failure = new Error('settlement failed');
  const finish = jest.fn(async () => {
    throw failure;
  });
  const fail = jest.fn();
  function Capture({ evidence, ready }: { evidence: object; ready: boolean }) {
    useCaptureHandoff(evidence, ready, finish, fail);
    return null;
  }
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<Capture evidence={first} ready={false} />);
  });
  expect(finish).not.toHaveBeenCalled();
  await act(async () => {
    view.update(<Capture evidence={first} ready />);
  });
  expect(fail).toHaveBeenCalledWith(failure);
  await act(async () => {
    view.update(<Capture evidence={first} ready={false} />);
  });
  await act(async () => {
    view.update(<Capture evidence={first} ready />);
  });
  expect(finish).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.update(<Capture evidence={second} ready />);
  });
  expect(finish).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
});
