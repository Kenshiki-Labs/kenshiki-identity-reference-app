import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, property } from '../testing/support';
import { Action } from './Action';
import { ButtonRow } from './List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'Symbol' }));

test('grouped action exposes disabled state and handles rejected commands without leaking errors', async () => {
  const onPress = jest.fn(async (): Promise<void> => {
    throw new Error('private native failure');
  });
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<Action grouped label="Retry" disabled onPress={onPress} />);
  });
  expect(property(view.root.findByType(ButtonRow), 'disabled')).toBe(true);
  expect(onPress).not.toHaveBeenCalled();
  await act(async () => {
    view.update(<Action grouped label="Retry" onPress={onPress} />);
  });
  await act(async () => {
    invoke(view.root.findByType(ButtonRow), 'onPress');
  });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(view.toJSON())).toContain('This action could not finish. Try again.');
  expect(JSON.stringify(view.toJSON())).not.toContain('private native failure');
  onPress.mockResolvedValueOnce();
  await act(async () => {
    invoke(view.root.findByType(ButtonRow), 'onPress');
  });
  expect(JSON.stringify(view.toJSON())).not.toContain('This action could not finish. Try again.');
  await act(async () => {
    view.unmount();
  });
});
