import { AppState } from 'react-native';

type BackgroundController = {
  state: unknown;
  pause: () => Promise<unknown>;
  fail: (error: unknown) => void;
  dispose: () => Promise<unknown>;
};

/** Camera and phone flows pause when backgrounded. An inactive app may be presenting Apple's
 * message composer, so inactivity alone does not interrupt these controllers. */
export function connectBackground<Controller extends BackgroundController>(
  controller: Controller,
): {
  controller: Controller;
  initialState: Controller['state'];
  dispose: () => Promise<unknown>;
} {
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'background') controller.pause().catch(controller.fail);
  });
  return {
    controller,
    initialState: controller.state,
    dispose: () => {
      subscription.remove();
      return controller.dispose();
    },
  };
}
