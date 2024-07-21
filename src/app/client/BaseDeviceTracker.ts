import { ManagerClient } from './ManagerClient';
import { Message } from '../../types/Message';
import { BaseDeviceDescriptor } from '../../types/BaseDeviceDescriptor';
import { DeviceTrackerEvent } from '../../types/DeviceTrackerEvent';
import { DeviceTrackerEventList } from '../../types/DeviceTrackerEventList';
import { html } from '../ui/HtmlTag';
import { ParamsDeviceTracker } from '../../types/ParamsDeviceTracker';
import { HostItem } from '../../types/Configuration';
import { Tool } from './Tool';
import Util from '../Util';

const TAG = '[BaseDeviceTracker]';

export abstract class BaseDeviceTracker<DD extends BaseDeviceDescriptor, TE> extends ManagerClient<
    ParamsDeviceTracker,
    TE
> {
    public static readonly ACTION_LIST = 'devicelist';
    public static readonly ACTION_DEVICE = 'device';
    public static readonly HOLDER_ELEMENT_ID = 'devices';
    public static readonly AttributePrefixInterfaceSelectFor = 'interface_select_for_';
    public static readonly AttributePlayerFullName = 'data-player-full-name';
    public static readonly AttributePlayerCodeName = 'data-player-code-name';
    public static readonly AttributePrefixPlayerFor = 'player_for_';
    protected static tools: Set<Tool> = new Set();
    protected static instanceId = 0;

    public static registerTool(tool: Tool): void {
        this.tools.add(tool);
    }

    public static buildUrl(item: HostItem): URL {
        const { secure, port, hostname } = item;
        const protocol = secure ? 'wss:' : 'ws:';
        const proxyPath = location.pathname.slice(0, -1);
        const url = new URL(`${protocol}//${hostname}${proxyPath || ''}`);
        if (port) {
            url.port = port.toString();
        }
        return url;
    }

    public static buildUrlForTracker(params: HostItem): URL {
        const wsUrl = this.buildUrl(params);
        wsUrl.searchParams.set('action', this.ACTION);
        return wsUrl;
    }

    public static buildLink(q: any, params: ParamsDeviceTracker): string {
        let { hostname } = params;
        let port: string | number | undefined = params.port;
        let protocol = params.secure ? 'https:' : 'http:';
        if (params.useProxy) {
            q.hostname = hostname;
            q.port = port;
            q.secure = params.secure;
            q.useProxy = true;
            protocol = location.protocol;
            hostname = location.hostname;
            port = location.port;
        }
        const hash = `#!${new URLSearchParams(q).toString()}`;
        const proxyPath = location.pathname.slice(0, -1);
        return `${protocol}//${hostname}:${port}${proxyPath || ''}/${hash}`;
    }

    protected title = 'Device list';
    protected tableId = 'base_device_list';
    protected descriptors: DD[] = [];
    protected elementId: string;
    protected trackerName = '';
    protected id = '';
    private created = false;
    private messageId = 0;

    protected constructor(params: ParamsDeviceTracker, protected readonly directUrl: string) {
        super(params);
        this.elementId = `tracker_instance${++BaseDeviceTracker.instanceId}`;
        this.trackerName = `Unavailable. Host: ${params.hostname}, type: ${params.type}`;
        this.setBodyClass('list');
        this.setTitle();
    }

    public static parseParameters(params: URLSearchParams): ParamsDeviceTracker {
        const typedParams = super.parseParameters(params);
        const type = Util.parseString(params, 'type', true);
        if (type !== 'android' && type !== 'ios') {
            throw Error('Incorrect type');
        }
        return { ...typedParams, type };
    }

    protected getNextId(): number {
        return ++this.messageId;
    }

    protected buildDeviceNotFoundCell(root: Element): void {
        const cell = document.createElement('div');
        cell.style.padding = '20px';
        cell.style.display = 'flex';
        cell.style.flexDirection = 'column';
        cell.style.alignItems = 'center';
        const container = document.createElement('div');

        const message = document.createElement('span');
        message.textContent = 'Emulator not found. Please wait while we attempt to establish a connection...';
        message.style.fontSize = '16px';
        message.style.marginBottom = '10px';

        const spinner = document.createElement('span');
        spinner.setAttribute('class', 'loader');

        container.appendChild(message);
        container.appendChild(spinner);

        cell.appendChild(container);
        root.appendChild(cell);
    }

    protected buildDeviceNotReadyCell(root: Element): void {
        const data = this.descriptors;

        if (data.length === 0) {
            return;
        }

        const device = data[0];
        const container = document.createElement('div');
        container.style.padding = '20px';
        container.style.textAlign = 'center';
        container.style.border = '1px solid #ccc';
        container.style.borderRadius = '8px';
        container.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

        const message = document.createElement('span');
        message.textContent = 'Emulator is not ready. Please wait while we attempt to establish a connection...';
        message.style.fontSize = '18px';
        message.style.marginBottom = '20px';
        message.style.display = 'block';

        const spinner = document.createElement('span');
        spinner.setAttribute('class', 'loader');
        spinner.style.display = 'inline-block';
        spinner.style.marginBottom = '20px';

        container.appendChild(message);
        container.appendChild(spinner);

        const deviceInfo = document.createElement('div');
        deviceInfo.style.marginTop = '20px';

        const details = `
            <p><strong>Emulator ADB State:</strong> <span style="color: red;">${device.state}</span></p>
        `;
        deviceInfo.innerHTML += details;

        const adbHelperMessage = document.createElement('p');
        if (device.state === 'offline') {
            adbHelperMessage.textContent = 'The device is offline. Please wait while we establish a connection.';
        } else if (device.state === 'unauthorized') {
            adbHelperMessage.textContent = 'The device is unauthorized. Please wait while we establish a connection.';
        } else {
            adbHelperMessage.textContent = 'The device is currently not connected. Please wait while we establish a connection.';
        }
        deviceInfo.appendChild(adbHelperMessage);

        const finalMessage = document.createElement('p');
        finalMessage.textContent = 'If the issue persists, please restart the emulator.';

        container.appendChild(deviceInfo);
        root.appendChild(container);
    }

    protected buildDeviceTable(): void {
        const data = this.descriptors;
        const devices = this.getOrCreateTableHolder();
        const tbody = this.getOrBuildTableBody(devices);

        const block = this.getOrCreateTrackerBlock(tbody);
        block.innerHTML = '';
        console.log("building table", data);
        if (!data.length) {
            this.buildDeviceNotFoundCell(block);
            return;
        }

        const emulator = data.find((item) => item.state === 'device');
        if (!emulator) {
            this.buildDeviceNotReadyCell(block);
            return;
        }

        this.buildDeviceRow(block, emulator);
    }

    private getOrCreateTrackerBlock(parent: Element): Element {
        let el = document.getElementById(this.elementId);
        if (!el) {
            el = document.createElement('div');
            el.id = this.elementId;
            el.className = 'menu-block';
            parent.appendChild(el);
            this.created = true;
        } else {
            while (el.children.length) {
                el.removeChild(el.children[0]);
            }
        }

        return el;
    }

    protected abstract buildDeviceRow(tbody: Element, device: DD): void;

    protected onSocketClose(event: CloseEvent): void {
        if (this.destroyed) {
            return;
        }
        console.log(TAG, `Connection closed: ${event.reason}`);
        setTimeout(() => {
            this.openNewConnection();
        }, 2000);
    }

    protected onSocketMessage(event: MessageEvent): void {
        let message: Message;
        try {
            message = JSON.parse(event.data);
        } catch (error: any) {
            console.error(TAG, error.message);
            console.log(TAG, error.data);
            return;
        }
        switch (message.type) {
            case BaseDeviceTracker.ACTION_LIST: {
                const event = message.data as DeviceTrackerEventList<DD>;
                this.descriptors = event.list;
                this.setIdAndHostName(event.id, event.name);
                this.buildDeviceTable();
                break;
            }
            case BaseDeviceTracker.ACTION_DEVICE: {
                const event = message.data as DeviceTrackerEvent<DD>;
                this.setIdAndHostName(event.id, event.name);
                this.updateDescriptor(event.device);
                this.buildDeviceTable();
                break;
            }
            default:
                console.log(TAG, `Unknown message type: ${message.type}`);
        }
    }

    protected setIdAndHostName(id: string, trackerName: string): void {
        if (this.id === id && this.trackerName === trackerName) {
            return;
        }
        this.id = id;
        this.trackerName = trackerName;
    }

    protected getOrCreateTableHolder(): HTMLElement {
        const id = BaseDeviceTracker.HOLDER_ELEMENT_ID;
        let devices = document.getElementById(id);
        if (!devices) {
            devices = document.createElement('div');
            devices.id = id;
            devices.className = 'table-wrapper';
            devices.style.maxWidth = '900px';
            document.body.appendChild(devices);
        }
        return devices;
    }

    protected updateDescriptor(descriptor: DD): void {
        const idx = this.descriptors.findIndex((item: DD) => {
            return item.udid === descriptor.udid;
        });
        if (idx !== -1) {
            this.descriptors[idx] = descriptor;
        } else {
            this.descriptors.push(descriptor);
        }
    }

    protected getOrBuildTableBody(parent: HTMLElement): Element {
        const className = 'device-list';
        let tbody = document.querySelector(
            `#${BaseDeviceTracker.HOLDER_ELEMENT_ID} #${this.tableId}.${className}`,
        ) as Element;
        if (!tbody) {
            const fragment = html`<div id="${this.tableId}" class="${className}"></div>`.content;
            parent.appendChild(fragment);
            const last = parent.children.item(parent.children.length - 1);
            if (last) {
                tbody = last;
            }
        }
        return tbody;
    }

    public getDescriptorByUdid(udid: string): DD | undefined {
        if (!this.descriptors.length) {
            return;
        }
        return this.descriptors.find((descriptor: DD) => {
            return descriptor.udid === udid;
        });
    }

    public destroy(): void {
        super.destroy();
        if (this.created) {
            const el = document.getElementById(this.elementId);
            if (el) {
                const { parentElement } = el;
                el.remove();
                if (parentElement && !parentElement.children.length) {
                    parentElement.remove();
                }
            }
        }
        const holder = document.getElementById(BaseDeviceTracker.HOLDER_ELEMENT_ID);
        if (holder && !holder.children.length) {
            holder.remove();
        }
    }

    protected supportMultiplexing(): boolean {
        return true;
    }

    protected getChannelCode(): string {
        throw Error('Not implemented. Must override');
    }

    protected getChannelInitData(): Buffer {
        const code = this.getChannelCode();
        const buffer = Buffer.alloc(code.length);
        buffer.write(code, 'ascii');
        return buffer;
    }
}
