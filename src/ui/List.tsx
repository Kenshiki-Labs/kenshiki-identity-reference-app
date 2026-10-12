import { IdentitySymbol } from '@kenshiki/identity-capture';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { t } from '../locales/i18n';
import { color, opacity, radius, size, spacing, symbol, symbolTint, text } from './tokens.generated';

/** An inset grouped section, as UITableView draws one: an optional header above the rounded cells,
 * a hairline between two rows, and an optional footer below. Each child is one row, so pass rows
 * directly or as an array, never wrapped in a fragment. Separators align with the row text.
 *
 * `headerIcon={null}` gives documentation sections a prominent title. Without it the header
 * uses the quiet grouped-list style. */
export function ListSection({
  children,
  header,
  headerIcon,
  footer,
  testID,
}: Readonly<{
  children: ReactNode;
  header?: string | undefined;
  headerIcon?: ReactNode;
  footer?: string | undefined;
  testID?: string | undefined;
}>) {
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <View style={listStyles.section} testID={testID}>
      {header ? (
        headerIcon === undefined ? (
          <Text accessibilityRole="header" style={listStyles.note}>
            {header}
          </Text>
        ) : (
          <View style={listStyles.prominentHeader}>
            {headerIcon}
            <Text
              accessibilityRole="header"
              style={headerIcon === null ? listStyles.pageTitle : listStyles.prominentTitle}
            >
              {header}
            </Text>
          </View>
        )
      ) : null}
      <View style={listStyles.group}>
        {rows.map((row, index) =>
          isValidElement(row) ? (
            <Fragment key={row.key}>
              {index > 0 && <View style={listStyles.separator} />}
              {row}
            </Fragment>
          ) : null,
        )}
      </View>
      {footer ? <Text style={listStyles.note}>{footer}</Text> : null}
    </View>
  );
}

/** One row that opens something: a title, an optional status line, and the
 * disclosure chevron when it opens a screen. `rowID` becomes the pressable's testID, so the
 * pressable itself carries the disabled state. The row speaks its own words, not its icons'. Text
 * sets the row's height, so Dynamic Type reflows it. */
export function ListRow({
  label,
  status,
  description,
  onPress,
  rowID,
  disabled = false,
  destructive = false,
  chevron = true,
}: Readonly<{
  label: string;
  status?: string | undefined;
  description?: string;
  onPress: () => void;
  rowID?: string | undefined;
  disabled?: boolean | undefined;
  destructive?: boolean | undefined;
  chevron?: boolean | undefined;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[status ? t('common.labelAndStatus', { label, status }) : label, description]
        .filter(Boolean)
        .join('\n')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={rowID}
      onPress={onPress}
      style={({ pressed }) => [listStyles.row, pressed && listStyles.pressed]}
    >
      <View style={[listStyles.content, disabled && listStyles.disabled]}>
        <View style={listStyles.text}>
          <Text style={[listStyles.title, destructive && listStyles.destructive]}>{label}</Text>
          {status ? <Text style={listStyles.status}>{status}</Text> : null}
          {description ? <Text style={listStyles.rowNote}>{description}</Text> : null}
        </View>
        {chevron && (
          <IdentitySymbol name={symbol.chevron} tint={symbolTint.chevron} style={listStyles.chevron} />
        )}
      </View>
    </Pressable>
  );
}

/** A label and its value, as Settings shows one: the label in body text, the value trailing in the
 * secondary color, with digits of equal width so a value that changes every second does not jitter. */
export function ValueRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={[listStyles.row, listStyles.content]}>
      <ValueLine label={label} value={value} />
    </View>
  );
}

/** The label and value of a `ValueRow`, for a cell that also holds a control, such as a slider. */
export function ValueLine({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={listStyles.valueLine}>
      <Text style={listStyles.valueLabel}>{label}</Text>
      <Text style={listStyles.value}>{value}</Text>
    </View>
  );
}

/** A titled statement inside a section: the title in body text, the detail under it. */
export function TitleRow({ title, detail }: Readonly<{ title: string; detail: string }>) {
  return (
    <View style={[listStyles.row, listStyles.block]}>
      <Text style={listStyles.title}>{title}</Text>
      <RowNote text={detail} />
    </View>
  );
}

/** Words inside a section: what the section is about, or a short warning. */
export function TextRow({
  text: words,
  tone = 'secondary',
  alert = false,
}: Readonly<{
  text: string;
  tone?: 'secondary' | 'warning' | undefined;
  alert?: boolean | undefined;
}>) {
  return (
    <View style={[listStyles.row, listStyles.content]}>
      <Text
        accessibilityRole={alert ? 'alert' : undefined}
        style={[listStyles.prose, tone === 'warning' && listStyles.warning]}
      >
        {words}
      </Text>
    </View>
  );
}

/** A row holding a control or a picture of its own, such as a slider or a map, with any rows of
 * text above or below it inside the same cell. */
export function ContentRow({ children }: Readonly<{ children: ReactNode }>) {
  return <View style={[listStyles.row, listStyles.block]}>{children}</View>;
}

/** The small print under a control inside its cell. */
export function RowNote({ text: words }: Readonly<{ text: string }>) {
  return <Text style={listStyles.rowNote}>{words}</Text>;
}

/** An action inside a list, as UIKit draws a button cell: tinted words, or red ones when the action
 * destroys something, with an optional note under them in the same cell. No capsule and no
 * chevron: it acts here rather than opening a screen. */
export function ButtonRow({
  label,
  onPress,
  note,
  disabled = false,
  destructive = false,
  testID,
}: Readonly<{
  label: string;
  onPress: () => void;
  note?: string | undefined;
  disabled?: boolean | undefined;
  destructive?: boolean | undefined;
  testID?: string | undefined;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [listStyles.row, listStyles.block, pressed && listStyles.pressed]}
    >
      <Text
        style={[listStyles.button, destructive && listStyles.destructive, disabled && listStyles.disabled]}
      >
        {label}
      </Text>
      {note ? <RowNote text={note} /> : null}
    </Pressable>
  );
}

/** A switch on its own row, trailing as in Settings, with the state iOS reports under the title and
 * a note under both. The switch shows iOS's answer, never a wish. */
export function SwitchRow({
  title,
  state,
  note,
  value,
  disabled,
  onChange,
}: Readonly<{
  title: string;
  state: string;
  note?: string | undefined;
  value: boolean;
  disabled: boolean;
  onChange: (wanted: boolean) => void;
}>) {
  return (
    <View style={[listStyles.row, listStyles.block]}>
      <View style={listStyles.switchLine}>
        <View style={listStyles.text}>
          <Text style={listStyles.title}>{title}</Text>
          <Text style={listStyles.status}>{state}</Text>
        </View>
        <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} />
      </View>
      {note ? <RowNote text={note} /> : null}
    </View>
  );
}

/** One choice of several, left-aligned, with the checkmark on the chosen one. */
export function CheckRow({
  label,
  selected,
  onPress,
  disabled = false,
}: Readonly<{
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean | undefined;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [listStyles.row, listStyles.content, pressed && listStyles.pressed]}
    >
      <Text style={[listStyles.title, listStyles.grow, disabled && listStyles.disabled]}>{label}</Text>
      {selected ? (
        <Text accessibilityElementsHidden style={listStyles.check}>
          {t('common.checkmark')}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A documented item that opens Apple's page: the symbol as code, what it belongs to, and Apple's
 * sentence about it, with the outward arrow a link wears. */
export function LinkRow({
  code,
  caption,
  quote,
  onPress,
}: Readonly<{
  code?: string | undefined;
  caption?: string | undefined;
  quote?: string | undefined;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [listStyles.row, listStyles.content, pressed && listStyles.pressed]}
    >
      <View style={listStyles.text}>
        {code ? <Text style={listStyles.code}>{code}</Text> : null}
        {caption ? <Text style={listStyles.status}>{caption}</Text> : null}
        {quote ? <Text style={listStyles.quote}>{quote}</Text> : null}
      </View>
      <IdentitySymbol name={symbol.externalLink} tint={symbolTint.chevron} style={listStyles.chevron} />
    </Pressable>
  );
}

/** A text button for the navigation bar, such as Cancel over a full-screen check. */
export function BarButton({
  label,
  onPress,
  testID,
  disabled = false,
}: Readonly<{
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean | undefined;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={spacing.xs}
      onPress={onPress}
      testID={testID}
    >
      <Text style={[listStyles.barButton, disabled && listStyles.disabled]}>{label}</Text>
    </Pressable>
  );
}

const listStyles = StyleSheet.create({
  section: { gap: spacing.xs },
  group: { backgroundColor: color.card, borderRadius: radius.group, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md, backgroundColor: color.separator },
  row: { minHeight: size.touchTarget, justifyContent: 'center' },
  pressed: { backgroundColor: color.rowPressed },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  block: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  disabled: { opacity: opacity.disabled },
  text: { flex: 1, gap: spacing.xxs },
  grow: { flex: 1 },
  title: { ...text.rowTitle, color: color.text },
  destructive: { color: color.destructive },
  status: { ...text.rowStatus, color: color.secondaryText },
  valueLabel: { ...text.rowTitle, color: color.text, flexShrink: 1 },
  value: {
    ...text.rowTitle,
    color: color.secondaryText,
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  prose: { ...text.note, color: color.secondaryText, flex: 1 },
  quote: { ...text.rowStatus, color: color.text },
  warning: { color: color.warning },
  rowNote: { ...text.caption, color: color.secondaryText },
  button: { ...text.rowTitle, color: color.tint },
  switchLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  valueLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: { ...text.rowTitle, color: color.tint },
  code: { ...text.code, color: color.text },
  chevron: { width: size.chevron, height: size.chevron },
  note: { ...text.listFooter, color: color.secondaryText, paddingHorizontal: spacing.md },
  prominentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxs,
    paddingTop: spacing.xs,
  },
  prominentTitle: { ...text.sectionTitle, color: color.text, flexShrink: 1 },
  pageTitle: { ...text.groupTitle, color: color.text, flexShrink: 1 },
  barButton: { ...text.rowTitle, color: color.tint },
});
