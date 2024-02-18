import 'xterm/css/xterm.css';
import { ManagerClient } from '../../client/ManagerClient';
import { Terminal } from 'xterm';
import { AttachAddon } from 'xterm-addon-attach';
import { FitAddon } from 'xterm-addon-fit';
import { MessageXtermClient } from '../../../types/MessageXtermClient';
import { ACTION } from '../../../common/Action';
import { ParamsShell } from '../../../types/ParamsShell';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { BaseDeviceTracker } from '../../client/BaseDeviceTracker';
import Util from '../../Util';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ChannelCode } from '../../../common/ChannelCode';

const TAG = '[ShellClient]';

export class ShellClient extends ManagerClient<ParamsShell, never> {
    public static ACTION = ACTION.SHELL;
    public static start(params: ParamsShell, trackerParams?: ParamsDeviceTracker): ShellClient {
        return new ShellClient(params, trackerParams);
    }

    private readonly term: Terminal;
    private readonly fitAddon: FitAddon;
    private readonly udid: string;

    constructor(params: ParamsShell, trackerParams?: ParamsDeviceTracker) {
        if (params.htmlElementToAppend === undefined) {
            params.htmlElementToAppend = document.body;
        }

        super(params);
        this.udid = params.udid;
        this.openNewConnection();
        this.setTitle(`Shell ${this.udid}`);
        this.setBodyClass('shell');
        if (!this.ws) {
            throw Error('No WebSocket');
        }

        this.term = new Terminal({
            theme: {
                background: '#1d1f21',
                foreground: '#c5c8c6',
                cursor: '#f0c674',
                selection: '#373b41',
                black: '#1d1f21',
                red: '#cc6666',
                green: '#b5bd68',
                yellow: '#f0c674',
                blue: '#81a2be',
                magenta: '#b294bb',
                cyan: '#8abeb7',
                white: '#c5c8c6',
                brightBlack: '#666666',
                brightRed: '#ff3334',
                brightGreen: '#9ec400',
                brightYellow: '#f0c674',
                brightBlue: '#81a2be',
                brightMagenta: '#b77ee0',
                brightCyan: '#54ced6',
                brightWhite: '#ffffff',
            },
            fontFamily: '"Fira Code", monospace',
            cursorBlink: true,
            cursorStyle: 'underline',
            fontSize: 10,
        });
        this.term.loadAddon(new AttachAddon(this.ws));
        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);
        this.term.open(ShellClient.getOrCreateContainer(this.udid, params.htmlElementToAppend, trackerParams));
        this.updateTerminalSize();
        this.term.focus();
    }

    protected supportMultiplexing(): boolean {
        return true;
    }

    public static parseParameters(params: URLSearchParams): ParamsShell {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.SHELL) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            udid: Util.parseString(params, 'udid', true),
            htmlElementToAppend: document.body,
        };
    }

    protected onSocketOpen = (): void => {
        this.startShell(this.udid);
    };

    protected onSocketClose(event: CloseEvent): void {
        console.log(TAG, `Connection closed: ${event.reason}`);
        this.term.dispose();
    }

    protected onSocketMessage(): void {
        // messages are processed by Attach Addon
    }

    public startShell(udid: string): void {
        if (!udid || !this.ws || this.ws.readyState !== this.ws.OPEN) {
            return;
        }
        const message: MessageXtermClient = {
            id: 1,
            type: 'shell',
            data: {
                type: 'start',
                udid,
            },
        };
        this.ws.send(JSON.stringify(message));
    }

    private static getOrCreateContainer(
        udid: string,
        appendHTML: HTMLElement,
        params?: ParamsDeviceTracker,
    ): HTMLElement {
        const escapedUdid = Util.escapeUdid(udid);
        let container = document.getElementById(escapedUdid);
        if (!container) {
            container = document.createElement('div');
            container.className = 'terminal-container';

            if (appendHTML === document.body) {
                container.style.height = '80%';
            } else if (params) {
                container.innerHTML = ShellClient.createEntry(udid, 'shell', params)?.outerHTML + '<br>';
            }

            container.innerHTML += 'Note: to inspect logs, enter the command "logcat" <br><br>';
            container.id = escapedUdid;
            appendHTML.appendChild(container);
        }
        return container as HTMLElement;
    }

    public updateTerminalSize(): void {
        this.fitAddon.fit();
    }

    public static createEntry(udid: string, blockClass: string, params: ParamsDeviceTracker): HTMLElement | undefined {
        const entry = document.createElement('a');
        entry.classList.add('shell', blockClass);

        entry.textContent = 'Open ADB shell in new window';
        entry.setAttribute(
            'href',
            BaseDeviceTracker.buildLink(
                {
                    action: ACTION.SHELL,
                    udid: udid,
                },
                params,
            ),
        );
        entry.setAttribute('rel', 'noopener noreferrer');
        entry.setAttribute('target', '_blank');

        return entry;
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        if (descriptor.state !== 'device') {
            return;
        }
        const entry = document.createElement('a');
        entry.classList.add('shell', blockClass);

        entry.textContent = 'Open ADB shell';
        entry.setAttribute(
            'href',
            BaseDeviceTracker.buildLink(
                {
                    action: ACTION.SHELL,
                    udid: descriptor.udid,
                },
                params,
            ),
        );
        entry.setAttribute('rel', 'noopener noreferrer');
        entry.setAttribute('target', '_blank');

        return entry;
    }

    protected getChannelInitData(): Buffer {
        const buffer = Buffer.alloc(4);
        buffer.write(ChannelCode.SHEL, 'ascii');
        return buffer;
    }
}
