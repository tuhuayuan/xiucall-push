import 'babel-polyfill';
import should from 'should';
import _ from 'lodash';
import crypto from 'crypto';
import SocketIOClient from 'socket.io-client';
import { config, debug, info } from '../lib/utils.js';
import Connector from '../lib/connector.js';

function getAuthedOpt(number) {
  let opts = {
    extraHeaders: {},
    reconnection: false
  };
  let timestamp = new Date().getTime();
  let hasher = crypto.createHash("md5");
  hasher.update(timestamp + config.connector.authKey + number);
  opts.extraHeaders['x-nbb-authid'] = number;
  opts.extraHeaders['x-nbb-sign'] = hasher.digest('hex') + ',' + timestamp;
  return opts;
}

describe('Client connector tests.', function() {
  before(function(done) {
    this.connector = new Connector();
    this.connectorOpts = {
      reconnection: false,
      transports: ['websocket']
    };
    this.connectorUrl = `http://${this.connector.options.host}:${this.connector.options.port}`;
    this.authKey = config.connector.authKey;
    // Start connector instance.
    this.connector.start().then(() => {
      done();
    }).catch(err => {
      done(err);
    });
  });

  after(function(done) {
    this.connector.shutdown().then(() => {
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('Test connector without auth info', function(done) {
    let socket = new SocketIOClient(this.connectorUrl, this.connectorOpts);
    socket.on('disconnect', () => {
      done();
    });
    socket.on('message', msg => {
      debug(`message: ${msg}`);
    });
    socket.on('connect', () => {
      debug(`connect`);
    });
  });

  it('Test connector with auth info should get first message.', function(done) {
    let authHead = _.assign(this.connectorOpts, getAuthedOpt(crypto.randomBytes(6).toString('hex')));
    let socket = new SocketIOClient(this.connectorUrl, authHead);
    socket.on('message', msg => {
      should.exist(msg);
      done();
    })
  });

  it('Test local connector kickout.', function(done) {
    let authHead = _.assign(this.connectorOpts, getAuthedOpt(crypto.randomBytes(6).toString('hex')));
    const s1 = new SocketIOClient(this.connectorUrl, authHead);
    s1.on('disconnect', () => {
      done();
    });
    s1.on('connect', () => {
      const s2 = new SocketIOClient(this.connectorUrl, authHead);
    });
  });
});