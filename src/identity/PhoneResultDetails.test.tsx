import type { PhoneCheckReceipt } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { completedPhone } from '../testing/phoneFixture';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import { PhoneResultDetails } from './PhoneResultDetails';
import { Action } from '../ui/Action';
import { ListSection, ValueRow } from '../ui/List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'IdentitySymbol' }));
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
const receipt = required(completedPhone.receipt);
async function render(value: PhoneCheckReceipt, disabled = false) {
  const session = mockSession({ phoneDetails: jest.fn(async () => {}) });
  await act(async () => {
    view = create(<PhoneResultDetails receipt={value} session={session} disabled={disabled} />);
  });
  return session;
}
function value(label: string) {
  return property(
    required(view.root.findAllByType(ValueRow).find((row) => property(row, 'label') === label)),
    'value',
  );
}
function details() {
  return required(
    view.root.findAllByType(Action).find((node) => property(node, 'testID') === 'phone-native-details'),
  );
}

test('safe comparison and timing stay visible; personal details require an explicit native sheet', async () => {
  const session = await render({
    ...receipt,
    subjectComparison: { status: 'singleSource', checkedAt: receipt.completedAt },
  });
  expect(value('Reported outcome')).toBe('One source reports agreement');
  expect(JSON.stringify(view.toJSON())).not.toContain('12025550123');
  expect(JSON.stringify(view.toJSON())).not.toContain('a'.repeat(64));
  expect(session.phoneDetails).not.toHaveBeenCalled();
  await act(async () => {
    await invoke(details(), 'onPress');
  });
  expect(session.phoneDetails).toHaveBeenCalledTimes(1);
  expect(session.phoneDetails.mock.calls[0]).toHaveLength(1);
  expect(session.phoneSend).not.toHaveBeenCalled();
  expect(session.phoneResume).not.toHaveBeenCalled();
});

test('absent comparison never fabricates agreement or a provider observation', async () => {
  await render(receipt);
  expect(value('Reported outcome')).toBe('No comparison returned');
  const text = JSON.stringify(view.toJSON());
  expect(text).not.toContain('Subscriber details agree');
  expect(text).not.toContain('Number check 1');
});

test('contradiction stops the check while preserving that the text was received', async () => {
  await render({ ...receipt, subjectComparison: { status: 'contradicted', checkedAt: receipt.completedAt } });
  expect(property(required(view.root.findAllByType(ListSection)[0]), 'header')).toBe(
    'Comparison did not meet the policy',
  );
  expect(value('Reported outcome')).toBe('Subscriber details differ');
  expect(JSON.stringify(view.toJSON())).toContain('Your text was received');
  expect(JSON.stringify(view.toJSON())).not.toContain('Phone possession confirmed');
});

test('native details cannot overlap an outstanding opening or other phone operation', async () => {
  const session = await render(receipt);
  let finish!: () => void;
  session.phoneDetails.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let opening: unknown;
  await act(async () => {
    opening = invoke(details(), 'onPress');
    invoke(details(), 'onPress');
    await settle();
  });
  expect(session.phoneDetails).toHaveBeenCalledTimes(1);
  expect(property(details(), 'disabled')).toBe(true);
  await act(async () => {
    finish();
    await opening;
  });
  expect(property(details(), 'disabled')).toBe(false);
  await act(async () => {
    view.update(<PhoneResultDetails receipt={receipt} session={session} disabled />);
  });
  await act(async () => {
    await invoke(details(), 'onPress');
  });
  expect(session.phoneDetails).toHaveBeenCalledTimes(1);
});
