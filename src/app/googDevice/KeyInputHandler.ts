import { KeyCodeControlMessage } from '../controlMessage/KeyCodeControlMessage';
import { CurrentWindow } from '../CurrentWindow';
import KeyEvent from './android/KeyEvent';
import { ConfigureScrcpy } from './client/ConfigureScrcpy';
import { KeyToCodeMap } from './KeyToCodeMap';

export interface KeyEventListener {
    onKeyEvent: (event: KeyCodeControlMessage) => void;
}

export class KeyInputHandler {
    private static readonly repeatCounter: Map<number, number> = new Map();
    private static readonly listeners: Set<KeyEventListener> = new Set();

    private static handler = (event: Event): void => {
        const isFocused = ConfigureScrcpy.streamClientScrcpy?.player?.isFocused ?? false;
        if (!isFocused) {
            return;
        }

        const keyboardEvent = event as KeyboardEvent;
        const keyCode = KeyToCodeMap.get(keyboardEvent.code);
        if (!keyCode) {
            return;
        }
        let action: typeof KeyEvent.ACTION_DOWN | typeof KeyEvent.ACTION_DOWN;
        let repeatCount = 0;
        if (keyboardEvent.type === 'keydown') {
            action = KeyEvent.ACTION_DOWN;
            if (keyboardEvent.repeat) {
                let count = KeyInputHandler.repeatCounter.get(keyCode);
                if (typeof count !== 'number') {
                    count = 1;
                } else {
                    count++;
                }
                repeatCount = count;
                KeyInputHandler.repeatCounter.set(keyCode, count);
            }
        } else if (keyboardEvent.type === 'keyup') {
            action = KeyEvent.ACTION_UP;
            KeyInputHandler.repeatCounter.delete(keyCode);
        } else {
            return;
        }
        const metaState =
            (keyboardEvent.getModifierState('Alt') ? KeyEvent.META_ALT_ON : 0) |
            (keyboardEvent.getModifierState('Shift') ? KeyEvent.META_SHIFT_ON : 0) |
            (keyboardEvent.getModifierState('Control') ? KeyEvent.META_CTRL_ON : 0) |
            (keyboardEvent.getModifierState('Meta') ? KeyEvent.META_META_ON : 0) |
            (keyboardEvent.getModifierState('CapsLock') ? KeyEvent.META_CAPS_LOCK_ON : 0) |
            (keyboardEvent.getModifierState('ScrollLock') ? KeyEvent.META_SCROLL_LOCK_ON : 0) |
            (keyboardEvent.getModifierState('NumLock') ? KeyEvent.META_NUM_LOCK_ON : 0);

        const controlMessage: KeyCodeControlMessage = new KeyCodeControlMessage(
            action,
            keyCode,
            repeatCount,
            metaState,
        );

        KeyInputHandler.listeners.forEach((listener) => {
            listener.onKeyEvent(controlMessage);
        });
        event.preventDefault();
    };

    public static addEventListener(currentWindow: CurrentWindow, listener: KeyEventListener): void {
        this.listeners.add(listener);
        currentWindow.document.body.addEventListener('keydown', this.handler);
        currentWindow.document.body.addEventListener('keyup', this.handler);
    }

    public static removeEventListener(currentWindow: CurrentWindow, listener: KeyEventListener): void {
        this.listeners.delete(listener);
        currentWindow.document.body.removeEventListener('keydown', this.handler);
        currentWindow.document.body.removeEventListener('keyup', this.handler);
    }
}
