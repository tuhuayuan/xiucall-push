import 'babel-polyfill';
import should from 'should';
import urllib from 'urllib';
import crypto from 'crypto';
import { config, debug, info } from '../src/utils.js';
import Broker from '../src/queue.js';
import Server from '../src/api.js';


describe('API http server tests.', function() {
  before(function(done) {
    this.api = new Server();
    let broker = new Broker();
    this.fixedQueueID = crypto.randomBytes(6).toString('hex');
    this.url = `http://${config.api.host}:${config.api.port}`;
    this.api.start().then(() => {
      return broker.connect();
    }).then(() => {
      return broker.get(this.fixedQueueID, {
        mode: 'sub',
        autoCreate: true
      });
    }).then(val => {
      this.fixedQueue = val;
      done();
    }).catch(err => {
      done(err);
    });
  });

  after(function(done) {
    this.fixedQueue.peek().then(msg => {
      should.exist(msg);
      return this.api.shutdown();
    }).then(() => {
      done();
    }).catch(err => {
      done(err);
    })
  });

  it('Test server on /apis with GET', function(done) {
    urllib.request(this.url + '/apis', (err, data, res) => {
      (res.status).should.equal(200);
      (res.headers).should.have.property('content-type').and.startWith('application/json');
      (JSON.parse(data.toString())).should.have.property('v1');
      done();
    });
  });

  it('Test server on /apis with unsupported method POST.', function(done) {
    urllib.request(this.url + '/apis', {
        method: 'POST'
      },
      (err, data, res) => {
        (res.status).should.equal(405);
        done();
      });
  });

  it('Test server on /push with POST and application/json content.', function(done) {
    urllib.request(this.url + '/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          'recv_id': [this.fixedQueueID],
          'data': {
            'company_id': '585',
            'version': '111'
          }
        })
      },
      (err, data, res) => {
        (res.status).should.equal(200);
        done();
      });
  });

  it('Test server on /push with POST and error content type.', function(done) {
    urllib.request(this.url + '/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png'
        }
      },
      (err, data, res) => {
        (res.status).should.equal(400);
        done();
      });
  });

  it('Test server on /push with missing a part of message.', function(done) {
    urllib.request(this.url + '/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          // 'recv_id': [crypto.randomBytes(6).toString('hex')],
          'data': {
            'company_id': '585',
            'version': '111'
          }
        })
      },
      (err, data, res) => {
        (res.status).should.equal(400);
        done();
      });
  });

  it('Test concurrency 1 to 100.', function(done) {
    const workers = new Array();
    for (let i = 1; i < 100; i++) {
      workers.push(urllib.request(this.url + '/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          'recv_id': [crypto.randomBytes(6).toString('hex')],
          'data': {
            'index': i
          }
        })
      }));
    }
    Promise.all(workers).then(val => {
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('Test server on /push with autoCreate true.', function(done) {
    urllib.request(this.url + '/push?strictMode=1&&autoCreate=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          'recv_id': [crypto.randomBytes(6).toString('hex')],
          'data': {
            'company_id': '585',
            'version': '111'
          }
        })
      },
      (err, data, res) => {
        (res.status).should.equal(200);
        done();
      });
  });

  it('Test server on /push with strict mode.', function(done) {
    urllib.request(this.url + '/push?strictMode=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        content: JSON.stringify({
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          'recv_id': [crypto.randomBytes(6).toString('hex')],
          'data': {
            'company_id': '585',
            'version': '111'
          }
        })
      },
      (err, data, res) => {
        (res.status).should.equal(406);
        done();
      });
  });

  it('Test server on /unkown with GET.', function(done) {
    urllib.request(this.url + '/unkown',
      (err, data, res) => {
        (res.status).should.equal(404);
        done();
      });
  });
  it('Test server on /healthy.', function(done) {
    urllib.request(this.url + '/healthy',
      (err, data, res) => {
        (res.status).should.equal(200);
        done();
      });
  });
  it('Test server on /healthy with a impossible timeout.', function(done) {
    urllib.request(this.url + '/healthy?timeout=1',
      (err, data, res) => {
        (res.status).should.equal(408);
        done();
      });
  });
});