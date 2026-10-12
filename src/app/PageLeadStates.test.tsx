import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import '../testing/support';
import { IdentityPrerequisiteGate } from './IdentityPrerequisiteGate';
import { ControllerStartup } from '../ui/ControllerStartup';
import { PageLead } from '../ui/PageLead';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'MockSymbol' }));

test.each([false, true])('controller startup retains its page lead with failure=%s', async (failed) => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerStartup
        title="Phone"
        lead={<PageLead title="Your phone check" description="Check access to your number." />}
        failed={failed}
        cancelStartup={jest.fn()}
        onClose={jest.fn()}
        loadingMessage="Opening"
      />,
    );
  });
  expect(view.root.findAllByType(PageLead)).toHaveLength(1);
  expect(view.root.findAllByProps({ testID: 'page-title' })).toHaveLength(0);
  expect(
    view.root.findAllByType(Text).filter((node) => node.props.accessibilityRole === 'alert'),
  ).toHaveLength(failed ? 1 : 0);
  await act(async () => view.unmount());
});

test.each(['document', 'phone', 'service'] as const)(
  'the %s prerequisite uses one explanation in its lead without mounting the flow',
  async (reason) => {
    const flow = jest.fn(() => <Text>Service flow</Text>);
    const Flow = flow;
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <IdentityPrerequisiteGate reason={reason} onExit={jest.fn()}>
          <Flow />
        </IdentityPrerequisiteGate>,
      );
    });
    const lead = view.root.findByType(PageLead);
    expect(lead.props.title).toBe('Complete the earlier checks');
    expect(
      view.root.findAllByType(Text).filter((node) => node.props.children === lead.props.description),
    ).toHaveLength(1);
    expect(flow).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);
