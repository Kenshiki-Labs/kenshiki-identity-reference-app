import renderer, { act } from 'react-test-renderer';
import { IdentityDocumentInspection } from '../../ReactNative/identity-capture/src/index';
import { property } from './__tests__/support';

jest.mock('../../ReactNative/identity-capture/src/specs/NativeIdentityCapture', () => ({
  __esModule: true,
  default: {},
}));
jest.mock(
  '../../ReactNative/identity-capture/src/specs/IdentityCapturePreviewNativeComponent',
  () => 'NativePreview',
);

const presentation = {
  loading: 'Chargement…',
  inactive: 'Masquée',
  deselected: 'Non sélectionnée',
  missing: 'Image absente',
  failed: 'Vérification refusée',
  imageLabel: 'Face avant',
};

test.each([
  ['front', 'original', 'documentFrontInspection'],
  ['back', 'original', 'documentBackInspection'],
  ['front', 'normalized', 'documentFrontNormalizedInspection'],
  ['back', 'normalized', 'documentBackNormalizedInspection'],
  ['front', 'spatial', 'documentFrontSpatialInspection'],
  ['back', 'spatial', 'documentBackSpatialInspection'],
  ['front', 'portrait', 'documentFrontPortraitInspection'],
] as const)('%s %s is projected with the same original custody hash', async (side, representation, kind) => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <IdentityDocumentInspection
        session={{ id: 'opaque-session' }}
        side={side}
        representation={representation}
        sha256="original-hash"
        presentation={presentation}
      />,
    );
  });
  const native = view.root.find((node) => String(node.type) === 'NativePreview');
  expect(property(native, 'sessionId')).toBe('opaque-session');
  expect(property(native, 'imageSHA256')).toBe('original-hash');
  expect(property(native, 'kind')).toBe(kind);
  expect(property(native, 'inspectionPresentation')).toBe(JSON.stringify(presentation));
  expect(Object.keys(native.props).sort()).toEqual([
    'imageSHA256',
    'inspectionPresentation',
    'kind',
    'sessionId',
  ]);
  await act(async () => {
    view.unmount();
  });
});

test('a back portrait request never falls back to front or selfie pixels', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <IdentityDocumentInspection
        session={{ id: 'opaque-session' }}
        side="back"
        representation="portrait"
        sha256="back-hash"
        presentation={presentation}
      />,
    );
  });
  expect(view.root.findAll((node) => String(node.type) === 'NativePreview')).toHaveLength(0);
  await act(async () => {
    view.unmount();
  });
});
