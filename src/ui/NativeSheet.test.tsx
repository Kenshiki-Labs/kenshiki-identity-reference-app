import { ActionSheetIOS } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { actionSheets } from '../testing/support';
import { type Confirmation, useConfirmation } from './NativeSheet';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'MockSymbol' }));

function Prompt({ request }: { request: Confirmation | undefined }) {
  useConfirmation(request);
  return null;
}
function question(key: string): Confirmation {
  return {
    key,
    title: `Delete ${key}?`,
    message: `Delete only ${key}`,
    confirm: 'Delete',
    keep: 'Keep',
    onConfirm: jest.fn(),
    onKeep: jest.fn(),
  };
}
afterEach(() => jest.restoreAllMocks());

test('cancel keeps the current check once and duplicate native callbacks cannot delete it', async () => {
  const sheets = actionSheets();
  const dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => {});
  const request = question('current');
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(<Prompt request={request} />);
    });
    expect(sheets.spy).toHaveBeenCalledWith(
      {
        title: request.title,
        message: request.message,
        options: ['Delete', 'Keep'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      expect.any(Function),
    );
    await act(async () => sheets.last().choose(1));
    expect(request.onKeep).toHaveBeenCalledTimes(1);
    await act(async () => {
      sheets.last().choose(0);
      sheets.last().choose(1);
    });
    expect(request.onConfirm).not.toHaveBeenCalled();
    expect(request.onKeep).toHaveBeenCalledTimes(1);
    await act(async () => view.unmount());
    expect(dismiss).not.toHaveBeenCalled();
  } finally {
    await act(async () => view?.unmount());
  }
});

test.each(['unmount', 'clear'] as const)(
  '%s dismisses an unanswered native question and ignores its late callback',
  async (exit) => {
    const sheets = actionSheets();
    const dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => {});
    const request = question('old');
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(<Prompt request={request} />);
      });
      const old = sheets.last();
      await act(async () => {
        if (exit === 'unmount') view.unmount();
        else view.update(<Prompt request={undefined} />);
      });
      expect(dismiss).toHaveBeenCalledTimes(1);
      await act(async () => {
        old.choose(0);
        old.choose(1);
      });
      expect(request.onConfirm).not.toHaveBeenCalled();
      expect(request.onKeep).not.toHaveBeenCalled();
      await act(async () => view.unmount());
      expect(dismiss).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => view?.unmount());
    }
  },
);

test('a replacement question dismisses the old sheet and owns only its own native response', async () => {
  const sheets = actionSheets();
  const dismiss = jest.spyOn(ActionSheetIOS, 'dismissActionSheet').mockImplementation(() => {});
  const first = question('first');
  const second = question('second');
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(<Prompt request={first} />);
    });
    const old = sheets.last();
    await act(async () => view.update(<Prompt request={second} />));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.asked).toHaveLength(2);
    expect(sheets.last().title).toBe(second.title);
    await act(async () => {
      old.choose(0);
      old.choose(1);
    });
    for (const request of [first, second]) {
      expect(request.onConfirm).not.toHaveBeenCalled();
      expect(request.onKeep).not.toHaveBeenCalled();
    }
    await act(async () => {
      sheets.last().choose(0);
      sheets.last().choose(0);
    });
    expect(second.onConfirm).toHaveBeenCalledTimes(1);
    expect(second.onKeep).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(dismiss).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => view?.unmount());
  }
});
