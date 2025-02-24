import * as http from 'http';
import * as https from 'https';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import promClient from 'prom-client';
import { AdbUtils } from '../goog-device/AdbUtils';
import bunyan from 'bunyan';
import fetch from 'node-fetch';

const DEFAULT_STATIC_DIR = path.join(__dirname, './public');

export type ServerAndPort = {
    server: https.Server | http.Server;
    port: number;
};

interface HttpServerEvents {
    started: boolean;
}

export class HttpServer extends TypedEmitter<HttpServerEvents> implements Service {
    private static logger = bunyan.createLogger({ name: 'HTTPServer' });
    private static instance: HttpServer;
    private static PUBLIC_DIR = DEFAULT_STATIC_DIR;
    private static SERVE_STATIC = true;
    private servers: ServerAndPort[] = [];
    private mainApp?: Express;
    private started = false;
    private AUTH_EMAIL_HEADER = 'x-goog-authenticated-user-email';

    protected constructor() {
        super();
    }

    public static getInstance(): HttpServer {
        if (!this.instance) {
            this.instance = new HttpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public static setPublicDir(dir: string): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.PUBLIC_DIR = dir;
    }

    public static setServeStatic(enabled: boolean): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.SERVE_STATIC = enabled;
    }

    public async getServers(): Promise<ServerAndPort[]> {
        if (this.started) {
            return [...this.servers];
        }
        return new Promise<ServerAndPort[]>((resolve) => {
            this.once('started', () => {
                resolve([...this.servers]);
            });
        });
    }

    public getName(): string {
        return `HTTP(s) Server Service`;
    }

    public async start(): Promise<void> {
        // Initialize an express api server
        this.mainApp = express();

        // Handle static file serving
        if (HttpServer.SERVE_STATIC && HttpServer.PUBLIC_DIR) {
            this.mainApp.use(express.static(HttpServer.PUBLIC_DIR));
            this.mainApp.use(express.json());

            /// #if USE_WDA_MJPEG_SERVER
            const { MjpegProxyFactory } = await import('../mw/MjpegProxyFactory');
            this.mainApp.get('/mjpeg/:udid', new MjpegProxyFactory().proxyRequest);
            /// #endif

            // Define a new route for metrics
            this.mainApp.get('/metrics', async (_, res) => {
                res.set('Content-Type', promClient.register.contentType);
                res.end(await promClient.register.metrics());
            });

            // Define a new route for health check
            this.mainApp.get('/health', async (_, res) => {
                AdbUtils.deviceHealthCheck()
                    .then(() => {
                        HttpServer.logger.info({}, 'Health check OK');
                        res.status(200).send('OK');
                    })
                    .catch((err: Error) => {
                        HttpServer.logger.info({ error: err?.message }, 'Health failed');
                        res.status(503).send({ error: err.message });
                    });
            });

            this.mainApp.post('/emulator/gps/current', async (req, res) => {
                const { lat, long } = req.body;

                if (!lat || !long) {
                    return res.status(400).send('Invalid request');
                }

                HttpServer.logger.info(
                    {
                        email: req.headers[this.AUTH_EMAIL_HEADER] || 'unknown',
                        lat: lat,
                        long: long,
                    },
                    'Mocking emulator location',
                );

                try {
                    const agentAddress = Config.getInstance().agentAddress;
                    if (!agentAddress) {
                        return res.status(500).send('agent address is not configured');
                    }

                    const apiResp = await fetch(`${agentAddress}/emulator/gps/current`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            lat: lat,
                            long: long,
                        }),
                    });

                    const responseBody = await apiResp.text();
                    HttpServer.logger.info(
                        {
                            response: responseBody,
                        },
                        'Mocking emulator location response',
                    );

                    return res.status(apiResp.status).send('success');
                } catch (error) {
                    HttpServer.logger.error(
                        {
                            email: req.headers[this.AUTH_EMAIL_HEADER] || 'unknown',
                            lat: lat,
                            long: long,
                        },
                        `Error: ${error}`,
                    );
                    return res.status(500).send('internal error');
                }
            });

            this.mainApp.post('/restart-tcp', async (req) => {
                // TCP connection for some reason gets corrupted after prolonged idling or after restart
                // adb tcpip 5555 fixes this issue, for now providing temporary workaround
                HttpServer.logger.info(
                    { email: req.headers[this.AUTH_EMAIL_HEADER] || 'unknown' },
                    'Restarting tcp connection',
                );
                AdbUtils.resetTCPConnection();
            });

            this.mainApp.post('/install-apk', async (req, res) => {
                HttpServer.logger.info(
                    { email: req.headers[this.AUTH_EMAIL_HEADER] || 'unknown' },
                    'Install apk request received',
                );
                const { apk_url } = req.body;
                if (!apk_url) {
                    return res.status(400).send('Invalid request');
                }

                try {
                    await AdbUtils.downloadAndInstallAPK(apk_url);
                    return res.status(200).send({ message: 'APK installation done' });
                } catch (error) {
                    if (error instanceof Error) {
                        HttpServer.logger.info(
                            { email: req.headers[this.AUTH_EMAIL_HEADER] || 'unknown', error: error.message },
                            'Error installing apk',
                        );
                        // Respond with the specific error message
                        return res.status(404).send({ error: error.message });
                    }

                    return res.status(500).send({ error: 'Internal Server Error' });
                }
            });
        }

        const config = Config.getInstance();
        config.servers.forEach((serverItem) => {
            const { secure, port, redirectToSecure } = serverItem;
            let proto: string;
            let server: http.Server | https.Server;
            if (secure) {
                if (!serverItem.options) {
                    throw Error('Must provide option for secure server configuration');
                }
                server = https.createServer(serverItem.options, this.mainApp);
                proto = 'https';
            } else {
                const options = serverItem.options ? { ...serverItem.options } : {};
                proto = 'http';
                let currentApp = this.mainApp;
                let host = '';
                let port = 443;
                let doRedirect = false;
                if (redirectToSecure === true) {
                    doRedirect = true;
                } else if (typeof redirectToSecure === 'object') {
                    doRedirect = true;
                    if (typeof redirectToSecure.port === 'number') {
                        port = redirectToSecure.port;
                    }
                    if (typeof redirectToSecure.host === 'string') {
                        host = redirectToSecure.host;
                    }
                }
                if (doRedirect) {
                    currentApp = express();
                    currentApp.use(function (req, res) {
                        const url = new URL(`https://${host ? host : req.headers.host}${req.url}`);
                        if (port && port !== 443) {
                            url.port = port.toString();
                        }
                        return res.redirect(301, url.toString());
                    });
                }
                server = http.createServer(options, currentApp);
            }
            this.servers.push({ server, port });
            server.listen(port, () => {
                Utils.printListeningMsg(proto, port);
            });
        });
        this.started = true;
        this.emit('started', true);
    }

    public release(): void {
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}
