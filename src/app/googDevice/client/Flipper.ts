import '../../../style/devtools.css';
import { ACTION } from '../../../common/Action';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';


export class Flipper {
    public static readonly ACTION = ACTION.DEVTOOLS;
    public static readonly TIMEOUT = 1000;

    public static createEntryForDeviceList(
        _descriptor: GoogDeviceDescriptor,
        blockClass: string,
    ): HTMLElement | DocumentFragment {
        const entry = document.createElement('a');

        const url = new URL(location.toString());
        url.pathname = url.pathname + 'flipper/';
        url.search = '';

        entry.classList.add('flipper', blockClass);
        entry.textContent = 'Open Flipper';
        entry.setAttribute('href', url.toString());
        entry.setAttribute('rel', 'noopener noreferrer');
        entry.setAttribute('target', '_blank');

        return entry;
    }
}
