import { IdentitySymbol } from '@kenshiki/identity-capture';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { type ColorValue, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, opacity, radius, size, spacing, symbol, symbolTint, text } from './tokens.generated';

/** An inset grouped section, as UITableView draws one: an optional header, rows on a rounded cell
 * background with a hairline between two rows, and an optional footer. Separators start where the
 * row's text starts: after the icon tile when the rows have icons. */
export function ListSection({
  children,
  header,
  footer,
  icons = false,
}: {
  children: ReactNode;
  header?: string | undefined;
  footer?: string | undefined;
  icons?: boolean | undefined;
}) {
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <View style={listStyles.section}>
      {header ? (
        <Text accessibilityRole="header" style={listStyles.note}>
          {header}
        </Text>
      ) : null}
      <View style={listStyles.group}>
        {rows.map((row, index) =>
          isValidElement(row) ? (
            <Fragment key={row.key}>
              {index > 0 && <View style={[listStyles.separator, icons && listStyles.iconSeparator]} />}
              {row}
            </Fragment>
          ) : null,
        )}
      </View>
      {footer ? <Text style={listStyles.note}>{footer}</Text> : null}
    </View>
  );
}

/** The rounded, tinted square behind a row's SF Symbol, as in Settings. */
export function IconTile({ name, background }: { name: string; background: ColorValue }) {
  return (
    <View style={[listStyles.tile, { backgroundColor: background }]}>
      <IdentitySymbol name={name} tint={symbolTint.tile} style={listStyles.glyph} />
    </View>
  );
}

/** One row: an optional icon tile, a title, an optional status line, and the disclosure chevron
 * when it opens a screen. `rowID` becomes the pressable's testID, so the pressable itself carries
 * the disabled state. Text sets the row's height, so Dynamic Type reflows it. */
export function ListRow({
  label,
  status,
  onPress,
  rowID,
  icon,
  disabled = false,
  destructive = false,
  chevron = true,
}: {
  label: string;
  status?: string | undefined;
  onPress: () => void;
  rowID?: string | undefined;
  icon?: { name: string; background: ColorValue } | undefined;
  disabled?: boolean | undefined;
  destructive?: boolean | undefined;
  chevron?: boolean | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={rowID}
      onPress={onPress}
      style={({ pressed }) => [listStyles.row, pressed && listStyles.pressed]}
    >
      <View style={[listStyles.content, disabled && listStyles.disabled]}>
        {icon && <IconTile name={icon.name} background={icon.background} />}
        <View style={listStyles.text}>
          <Text style={[listStyles.title, destructive && listStyles.destructive]}>{label}</Text>
          {status ? <Text style={listStyles.status}>{status}</Text> : null}
        </View>
        {chevron && (
          <IdentitySymbol name={symbol.chevron} tint={symbolTint.chevron} style={listStyles.chevron} />
        )}
      </View>
    </Pressable>
  );
}

/** A text button for the navigation bar, such as Cancel over a full-screen check. */
export function BarButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable accessibilityRole="button" hitSlop={spacing.xs} onPress={onPress} testID={testID}>
      <Text style={listStyles.barButton}>{label}</Text>
    </Pressable>
  );
}

const listStyles = StyleSheet.create({
  section: { gap: spacing.xs },
  group: { backgroundColor: color.card, borderRadius: radius.group, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md, backgroundColor: color.separator },
  iconSeparator: { marginLeft: spacing.md + size.iconTile + spacing.sm },
  row: { minHeight: size.touchTarget, justifyContent: 'center' },
  pressed: { backgroundColor: color.rowPressed },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  disabled: { opacity: opacity.disabled },
  tile: {
    width: size.iconTile,
    height: size.iconTile,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: size.iconGlyph, height: size.iconGlyph },
  text: { flex: 1, gap: spacing.xxs },
  title: { ...text.rowTitle, color: color.text },
  destructive: { color: color.destructive },
  status: { ...text.rowStatus, color: color.secondaryText },
  chevron: { width: size.chevron, height: size.chevron },
  note: { ...text.listFooter, color: color.secondaryText, paddingHorizontal: spacing.md },
  barButton: { ...text.rowTitle, color: color.tint },
});
