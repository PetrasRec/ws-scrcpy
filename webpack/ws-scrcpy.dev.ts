import { frontend, backend } from './ws-scrcpy.common';
import webpack from 'webpack';
import BrowserSyncPlugin from 'browser-sync-webpack-plugin';
import { Config } from '../src/server/Config';

const devOpts: webpack.Configuration = {
    devtool: 'inline-source-map',
    mode: 'development',
};

const front = () => {
    const options = Object.assign({}, frontend(), devOpts);
    const config = Config.getInstance();

    const browserSyncPlugin = new BrowserSyncPlugin({
        host: 'localhost',
        port: 3001,
        proxy: {
            target: `localhost:${config.servers[0].port}`,
            ws: true,
        },
    }) as webpack.WebpackPluginInstance;

    options.plugins?.push(browserSyncPlugin);
    return options;
};

const back = () => {
    return Object.assign({}, backend(), devOpts);
};

module.exports = [front, back];
