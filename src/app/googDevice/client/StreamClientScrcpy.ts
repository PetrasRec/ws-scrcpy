import { BaseClient } from '../../client/BaseClient';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogMoreBox } from '../toolbox/GoogMoreBox';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import KeyEvent from '../android/KeyEvent';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { TextControlMessage } from '../../controlMessage/TextControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import FilePushHandler from '../filePush/FilePushHandler';
import DragAndPushLogger from '../DragAndPushLogger';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ConfigureScrcpy } from './ConfigureScrcpy';
import { DeviceTracker } from './DeviceTracker';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { html } from '../../ui/HtmlTag';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { Attribute } from '../../Attribute';
import { HostTracker } from '../../client/HostTracker';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ScrcpyFilePushStream } from '../filePush/ScrcpyFilePushStream';
import { CurrentWindow } from '../../CurrentWindow';
import { isServedInIframe } from '../../../common/Iframe';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

const TAG = '[StreamClientScrcpy]';

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

    private controlButtons?: HTMLElement;
    private deviceView?: HTMLElement;
    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private keyHandlerEnabled = true;
    private requestedVideoSettings?: VideoSettings;
    private touchHandler?: FeaturedInteractionHandler;
    private moreBox?: GoogMoreBox;
    private toolBox?: GoogToolBox;
    public player?: BasePlayer;
    private filePushHandler?: FilePushHandler;
    private fitToScreen?: boolean;
    private metricsWs?: WebSocket;
    private readonly streamReceiver: StreamReceiverScrcpy;

    private buildMetricsURL(): URL {
        const { secure, port, hostname } = this.params;
        const protocol = secure ? 'wss:' : 'ws:';
        const proxyPath = location.pathname.slice(0, -1);
        let urlString = `${protocol}//${hostname}${proxyPath || ''}`;
        if (urlString[urlString.length - 1] !== '/') {
            urlString += '/';
        }

        const url = new URL(urlString);
        if (port) {
            url.port = port.toString();
        }
        return url;
    }

    private createWebSocket() {
        this.metricsWs = new WebSocket(this.buildMetricsURL().toString() + 'metrics');
        let intervalId: NodeJS.Timeout;
        this.metricsWs.onopen = () => {
            intervalId = setInterval(() => {
                if (this.metricsWs && this.metricsWs.readyState === WebSocket.OPEN && this.player) {
                    this.metricsWs?.send(
                        JSON.stringify({
                            momentumQualityStats: this.player.momentumQualityStats,
                            playerName: this.player.getName(),
                        }),
                    );
                }
            }, 1000);
        };
        this.metricsWs.onclose = () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };

        this.metricsWs.onerror = (e) => {
            console.error('Metrics WS error', e);
        };
    }

    public static registerPlayer(playerClass: PlayerClass): void {
        if (playerClass.isSupported()) {
            this.players.set(playerClass.playerFullName, playerClass);
        }
    }

    public static getPlayers(): PlayerClass[] {
        return Array.from(this.players.values());
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        if (streamReceiver) {
            this.streamReceiver = streamReceiver;
        } else {
            this.streamReceiver = new StreamReceiverScrcpy(this.params);
        }

        const { udid, player: playerName } = this.params;
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');
        this.createWebSocket();
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        if (this.moreBox) {
            this.moreBox.OnDeviceMessage(message);
        }
    };

    public onVideo = (data: ArrayBuffer): void => {
        if (!this.player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        if (this.player.getState() === STATE.PAUSED) {
            this.player.play();
        }
        if (this.player.getState() === STATE.PLAYING) {
            this.player.pushFrame(new Uint8Array(data));
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`Stream ${this.deviceName}`);
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }

        let currentSettings = this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        if (this.player.getState() === BasePlayer.STATE.PAUSED) {
            this.player.play();
        }
        const { screenInfo } = info;
        const videoSettings = isServedInIframe() ? currentSettings : info.videoSettings;

        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, newBounds);
                this.player.setVideoSettings(currentSettings, this.fitToScreen, false);
            }
        }
        if (!videoSettings || !screenInfo) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
            return;
        }

        this.clientsCount = info.connectionCount;
        let min = VideoSettings.copy(videoSettings);
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
        }

        if (!videoSettings.equals(currentSettings)) {
            this.applyNewVideoSettings(videoSettings, false);
        }
        if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThenCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThenCurrent) {
                min = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(min.bounds);
            if (minBounds && !minBounds.equals(min.bounds)) {
                min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
            }
        }
        if (!min.equals(videoSettings) || !this.joinedStream) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
        }
    };

    public onDisconnected = (): void => {
        this.streamReceiver.off('deviceMessage', this.OnDeviceMessage);
        this.streamReceiver.off('video', this.onVideo);
        this.streamReceiver.off('clientsStats', this.onClientsStats);
        this.streamReceiver.off('displayInfo', this.onDisplayInfo);
        this.streamReceiver.off('disconnected', this.onDisconnected);

        this.filePushHandler?.release();
        this.filePushHandler = undefined;
        this.touchHandler?.release();
        this.touchHandler = undefined;
        this.deviceView?.remove();
        this.deviceView = undefined;
        //this.streamReceiver.stop();
        if (this.player) {
            this.player.stop();
        }
        this.metricsWs?.close();
    };

    public async onPopOutClick(popOut: boolean): Promise<void> {
        if (popOut) {
            return this.openPIP();
        } else {
            return this.closePIP();
        }
    }

    private async openPIP(): Promise<void> {
        if (!this.touchHandler || !this.player || !this.deviceView) return;

        // Initialize the wrapped pip window
        const bounds = this.deviceView.getBoundingClientRect();
        const width = Math.ceil(bounds.width);
        const height = Math.ceil(bounds.height);
        const pipWindow = await documentPictureInPicture.requestWindow({ height, width });

        const currentPIPWindow = new CurrentWindow(pipWindow);
        currentPIPWindow.copyStylesheets();

        // On first click, try resizing the pip window to properly fit the player
        // The reason this is necessary is because the PIP API imposes restrictions on the
        // aspect ratio of PIP windows to "provide a reasonable user experience" (???)
        // Quoting MDN:
        // > If values [...] set too large, the browser will clamp or ignore the values as appropriate
        // > to provide a reasonable user experience. The clamped size will vary
        // > depending on implementation, display size, and other factors.
        // On top of that, `window.resizeBy` is one of the APIs that require user activation, meaning
        // we're not allowed to resize the window when it's created, only in the context of a user action
        pipWindow.addEventListener(
            'click',
            () => {
                currentPIPWindow.resizeInner(width, height);
            },
            { once: true },
        );

        // Move device view and set up listeners
        this.setTouchListeners(this.player);
        this.player.setCurrentWindow(currentPIPWindow);
        pipWindow.document.body.appendChild(this.deviceView);
        pipWindow.addEventListener('pagehide', () => {
            this.closePIP();
        });

        // Move key handler from main to PIP
        if (this.keyHandlerEnabled) {
            this.setHandleKeyboardEvents(false, CurrentWindow.main);
            this.setHandleKeyboardEvents(true, currentPIPWindow);
        }
    }

    private async closePIP(): Promise<void> {
        if (!this.deviceView || !this.player || !this.toolBox || !CurrentWindow.pipWindow) return;

        // Move key handler from PIP to main
        if (this.keyHandlerEnabled) {
            this.setHandleKeyboardEvents(false, CurrentWindow.pipWindow);
            this.setHandleKeyboardEvents(true, CurrentWindow.main);
        }

        // Move device view back to main window
        document.body.appendChild(this.deviceView);
        CurrentWindow.pipWindow?.currentWindow.close();
        await Util.waitFor(() => CurrentWindow.pipWindow === null);
        this.setTouchListeners(this.player);
        this.player.setCurrentWindow(CurrentWindow.main);

        // Disable the popout checkbox
        const popout = this.toolBox.getHolderElement().querySelector('#input_popout') as HTMLInputElement;
        popout.checked = false;
    }

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        this.fitToScreen = fitToScreen;
        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
            }
            player = p;
        }
        this.player = player;
        this.setTouchListeners(player);
        player.setCurrentWindow(CurrentWindow.main);

        if (!videoSettings) {
            videoSettings = player.getVideoSettings();
        }

        const deviceView = document.createElement('div');
        this.deviceView = deviceView;
        deviceView.className = 'device-view';
        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            let parent;
            parent = deviceView.parentElement;
            if (parent) {
                parent.removeChild(deviceView);
            }
            parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            this.streamReceiver.stop();
            if (this.player) {
                this.player.stop();
            }
        };

        const googMoreBox = (this.moreBox = new GoogMoreBox(udid, player, this));
        const moreBox = googMoreBox.getHolderElement();
        googMoreBox.setOnStop(stop);
        const googToolBox = GoogToolBox.createToolBox(udid, player, this, moreBox);
        this.toolBox = googToolBox;
        // enable keyboard events by default
        this.setHandleKeyboardEvents(true);
        this.controlButtons = googToolBox.getHolderElement();
        deviceView.appendChild(this.controlButtons);
        const video = document.createElement('div');
        video.className = 'video';
        if (!isServedInIframe()) {
            video.classList.add('glow');
        }
        deviceView.appendChild(video);
        deviceView.appendChild(moreBox);
        player.setParent(video);
        player.pause();

        document.body.appendChild(deviceView);
        if (fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
            }
        }
        this.applyNewVideoSettings(videoSettings, false);
        const element = player.getTouchableElement();
        const logger = new DragAndPushLogger(element);
        this.filePushHandler = new FilePushHandler(element, new ScrcpyFilePushStream(this.streamReceiver));
        this.filePushHandler.addEventListener(logger);

        const streamReceiver = this.streamReceiver;
        streamReceiver.on('deviceMessage', this.OnDeviceMessage);
        streamReceiver.on('video', this.onVideo);
        streamReceiver.on('clientsStats', this.onClientsStats);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('disconnected', this.onDisconnected);

        //console.log(TAG, player.getName(), udid);
    }

    public sendMessage(message: ControlMessage): void {
        this.streamReceiver.sendEvent(message);
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public setHandleKeyboardEvents(enabled: boolean, currentWindow: CurrentWindow = CurrentWindow.activeWindow): void {
        this.keyHandlerEnabled = enabled;

        if (enabled) {
            KeyInputHandler.addEventListener(currentWindow, this);
        } else {
            KeyInputHandler.removeEventListener(currentWindow, this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        // Ignore left meta key (which is Cmd on macOS)
        // While copy/pasting text this key goes to home screen. This is not expected behavior.
        // This is probably set inside scrcpy image itself, but tested it against scrcpy cli and that key did nothing
        // So for now will just ignore this key
        // All emulator shortcuts with CMD key are combined with some other key
        if (event.keycode === KeyEvent.KEYCODE_META_LEFT) {
            return;
        }

        if (event.metaState & KeyEvent.META_META_ON) {
            if (event.keycode === KeyEvent.KEYCODE_V) {
                const sendClipboard = async () => {
                    const { currentWindow } = CurrentWindow.activeWindow;
                    try {
                        const text = await currentWindow.navigator.clipboard.readText();
                        this.sendMessage(new TextControlMessage(text));
                    } catch (err) {
                        console.error('Failed to read clipboard contents:', err);
                    }
                };

                sendClipboard();
            }
        }

        this.sendMessage(event);
    }

    public sendNewVideoSetting(videoSettings: VideoSettings): void {
        this.requestedVideoSettings = videoSettings;
        this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(this.requestedVideoSettings));
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        if (!this.controlButtons) {
            return;
        }
        const body = document.body;
        const width = (body.clientWidth - this.controlButtons.clientWidth) & ~15;
        const height = body.clientHeight & ~15;
        return new Size(width, height);
    }

    private setTouchListeners(player: BasePlayer): void {
        const currentWindow = CurrentWindow.activeWindow;

        this.touchHandler?.release();
        this.touchHandler = new FeaturedInteractionHandler(player, this, currentWindow);
    }

    public applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
        let fitToScreen = false;
        // TODO: create control (switch/checkbox) instead
        if (videoSettings.bounds && videoSettings.bounds.equals(this.getMaxSize())) {
            fitToScreen = true;
        }
        if (this.player) {
            this.player.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
        }
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        fullName: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        const hasPid = descriptor.pid !== -1;
        if (hasPid) {
            const configureButtonId = `configure_${Util.escapeUdid(descriptor.udid)}`;
            const e = html`<button
                ${Attribute.UDID}="${descriptor.udid}"
                ${Attribute.COMMAND}="${ControlCenterCommand.CONFIGURE_STREAM}"
                ${Attribute.FULL_NAME}="${fullName}"
                ${Attribute.SECURE}="${params.secure}"
                ${Attribute.HOSTNAME}="${params.hostname}"
                ${Attribute.PORT}="${params.port}"
                ${Attribute.USE_PROXY}="${params.useProxy}"
                id="${configureButtonId}"
                class="stream ${blockClass}"
            >
                Configure stream
            </button>`;
            const a = e.content.getElementById(configureButtonId);
            a && (a.onclick = this.onConfigureStreamClick);
            return e.content;
        }
        return;
    }

    private static onConfigureStreamClick = (event: MouseEvent): void => {
        const button = event.currentTarget as HTMLAnchorElement;
        const udid = Util.parseStringEnv(button.getAttribute(Attribute.UDID) || '');
        const fullName = button.getAttribute(Attribute.FULL_NAME);
        const secure = Util.parseBooleanEnv(button.getAttribute(Attribute.SECURE) || undefined) || false;
        const hostname = Util.parseStringEnv(button.getAttribute(Attribute.HOSTNAME) || undefined) || '';
        const port = Util.parseIntEnv(button.getAttribute(Attribute.PORT) || undefined);
        const useProxy = Util.parseBooleanEnv(button.getAttribute(Attribute.USE_PROXY) || undefined);
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }
        if (typeof port !== 'number') {
            throw Error(`Invalid port type: ${typeof port}`);
        }
        const tracker = DeviceTracker.getInstance({
            type: 'android',
            secure,
            hostname,
            port,
            useProxy,
        });
        const descriptor = tracker.getDescriptorByUdid(udid);
        if (!descriptor) {
            return;
        }
        event.preventDefault();
        const elements = document.getElementsByName(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`);
        if (!elements || !elements.length) {
            return;
        }
        const select = elements[0] as HTMLSelectElement;
        const optionElement = select.options[select.selectedIndex];
        const ws = optionElement.getAttribute(Attribute.URL);
        const name = optionElement.getAttribute(Attribute.NAME);
        if (!ws || !name) {
            return;
        }
        const options: ParamsStreamScrcpy = {
            udid,
            ws,
            player: '',
            action: ACTION.STREAM_SCRCPY,
            secure,
            hostname,
            port,
            useProxy,
        };
        const dialog = new ConfigureScrcpy(tracker, descriptor, options);
        dialog.on('closed', StreamClientScrcpy.onConfigureDialogClosed);
    };

    private static onConfigureDialogClosed = (event: { dialog: ConfigureScrcpy; result: boolean }): void => {
        event.dialog.off('closed', StreamClientScrcpy.onConfigureDialogClosed);
        if (event.result) {
            HostTracker.getInstance().destroy();
        }
    };
}
