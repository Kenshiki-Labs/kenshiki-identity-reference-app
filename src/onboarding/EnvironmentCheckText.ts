import type { EnvironmentCheckSnapshot } from '@kenshiki/identity-capture';
import { t } from '../locales/i18n';

export function environmentAirText(air: EnvironmentCheckSnapshot['air']): string {
  if (air === 'consistent') return t('onboarding.environment.consistent');
  if (air === 'divergent') return t('onboarding.environment.divergent');
  return t('onboarding.environment.unavailable');
}
