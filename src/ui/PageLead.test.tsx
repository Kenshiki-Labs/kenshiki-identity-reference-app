import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { property, required } from '../testing/support';
import { PageLead } from './PageLead';
import { color, spacing, text } from './tokens.generated';

test('PageLead separates the accessible headline from supporting text and permits text reflow', async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<PageLead title="A long page headline" description="Supporting explanation" />);
  });
  const [heading, description] = view.root.findAllByType(Text);
  expect(property(required(heading), 'accessibilityRole')).toBe('header');
  expect(property(required(description), 'accessibilityRole')).toBeUndefined();
  expect(StyleSheet.flatten(required(heading).props.style)).toEqual({
    ...text.screenTitle,
    color: color.text,
  });
  expect(StyleSheet.flatten(required(description).props.style)).toEqual({
    ...text.body,
    color: color.secondaryText,
  });
  // No truncation or scaling cap: long translations and accessibility sizes must wrap.
  for (const node of [required(heading), required(description)]) {
    expect(property(node, 'numberOfLines')).toBeUndefined();
    expect(property(node, 'allowFontScaling')).not.toBe(false);
    expect(property(node, 'maxFontSizeMultiplier')).toBeUndefined();
  }
  expect(StyleSheet.flatten(view.root.findByType(View).props.style)).toEqual({ gap: spacing.xs });
  await act(async () => view.unmount());
});

test.each([undefined, ''])(
  'PageLead without supporting text (%s) leaves no empty text row',
  async (description) => {
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<PageLead title="Headline" {...(description === undefined ? {} : { description })} />);
    });
    expect(view.root.findAllByType(Text)).toHaveLength(1);
    expect(property(view.root.findByType(Text), 'children')).toBe('Headline');
    await act(async () => view.unmount());
  },
);
