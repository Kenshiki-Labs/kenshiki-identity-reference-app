import type { DocumentObservation } from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { invoke, mockSession, property, required } from '../testing/support';
import { DocumentInspection } from './DocumentInspection';
import { t } from '../locales/i18n';

jest.mock('@kenshiki/identity-capture', () => ({
  IdentityDocumentInspection: 'MockDocumentInspection',
}));

const document: DocumentObservation = {
  workflowID: 'workflow',
  front: {
    captureID: 'front',
    sha256: 'front-sha',
    side: 'front',

    pdf417Status: 'notRequested',
    sideCorrespondence: null,
  },
  back: {
    captureID: 'back',
    sha256: 'back-sha',
    side: 'back',

    pdf417Status: 'notRequested',
    sideCorrespondence: null,
  },
};

async function mount() {
  const session = mockSession({ id: 'holder-session' });
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<DocumentInspection result={{ session, document }} />);
  });
  async function select(id: string) {
    await act(async () => {
      await invoke(
        required(
          view.root
            .findAllByProps({ testID: id })
            .filter((node) => typeof node.props.onPress === 'function')
            .at(-1),
        ),
        'onPress',
      );
    });
  }
  function image() {
    const native = view.root.find(
      (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation !== 'portrait',
    );
    return [
      property(native, 'side'),
      property(native, 'representation'),
      property(native, 'sha256'),
      property(native, 'session'),
    ];
  }
  return { view, session, select, image };
}

test('inspection switches side and projection using the original custody hash, without dispatching native commands', async () => {
  const { view, session, select, image } = await mount();
  expect(image()).toEqual(['front', 'original', 'front-sha', session]);
  const native = view.root.find(
    (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation !== 'portrait',
  );
  expect(property(native, 'presentation')).toEqual({
    loading: t('inspection.loading'),
    zoomFit: t('inspection.zoomFit'),
    zoomActual: t('inspection.zoomActual'),
    zoomPixel: t('inspection.zoomPixel'),
    inactive: t('inspection.inactive'),
    deselected: t('inspection.deselected'),
    missing: t('inspection.missing'),
    failed: t('inspection.failed'),
    resourceLimited: t('inspection.resourceLimited'),
    busy: t('inspection.busy'),
    imageLabel: t('inspection.image', {
      side: t('license.result.front'),
      representation: t('inspection.original'),
    }),
  });
  await select('inspect-normalized');
  expect(image()).toEqual(['front', 'normalized', 'front-sha', session]);
  await select('inspect-back');
  expect(image()).toEqual(['back', 'normalized', 'back-sha', session]);
  await select('inspect-spatial');
  expect(image()).toEqual(['back', 'spatial', 'back-sha', session]);
  await select('inspect-original');
  expect(image()).toEqual(['back', 'original', 'back-sha', session]);
  // Every method throws when invoked: selecting a view must not prepare, read, or check a card.
  for (const value of Object.values(session))
    if (jest.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test.each(['holder', 'capture', 'digest'] as const)(
  'changing %s resets the selected representation and side',
  async (change) => {
    const { view, session, select, image } = await mount();
    await select('inspect-back');
    await select('inspect-normalized');
    const nextSession = change === 'holder' ? mockSession({ id: 'next-holder' }) : session;
    const nextDocument = {
      ...document,
      front: {
        ...required(document.front),
        captureID: change === 'capture' ? 'new-front' : 'front',
        sha256: change === 'digest' ? 'new-sha' : 'front-sha',
      },
    };
    await act(async () => {
      view.update(<DocumentInspection result={{ session: nextSession, document: nextDocument }} />);
    });
    expect(image()).toEqual(['front', 'original', nextDocument.front.sha256, nextSession]);
    await act(async () => {
      view.unmount();
    });
  },
);

test('an absent back never offers a back image or silently substitutes front pixels', async () => {
  const { view, session } = await mount();
  await act(async () => {
    view.update(<DocumentInspection result={{ session, document: { ...document, back: null } }} />);
  });
  expect(view.root.findAllByProps({ testID: 'inspect-back' })).toHaveLength(0);
  const native = view.root.find(
    (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation !== 'portrait',
  );
  expect(property(native, 'side')).toBe('front');
  expect(property(native, 'sha256')).toBe('front-sha');
  await act(async () => {
    view.unmount();
  });
});

test('document portrait stays bound to the front when inspecting back features', async () => {
  const { view, session, select } = await mount();
  const panes = view.root.findAll((node) => String(node.type) === 'MockDocumentInspection');
  expect(panes.map((node) => property(node, 'representation'))).toEqual(['portrait', 'original']);
  await select('inspect-back');
  await select('inspect-spatial');
  const portrait = view.root.find(
    (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation === 'portrait',
  );
  expect(property(portrait, 'side')).toBe('front');
  expect(property(portrait, 'sha256')).toBe('front-sha');
  expect(property(portrait, 'session')).toBe(session);
  expect(property(portrait, 'presentation')).toMatchObject({ missing: t('inspection.portraitMissing') });
  await act(async () => {
    view.update(<DocumentInspection result={{ session, document: { ...document, front: null } }} />);
  });
  expect(view.root.findAllByProps({ testID: 'document-portrait' })).toHaveLength(0);
  expect(
    view.root.findAll(
      (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation === 'portrait',
    ),
  ).toHaveLength(0);
  await act(async () => {
    view.unmount();
  });
});
