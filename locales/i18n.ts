import {fallbackLocale, locales, type LocaleCode, type Message, type MessageKey, type MessageValues} from './strings.generated';

/** The catalog this app shows, chosen once at launch from the device language. */
export type ResolvedLocale = {
  readonly code: LocaleCode;
  /** The language tag the device reported. */
  readonly requested: string;
  /** True when no catalog matches `requested` and the declared fallback is shown instead. */
  readonly declaredFallback: boolean;
};

/** Picks the catalog for a BCP 47 or iOS locale identifier by its language subtag. A language
 * with no catalog gets `fallbackLocale`, the one fallback the generated module declares. */
export function resolveLocale(requested: string): ResolvedLocale {
  const language = requested.split(/[-_]/)[0].toLowerCase();
  const code = (Object.keys(locales) as LocaleCode[]).find(candidate => candidate === language);
  return code === undefined
    ? {code: fallbackLocale, requested, declaredFallback: true}
    : {code, requested, declaredFallback: false};
}

/** The device language as iOS resolves it for this app (Hermes reads `NSLocale.currentLocale`).
 * iOS changes it only by relaunching the app, so it is read once. */
export const locale = resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
const active = locales[locale.code];

/** The BCP 47 tag the active catalog formats dates with. */
export const formatLocale = active.formatLocale;

/** The values a message needs: none, or exactly the placeholders its ICU text names. */
export type MessageArguments<K extends MessageKey> = MessageValues[K] extends undefined ? [] : [values: MessageValues[K]];
type Values = {readonly [name: string]: string | number};

/** The text for `key` in the active catalog, with its ICU placeholders, plurals and selects
 * filled from `values`. A key the catalog does not hold, or a missing value, does not compile. */
export function t<K extends MessageKey>(key: K, ...values: MessageArguments<K>): string {
  const supplied: unknown = values[0];
  return render(active.messages[key], (supplied ?? {}) as Values, undefined);
}

function value(values: Values, name: string): string | number {
  const found = values[name];
  if (found === undefined) throw new RangeError(name);
  return found;
}

function render(message: Message, values: Values, count: number | undefined): string {
  if (typeof message === 'string') return message;
  let out = '';
  for (const part of message) {
    if (typeof part === 'string') { out += part; continue; }
    switch (part[0]) {
      case '#':
        if (count === undefined) throw new RangeError('#');
        out += String(count);
        break;
      case 'arg':
        out += String(value(values, part[1]));
        break;
      case 'plural': {
        const n = Number(value(values, part[1]));
        // ICU order: an exact =N match, then the language's plural category, then other. The
        // generator refuses a plural without other.
        out += render(part[2][`=${n}`] ?? part[2][active.plural(n)] ?? part[2]['other'], values, n);
        break;
      }
      case 'select':
        out += render(part[2][String(value(values, part[1]))] ?? part[2]['other'], values, count);
        break;
    }
  }
  return out;
}
