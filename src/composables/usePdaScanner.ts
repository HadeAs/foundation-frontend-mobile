import { onHide, onShow } from '@dcloudio/uni-app';
import { onUnmounted } from 'vue';
import {
  getDataWedgeIntentKeys,
  getDataWedgeIntentValue,
} from '../services/scanAdapter';

const defaultDataWedgeActions = [
  'com.symbol.datawedge.DWDEMO',
  'com.dcloud.uniapp.scan',
  'android.intent.ACTION_DECODE_DATA'
];
const defaultDataWedgeProfileName = 'IndustrialMobile';
const plusApi = () => plus as unknown as {
  android: {
    runtimeMainActivity: () => any;
    importClass: (nameOrObject: string | unknown) => any;
    implements: (name: string, methods: Record<string, unknown>) => unknown;
  };
  globalEvent: {
    addEventListener: (event: string, listener: () => void) => void;
    removeEventListener: (event: string, listener: () => void) => void;
  };
};

interface UsePdaScannerOptions {
  actions?: string[];
  profileName?: string;
  debug?: boolean;
}

function getIntentAction(intent: unknown) {
  const getAction = (intent as { getAction?: () => string | null })?.getAction;
  return typeof getAction === 'function' ? getAction.call(intent) ?? '' : '';
}

function getActivityPackageName(activity: unknown) {
  const getPackageName = (activity as { getPackageName?: () => string | null })?.getPackageName;
  return typeof getPackageName === 'function' ? getPackageName.call(activity) ?? '' : '';
}

export function usePdaScanner(
  onScan: (value: string, raw?: unknown) => void,
  {
    actions = defaultDataWedgeActions,
    profileName = defaultDataWedgeProfileName,
    debug = false
  }: UsePdaScannerOptions = {}
) {
  let pdaIntentHandler: (() => void) | null = null;
  let pdaReceiver: unknown = null;
  let active = false;

  function log(message: string) {
    if (debug) {
      console.log(message);
    }
  }

  function warn(message: string) {
    if (debug) {
      console.warn(message);
    }
  }

  function handlePdaBroadcast(value: string, raw?: unknown) {
    if (!value.trim()) {
      const keys = getDataWedgeIntentKeys(raw).join(', ');
      warn(`收到PDA事件但无条码: ${getIntentAction(raw) || 'unknown'}; keys: ${keys || 'none'}`);
      return;
    }

    log(`收到PDA数据: ${value}`);
    onScan(value, raw);
  }

  function readPdaIntent() {
    if (typeof plus === 'undefined') {
      return;
    }

    try {
      const activity = plusApi().android.runtimeMainActivity();
      const intent = activity.getIntent();
      const value = getDataWedgeIntentValue(intent);
      if (value) {
        handlePdaBroadcast(value, intent);
      }
    } catch (error) {
      warn(`读取Intent失败: ${String(error)}`);
    }
  }

  function registerPdaBroadcastReceiver() {
    if (typeof plus === 'undefined' || pdaReceiver) {
      return;
    }

    try {
      const api = plusApi();
      const activity = api.android.runtimeMainActivity();
      const IntentFilter = api.android.importClass('android.content.IntentFilter');
      const filter = new IntentFilter();
      actions.forEach((action) => filter.addAction(action));
      filter.addCategory('android.intent.category.DEFAULT');

      pdaReceiver = api.android.implements('io.dcloud.feature.internal.reflect.BroadcastReceiver', {
        onReceive: (_context: unknown, intent: unknown) => {
          api.android.importClass(intent);
          handlePdaBroadcast(getDataWedgeIntentValue(intent), intent);
        }
      });

      activity.registerReceiver(pdaReceiver, filter);
      log(`PDA监听已注册: ${getActivityPackageName(activity) || 'unknown'}`);
    } catch (error) {
      warn(`PDA监听注册失败: ${String(error)}`);
      pdaReceiver = null;
    }
  }

  function switchDataWedgeProfile() {
    if (typeof plus === 'undefined') {
      return;
    }

    try {
      const api = plusApi();
      const Intent = api.android.importClass('android.content.Intent');
      const intent = new Intent();
      intent.setAction('com.symbol.datawedge.api.ACTION');
      intent.putExtra('com.symbol.datawedge.api.SWITCH_TO_PROFILE', profileName);
      api.android.runtimeMainActivity().sendBroadcast(intent);
      log(`PDA监听已注册，已请求Profile: ${profileName}`);
    } catch (error) {
      warn(`DataWedge Profile切换失败: ${String(error)}`);
    }
  }

  function unregisterPdaBroadcastReceiver() {
    if (typeof plus === 'undefined' || !pdaReceiver) {
      return;
    }

    try {
      plusApi().android.runtimeMainActivity().unregisterReceiver(pdaReceiver);
    } catch {
      // Receiver may already be gone when the runtime tears down the page.
    }

    pdaReceiver = null;
  }

  const handlePdaScanEvent = ((
    event: CustomEvent<{ value: string; raw?: unknown }>,
  ) => {
    handlePdaBroadcast(event.detail.value, event.detail.raw ?? event.detail);
  }) as EventListener;

  function start() {
    if (active) {
      return;
    }

    active = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('pda-scan', handlePdaScanEvent);
    }

    if (typeof plus !== 'undefined') {
      pdaIntentHandler = readPdaIntent;
      plusApi().globalEvent.addEventListener('newintent', pdaIntentHandler);
      registerPdaBroadcastReceiver();
      switchDataWedgeProfile();
      setTimeout(readPdaIntent);
    } else {
      log('当前不是App运行环境');
    }
  }

  function stop() {
    if (!active) {
      return;
    }

    active = false;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pda-scan', handlePdaScanEvent);
    }

    if (typeof plus !== 'undefined' && pdaIntentHandler) {
      plusApi().globalEvent.removeEventListener('newintent', pdaIntentHandler);
      pdaIntentHandler = null;
    }

    unregisterPdaBroadcastReceiver();
  }

  onShow(start);
  onHide(stop);
  onUnmounted(stop);
}
