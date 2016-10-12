#!/usr/bin/env sh

import 'babel-polyfill';
import Connector from './connector.js';
import Server from './api.js';
import { debug, error, info, config, context } from './utils.js';

const mode = context.get('mode');

info(`Using profile ${context.get('NODE_ENV')}`);

if (mode === 'api') {
  info(`Starting on api server mode.`);
  let apiServer = new Server();
  apiServer.start().then(() => {
    info(`API server listening on ${config.api.host}:${config.api.port}`);
  }).catch(err => {
    error(`Failed to start api server error: ${err}`);
  });
} else if (mode === 'connector') {
  info('Starting on connector mode.');
  let connectorServer = new Connector();
  connectorServer.start().then(() => {
    info(`Connector server listening on ${config.connector.host}:${config.connector.port}`);
  }).catch(err => {
    error(`Failed to start connector server error: ${err}`);
  });
} else {
  error(`Unkown start mode ${mode}`);
  process.exit(-1);
}