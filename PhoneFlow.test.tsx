import React from 'react';
import {AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import type {CaptureEvent, PhoneCheckReceipt, PhoneCheckSnapshot} from '@kenshiki/identity-capture';
import App from './App';
import {PhoneResultDetails} from './PhoneFlow';

const mockReady: PhoneCheckSnapshot = {stage: 'start', busy: false, failure: null, pending: false, sent: false,
  challengeReserved: false, receipt: null, recordedAt: null, sendAgainAt: null};
const mockReceipt: PhoneCheckReceipt = {challengeID: 'synthetic', sender: '12025550123', messageHash: 'a'.repeat(64),
  receivedAt: '2026-10-08T12:00:00Z', completedAt: '2026-10-08T12:00:01Z', subjectComparison: {
    status: 'contradicted', fieldsCompared: ['givenName'], checkedAt: '2026-10-08T12:00:01Z',
    evidence: {requestID: 'synthetic', providers: [{source: 'twilio', answered: true, carrier: 'Synthetic carrier',
      smsFraudRiskScore: 0, numberValid: false}, {source: 'vonage', answered: false, failure: 'timed_out'}],
      fields: [{field: 'givenName', source: 'twilio', grade: 'no_match'}, {field: 'extra', source: 'unknown', grade: 'future'}]},
  }};
let mockSnapshot = mockReady;
let mockListener: ((event: CaptureEvent) => void) | undefined;
const mockSession = {
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => { mockListener = listener; return () => { mockListener = undefined; }; }),
  phoneSnapshot: jest.fn(async () => mockSnapshot), phoneCancel: jest.fn(async () => mockSnapshot),
  phoneSend: jest.fn(async () => { mockSnapshot = {...mockReady, stage: 'waiting', pending: true, sent: true, challengeReserved: true}; return mockSnapshot; }),
  phoneResume: jest.fn(async () => mockSnapshot), phoneRetrySave: jest.fn(async () => mockSnapshot),
  phoneStartOver: jest.fn(async () => mockSnapshot), phoneErase: jest.fn(async () => {}), release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async () => mockSession)},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));
beforeEach(() => { jest.clearAllMocks(); mockSnapshot = mockReady; mockListener = undefined; });
async function renderApp() {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App />); });
  async function tap(id: string) {
    await act(async () => {
      const button = view.root.findAllByProps({testID: id}).filter(node => typeof node.props.onPress === 'function').at(-1)!;
      await button.props.onPress();
    });
  }
  return {view, tap};
}
test('Phone opens from Identity, sending waits for receipt, Done and reopen keep all findings', async () => {
  const {view, tap} = await renderApp(); await tap('open-phone');
  expect(mockSession.phoneSend).not.toHaveBeenCalled(); await tap('phone-send');
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for your text');
  expect(view.root.findAllByProps({testID: 'phone-result'})).toHaveLength(0);
  await act(async () => {
    mockSnapshot = {...mockReady, stage: 'completed', receipt: mockReceipt};
    mockListener?.({type: 'phoneSnapshot', snapshot: mockSnapshot});
  });
  let shown = JSON.stringify(view.toJSON());
  for (const value of ['12025550123', 'Subscriber details differ', 'Synthetic carrier', 'Does not match', 'Unrecognized result (future)', 'SMS fraud risk score', 'Number valid', 'Not returned']) expect(shown).toContain(value);
  expect(shown).not.toContain('Subscriber details agree');
  await tap('phone-receipt-details');
  expect(JSON.stringify(view.toJSON())).toContain('a'.repeat(64));
  await tap('phone-done'); await tap('open-phone');
  shown = JSON.stringify(view.toJSON()); expect(shown).toContain('Synthetic carrier');
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1); expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); }); expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('a new check requires a bottom-sheet confirmation', async () => {
  mockSnapshot = {...mockReady, stage: 'completed', receipt: mockReceipt};
  const {view, tap} = await renderApp(); await tap('open-phone'); await tap('phone-new');
  expect(view.root.findByProps({testID: 'phone-bottom-sheet'})).toBeDefined();
  expect(mockSession.phoneStartOver).not.toHaveBeenCalled(); await tap('phone-confirm');
  expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
  await act(async () => { view.unmount(); });
});
test('inactive message-composer transitions do not cancel; actual backgrounding pauses', async () => {
  let change: ((state: AppStateStatus) => void) | undefined;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, listener) => {
    change = listener; return {remove: jest.fn()};
  });
  const {view, tap} = await renderApp(); await tap('open-phone');
  await act(async () => { change?.('inactive'); }); expect(mockSession.phoneCancel).not.toHaveBeenCalled();
  await act(async () => { change?.('background'); }); expect(mockSession.phoneCancel).toHaveBeenCalledTimes(1);
  await act(async () => { view.unmount(); }); spy.mockRestore();
});
test('older receipts explicitly explain missing details without triggering a new check', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<PhoneResultDetails receipt={{...mockReceipt, subjectComparison: undefined}} />); });
  expect(JSON.stringify(view.toJSON())).toContain('Provider details are not present in this saved receipt');
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
