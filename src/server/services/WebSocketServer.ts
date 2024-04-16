import { Server as WSServer } from 'ws';
import WS from 'ws';
import { Service } from './Service';
import { HttpServer, ServerAndPort } from './HttpServer';
import { MwFactory } from '../mw/Mw';
import {
    inputBytesGauge,
    inputFramesGauge,
    decodedFramesGauge,
    droppedFramesGauge,
    webSocketConnections,
    playerNames,
    webSocketLatency,
} from './PromMetrics';
import { IncomingMessage } from 'http';
import { ACTION } from '../../common/Action';
import bunyan from 'bunyan';

const HEARTBEAT_INTERVAL = 60_000;

export class WebSocketServer implements Service {
    private static instance?: WebSocketServer;
    private static logger = bunyan.createLogger({ name: 'WebSocketServer' });
    private servers: WSServer[] = [];
    private mwFactories: Set<MwFactory> = new Set();
    private AUTH_EMAIL_HEADER = 'x-goog-authenticated-user-email';
    private lastHeartbeatAt = new Map<WS, number>(); // Stores timestamp of when the last ping was acked

    protected constructor() {
        // nothing here
    }

    public static getInstance(): WebSocketServer {
        if (!this.instance) {
            this.instance = new WebSocketServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public registerMw(mwFactory: MwFactory): void {
        this.mwFactories.add(mwFactory);
    }

    private getUserLdap(request: IncomingMessage): string {
        const userEmailHeader = request.headers[this.AUTH_EMAIL_HEADER];
        if (Array.isArray(userEmailHeader)) {
            return userEmailHeader[0] || 'localhost';
        }

        // format: accounts.google.com:test@google.com
        if (typeof userEmailHeader === 'string') {
            const emailSplit = userEmailHeader.split(':');
            if (emailSplit.length > 1) {
                return emailSplit[1].split('@')[0];
            } else {
                return emailSplit[0];
            }
        }

        return 'localhost';
    }

    private handleMetricsSocket(ws: WS, request: IncomingMessage) {
        const user_ldap = this.getUserLdap(request);
        ws.on('message', (message) => {
            try {
                if (message instanceof Buffer) {
                    const messageString = message.toString('utf8');

                    const { momentumQualityStats, playerName } = JSON.parse(messageString);
                    const labelValues = { player_name: playerName, user_ldap };
                    decodedFramesGauge.set(labelValues, momentumQualityStats?.decodedFrames || 0);
                    droppedFramesGauge.set(labelValues, momentumQualityStats?.droppedFrames || 0);
                    inputFramesGauge.set(labelValues, momentumQualityStats?.inputFrames || 0);
                    inputBytesGauge.set(labelValues, momentumQualityStats?.inputBytes || 0);
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            playerNames.forEach((player_name) => {
                const labelValues = { player_name: player_name, user_ldap };
                decodedFramesGauge.remove(labelValues);
                droppedFramesGauge.remove(labelValues);
                inputFramesGauge.remove(labelValues);
                inputBytesGauge.remove(labelValues);
            });
        });
    }

    private handleAdbProxy(user_ldap: string, action: string, ws: WS) {
        webSocketConnections.labels(user_ldap).inc();

        // Ensure we only perform close logic once to avoid double decrementing metrics
        let closed = false;
        const handleClose = () => {
            if (closed) return;

            WebSocketServer.logger.debug({ user_ldap, action }, 'Handling close logic');
            webSocketConnections.labels(user_ldap).dec();
            clearInterval(heartbeatInterval);
            closed = true;

            setImmediate(() => {
                // Clean up last heartbeat timestamp asynchronously to flush any pending pong events
                this.lastHeartbeatAt.delete(ws);
            });
        };

        const heartbeatInterval = setInterval(() => {
            const now = Date.now();
            let lastAckAt = this.lastHeartbeatAt.get(ws);

            // Initialize first ack for new connections
            if (!lastAckAt) {
                lastAckAt = Date.now();
                this.lastHeartbeatAt.set(ws, lastAckAt);
            }

            // Connections are considered unresponsive if we miss three consecutive heartbeats
            // i.e. the last pong we received is over 3 heartbeat intervals ago
            const unresponsive = now - lastAckAt > HEARTBEAT_INTERVAL * 3;
            if (unresponsive) {
                WebSocketServer.logger.debug({ user_ldap, action, now, lastAckAt }, 'Closing due to missed heartbeat');
                handleClose();
                ws.close(4003, 'Heartbeat timeout');
            } else {
                WebSocketServer.logger.debug({ user_ldap, action }, 'Sending ping');
                ws.ping(now.toString());
            }
        }, HEARTBEAT_INTERVAL);

        ws.on('pong', (data) => {
            WebSocketServer.logger.debug({ user_ldap, action }, 'Received heartbeat ack');

            // Update last heartbeat at
            const now = Date.now();
            this.lastHeartbeatAt.set(ws, now);

            // Record latency metric
            const pingTimestamp = Number(data.toString());
            const diff = now - pingTimestamp;
            webSocketLatency.labels(user_ldap).observe(diff);
        });

        ws.on('close', () => {
            WebSocketServer.logger.info({ user_ldap, action }, 'WebSocket close request');
            handleClose();
        });
    }

    public attachToServer(item: ServerAndPort): WSServer {
        const { server, port } = item;
        const TAG = `WebSocket Server {tcp:${port}}`;
        const wss = new WSServer({ server });
        wss.on('connection', async (ws: WS, request: IncomingMessage) => {
            if (!request.url) {
                ws.close(4001, `[${TAG}] Invalid url`);
                return;
            }

            // If the request is for metrics, handle it and return the socket for metrics
            if (request.url === '/metrics') {
                this.handleMetricsSocket(ws, request);
                return;
            }

            const url = new URL(request.url, 'https://example.org/');
            // path for live data
            if (request.url === '/live-data') {
                for (const mwFactory of this.mwFactories.values()) {
                    mwFactory.processRequest(ws, {
                        action: ACTION.GOOG_DEVICE_LIST,
                        request,
                        url,
                        type: 'live-data',
                    });
                }
                return;
            }
            const user_ldap = this.getUserLdap(request);
            const action = url.searchParams.get('action') || '';
            let processed = false;
            WebSocketServer.logger.info({ user_ldap, action }, 'WebSocket request');

            if (action === ACTION.PROXY_ADB) {
                this.handleAdbProxy(user_ldap, action, ws);
            }

            for (const mwFactory of this.mwFactories.values()) {
                const service = mwFactory.processRequest(ws, { action, request, url, type: 'screen' });
                if (service) {
                    processed = true;
                }
            }
            if (!processed) {
                ws.close(4002, `[${TAG}] Unsupported request`);
            }
            return;
        });

        wss.on('close', () => {
            console.log(`${TAG} stopped`);
        });
        this.servers.push(wss);
        return wss;
    }

    public getServers(): WSServer[] {
        return this.servers;
    }

    public getName(): string {
        return `WebSocket Server Service`;
    }

    public async start(): Promise<void> {
        const service = HttpServer.getInstance();
        const servers = await service.getServers();
        servers.forEach((item) => {
            this.attachToServer(item);
        });
    }

    public release(): void {
        this.servers.forEach((server) => {
            server.close();
        });
    }
}
