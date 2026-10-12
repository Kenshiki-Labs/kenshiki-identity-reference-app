import { Alert } from 'react-native';
import { t } from '../locales/i18n';
import { createControllerCustody } from './ControllerCustody';

test('custody reports one sanitized recovery notice per lifetime, regardless of error payload', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const custody = createControllerCustody();
    custody.reportFailure(new Error('secret-holder-id and native traceback'));
    custody.reportFailure({ payload: 'SSN 000001234', code: 'native-private-error' });
    custody.reportFailure(null);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(t('common.checkNeedsAttention'), t('common.sessionRecovery'));
    expect(JSON.stringify(alert.mock.calls)).not.toMatch(/secret-holder|000001234|native-private-error/);
    createControllerCustody().reportFailure('another private error');
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1]).toEqual(alert.mock.calls[0]);
  } finally {
    alert.mockRestore();
  }
});
