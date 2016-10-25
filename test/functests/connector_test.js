import should from 'should';
import _ from 'lodash';
import crypto from 'crypto';
import urllib from 'urllib';
import SocketIOClient from 'socket.io-client';
import { config, debug, info } from '../../src/utils.js';
import Connector from '../../src/connector.js';
import Server from '../../src/api.js';

function getAuthedOpt(number) {
  let opts = {
    extraHeaders: {},
    reconnection: false,
    transports: ['websocket'],
  };
  let timestamp = Math.floor(new Date().getTime() / 1000);
  let hasher = crypto.createHash("md5");
  hasher.update(timestamp + config.connector.authKey + number);
  opts.extraHeaders['x-nbb-authid'] = number;
  opts.extraHeaders['x-nbb-sign'] = hasher.digest('hex') + ',' + timestamp;
  return opts;
}

describe('Connector connectivity tests.', function() {
  before(function() {
    this.connector = new Connector();
    this.connectorOpts = {
      reconnection: false,
      transports: ['websocket'],
    };
    this.connectorUrl = `http://${this.connector.options.host}:${this.connector.options.port}`;
    return this.connector.start().catch(err => {
      should.ifError(err);
    });
  });

  after(function() {
    return this.connector.shutdown().catch(err => {
      should.ifError(err);
    });
  });

  it('Test connector without auth info', function(done) {
    let socket = new SocketIOClient(this.connectorUrl, this.connectorOpts);
    socket.on('disconnect', () => {
      done();
    });
  });

  it('Test after connected an empty message should be recevied.', function(done) {
    let authHead = _.assign({}, this.connectorOpts, getAuthedOpt(crypto.randomBytes(6).toString('hex')));
    let socket = new SocketIOClient(this.connectorUrl, authHead);
    socket.on('message', msg => {
      msg.should.be.empty();
      done();
    })
  });
});

describe('Connector and API server tests.', function() {
  before(function() {
    this.connector = new Connector();
    this.socketUrl = `http://${this.connector.options.host}:${this.connector.options.port}`;

    this.api = new Server();
    this.apiUrl = `http://${this.api.options.host}:${this.api.options.port}`;

    return Promise.all([this.connector.start(), this.api.start()])
      .catch(err => {
        should.ifError(err);
      })
  });

  after(function() {
    return Promise.all([this.api.shutdown(), this.connector.shutdown()])
      .catch(err => {
        should.ifError(err);
      });
  });

  it('Sent commit and wait for incomming message.', function(done) {
    let clientID = crypto.randomBytes(6).toString('hex');
    let client = new SocketIOClient(this.socketUrl, getAuthedOpt(clientID));
    client.once('message', msg => {
      msg.should.be.empty();
      client.once('message', msg => {
        should.equal(msg[0].data.index, 0);
        client.emit('commit', msg.length);
        done();
      });
      client.emit('commit', msg.length);
      urllib.request(this.apiUrl + '/push', {
          method: 'POST',
          contentType: 'json',
          data: {
            'send_id': 'xiuhua_server',
            'channel': ['test'],
            'recv_id': [clientID],
            'data': {
              'index': 0,
            }
          }
        },
        (err, data, res) => {
          should.equal(res.status, 200);
        });
    });
  });

  it('Test api push and connector commit at same time.', function(done) {
    let sum = 0;
    let count = 0;

    let clientIDs = _.map(_.range(0, 20), () => {
      return crypto.randomBytes(6).toString('hex');
    });
    _.map(clientIDs, clientID => {
      let client = new SocketIOClient(this.socketUrl, getAuthedOpt(clientID));
      client.on('message', msg => {
        client.emit('commit', msg.length);
        if (msg.length > 0) {
          sum += msg[0].data.index;
          count += 1;
          if (count === 20) {
            should.equal(sum, 210);
            done();
          }
        }
      });
      return client;
    });
    let pushs = _.map(clientIDs, (clientID, index) => {
      return urllib.request(this.apiUrl + '/push?autoCreate=1', {
        method: 'POST',
        contentType: 'json',
        data: {
          'send_id': 'xiuhua_server',
          'channel': ['test'],
          'recv_id': [clientID],
          'data': {
            'index': index + 1,
          }
        }
      });
    });
    Promise.all(pushs).catch(err => {
      done(err);
    });
  });

  it('Test offline messages.', function(done) {
    let clientID = crypto.randomBytes(6).toString('hex');
    let pushs = _.map(_.range(0, 100), i => {
      return urllib.request(this.apiUrl + '/push?autoCreate=1', {
        method: 'POST',
        contentType: 'json',
        data: {
          'send_id': 'xiuhua_server',
          'channel': ['test'],
          'recv_id': [clientID],
          'data': {
            'index': i + 1
          }
        }
      });
    });
    Promise.all(pushs).then(() => {
      const client = new SocketIOClient(this.socketUrl, getAuthedOpt(clientID));
      let sum = 0;
      let count = 0;
      client.on('message', msg => {
        client.emit('commit', msg.length);
        if (msg.length > 0) {
          sum += msg[0].data.index;
          count += 1;
          if (count === 100) {
            should(sum).equal(5050);
            done();
          }
        }
      });
    }).catch(err => {
      done(err);
    });
  });

  it('Test broadcast messages.', function(done) {
    let clientIDs = _.map(_.range(0, 20), () => {
      return crypto.randomBytes(6).toString('hex');
    });
    let sum = 0;
    let count = 0;
    _.map(clientIDs, val => {
      let client = new SocketIOClient(this.socketUrl, getAuthedOpt(val));
      client.on('message', msg => {
        client.emit('commit', msg.length);
        if (msg.length > 0) {
          sum += msg[0].data.index;
          count += 1;
          if (count === 20) {
            should(sum).equal(20);
            done();
          }
        }
      });
    });
    urllib.request(this.apiUrl + '/push?autoCreate=1', {
      method: 'POST',
      contentType: 'json',
      data: {
        'send_id': 'xiuhua_server',
        'channel': ['test'],
        'recv_id': clientIDs,
        'data': {
          'index': 1,
        }
      }
    });
  });
});

describe('Session manager tests.', function() {
  before(function() {
    this.authedID = crypto.randomBytes(6).toString('hex');
    this.connectorA = new Connector({
      port: 6001
    });
    this.connectorB = new Connector({
      port: 6002
    });
    this.socketAUrl = `http://${this.connectorA.options.host}:${this.connectorA.options.port}`;
    this.socketBUrl = `http://${this.connectorB.options.host}:${this.connectorB.options.port}`;
    return Promise.all([this.connectorA.start(), this.connectorB.start()]).catch(err => {
      should.ifError(err);
    });
  });

  after(function() {
    return Promise.all([this.connectorA.shutdown(), this.connectorB.shutdown()]).catch(err => {
      should.ifError(err);
    });
  });

  it('Local session B should kickout session A.', function(done) {
    let socketA = new SocketIOClient(this.socketAUrl, getAuthedOpt(this.authedID));
    socketA.once('disconnect', () => {
      done();
    });
    socketA.once('connect', () => {
      let socketB = new SocketIOClient(this.socketAUrl, getAuthedOpt(this.authedID));
    })
  });

  it('In different connector session B should kickout session A', function(done) {
    let socketA = new SocketIOClient(this.socketAUrl, getAuthedOpt(this.authedID));
    socketA.once('disconnect', () => {
      done();
    });
    socketA.once('connect', () => {
      let socketB = new SocketIOClient(this.socketBUrl, getAuthedOpt(this.authedID));
    });
  });

  it('A lot of same session should remain only one.', function(done) {
    let count = 0;
    _.map(_.range(0, 20), val => {
      let url = val % 2 == 0 ? this.socketAUrl : this.socketBUrl;
      let socket = new SocketIOClient(url, getAuthedOpt(this.authedID));
      socket.on('disconnect', () => {
        count += 1;
        if (count == 19) {
          done();
        }
      });
    });
  });
});