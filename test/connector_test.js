import 'babel-polyfill';
import should from 'should';
import _ from 'lodash';
import crypto from 'crypto';
import urllib from 'urllib';
import SocketIOClient from 'socket.io-client';
import { config, debug, info } from '../src/utils.js';
import Connector from '../src/connector.js';
import Server from '../src/api.js';

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

describe('Connector connectivity tests.', function() {
  before(function(done) {
    this.connector = new Connector();
    this.connectorOpts = {
      reconnection: false,
      transports: ['websocket'],
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
    let authHead = _.assign({}, this.connectorOpts, getAuthedOpt(crypto.randomBytes(6).toString('hex')));
    let socket = new SocketIOClient(this.connectorUrl, authHead);
    socket.on('message', msg => {
      should.exist(msg);
      done();
    })
  });
});

describe('Connector and Api collaborate tests.', function() {
  before(function(done) {
    // socketio options.
    this.authedID = crypto.randomBytes(6).toString('hex');
    this.socketOpts = _.assign({
      reconnection: false,
      transports: ['websocket'],
    }, getAuthedOpt(this.authedID));
    // connector
    this.connector = new Connector();
    this.socketUrl = `http://${this.connector.options.host}:${this.connector.options.port}`;
    // api server
    this.api = new Server();
    this.apiUrl = `http://${this.api.options.host}:${this.api.options.port}`;
    Promise.all([this.connector.start(), this.api.start()])
      .then(val => {
        done();
      }).catch(err => {
        done(err);
      })
  });

  after(function(done) {
    this.api.shutdown().then(() => {
      done();
    }).catch(err => {
      done(err);
    })
  });

  it('A null message should sent after connected.', function(done) {
    const client = new SocketIOClient(this.socketUrl, this.socketOpts);
    client.on('disconnect', () => {
      done();
    });
    client.on('message', msg => {
      should(msg).be.empty();
      client.disconnect();
    });
  });

  it('Sent commit and wait for incomming message.', function(done) {
    const client = new SocketIOClient(this.socketUrl, this.socketOpts);
    client.on('disconnect', () => {
      done();
    });
    client.once('message', msg => {
      should(msg).be.empty();
      client.once('message', msg => {
        should(msg).not.be.empty();
        should(msg[0]).have.property('data');
        should(msg[0].data).have.property('index').and.equal(0);
        client.emit('commit', msg.length);
        client.disconnect();
      });
      client.emit('commit', 0);
      urllib.request(this.apiUrl + '/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          content: JSON.stringify({
            'send_id': 'xiuhua_server',
            'channel': ['test'],
            'recv_id': [this.authedID],
            'data': {
              'index': 0,
              'from': 'Test: Sent commit and wait for incomming message.'
            }
          })
        },
        (err, data, res) => {
          (res.status).should.equal(200);
        });
    });
  });

  it('Test concurrency of connector and api.', function(done) {
    let sum = 0;
    let count = 0;

    const clientIDs = _.map(_.range(0, 20), () => {
      return crypto.randomBytes(6).toString('hex');
    });
    const clients = _.map(clientIDs, val => {
      return new SocketIOClient(this.socketUrl,
        _.assign({}, this.socketOpts, getAuthedOpt(val), { reconnection: true }));
    });
    const pushWorkers = _.map(clientIDs, (id, index) => {
      return urllib.request(this.apiUrl + '/push?autoCreate=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['test'],
          'recv_id': [id],
          'data': {
            'index': index + 1,
            'from': 'Test: Test concurrency.'
          }
        })
      });
    });
    Promise.all(pushWorkers).catch(err => {
      done(err);
    });
    _.forEach(clients, val => {
      val.on('message', msg => {
        val.emit('commit', msg.length);
        if (msg.length > 0) {
          sum += msg[0].data.index;
          count += 1;
          if (count === 20) {
            should(sum).equal(210);
            done();
          }
        }
      });
    });

  });

  it('Test offline messages.', function(done) {
    const pushWorkers = new Array();
    for (let i = 1; i <= 100; i++) {
      pushWorkers.push(urllib.request(this.apiUrl + '/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['test'],
          'recv_id': [this.authedID],
          'data': {
            'index': i,
            'from': 'Test: Test offline messages.'
          }
        })
      }));
    }
    Promise.all(pushWorkers).then(() => {
      const client = new SocketIOClient(this.socketUrl, this.socketOpts);
      let sum = 0;
      let count = 0;

      client.on('disconnect', () => {
        done();
      });
      client.on('message', msg => {
        client.emit('commit', msg.length);
        if (msg.length > 0) {
          sum += msg[0].data.index;
          count += 1;
          if (count === 100) {
            should(sum).equal(5050);
            client.disconnect();
          }
        }
      });
    }).catch(err => {
      done(err);
    });

  });

  it('Test broadcast messages.', function(done) {
    const clientIDs = _.map(_.range(0, 20), () => {
      return crypto.randomBytes(6).toString('hex');
    });
    const clients = _.map(clientIDs, val => {
      return new SocketIOClient(this.socketUrl,
        _.assign({}, this.socketOpts, getAuthedOpt(val), { reconnection: true }));
    });
    let sum = 0;
    let count = 0;
    _.forEach(clients, val => {;
      val.on('message', msg => {
        val.emit('commit', msg.length);
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
      headers: {
        'Content-Type': 'application/json'
      },
      content: JSON.stringify({
        'send_id': 'xiuhua_server',
        'channel': ['test'],
        'recv_id': clientIDs,
        'data': {
          'index': 1,
          'from': 'Test:  broadcast messages.'
        }
      })
    })
  });
});

describe('Session manager tests.', function() {
  before(function(done) {
    // socketio options.
    this.authedID = crypto.randomBytes(6).toString('hex');
    this.socketOpts = _.assign({
      reconnection: false,
      transports: ['websocket'],
    }, getAuthedOpt(this.authedID));
    this.connectorA = new Connector({
      port: 6001
    });
    this.connectorB = new Connector({
      port: 6002
    });
    this.socketAUrl = `http://${this.connectorA.options.host}:${this.connectorA.options.port}`;
    this.socketBUrl = `http://${this.connectorB.options.host}:${this.connectorB.options.port}`;
    Promise.all([this.connectorA.start(), this.connectorB.start()])
      .then(() => {
        done();
      }).catch(err => {
        done(err);
      });
  });

  after(function(done) {
    Promise.all([this.connectorA.shutdown(), this.connectorB.shutdown()])
      .then(() => {
        done();
      }).catch(err => {
        done(err);
      });
  });

  it('Local session B should kickout session A.', function(done) {
    let socketA = new SocketIOClient(this.socketAUrl, this.socketOpts);
    socketA.once('disconnect', () => {
      done();
    });
    socketA.once('connect', () => {
      let socketB = new SocketIOClient(this.socketAUrl, this.socketOpts);
    })
  });

  it('In different connector session B should kickout session A', function(done) {
    let socketA = new SocketIOClient(this.socketAUrl, this.socketOpts);
    socketA.once('disconnect', () => {
      done();
    });
    socketA.once('connect', () => {
      let socketB = new SocketIOClient(this.socketBUrl, this.socketOpts);
    });
  });

  it('A lot of same session should remain only one.', function(done) {
    let sum = 20;
    let count = 0;
    _.map(_.range(0, 20), val => {
      let url = val % 2 == 0 ? this.socketAUrl : this.socketBUrl;
      let socket = new SocketIOClient(url, this.socketOpts);
      socket.on('disconnect', () => {
        count += 1;

        if (count === 19) {
          let lastSocket = new SocketIOClient(this.socketAUrl, this.socketOpts);
          lastSocket.on('disconnect', () => {
            done();
          });
          lastSocket.on('connect', () => {
            lastSocket.disconnect();
          });
        }
      });
    });
  })
});