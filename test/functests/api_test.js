import should from 'should';
import urllib from 'urllib';
import crypto from 'crypto';
import _ from 'lodash';
import { config, debug, info } from '../../src/utils.js';
import Server from '../../src/api.js';


describe('API http server tests.', function() {
  before(function() {
    this.api = new Server();
    this.url = `http://${config.api.host}:${config.api.port}`;
    return this.api.start().catch(err => {
      should.ifError(err);
    });
  });

  after(function() {
    return this.api.shutdown().catch(err => {
      should.ifError(err);
    })
  });

  it('Test server on /apis with method GET', function() {
    return urllib.request(this.url + '/apis', {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(200);
      (res.data).should.have.property('v1');
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on POST /push.', function() {
    return urllib.request(this.url + '/push?autoCreate=true', {
      method: 'POST',
      contentType: 'json',
      dataType: 'json',
      data: {
        'send_id': 'xiuhua_server',
        'channel': ['unitpart_changed'],
        'recv_id': [crypto.randomBytes(6).toString('hex')],
        'data': {
          'company_id': '585',
          'version': '111'
        }
      }
    }).then(res => {
      (res.status).should.equal(200);
      (res.data.send).should.equal(1);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on POST /push without content type.', function() {
    return urllib.request(this.url + '/push?autoCreate=true', {
      method: 'POST',
      data: {
        'send_id': 'xiuhua_server',
        'channel': ['unitpart_changed'],
        'recv_id': [crypto.randomBytes(6).toString('hex')],
        'data': {
          'company_id': '585',
          'version': '111'
        }
      }
    }).then(res => {
      (res.status).should.equal(400);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on POST /push without recv_id', function() {
    return urllib.request(this.url + '/push?autoCreate=true', {
      method: 'POST',
      contentType: 'json',
      data: {
        'send_id': 'xiuhua_server',
        'channel': ['unitpart_changed'],
        'data': {
          'company_id': '585',
          'version': '111'
        }
      }
    }).then(res => {
      (res.status).should.equal(400);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test arithmetic sequence to random queue.', function() {
    let pushs = _.map(_.range(0, 20), i => {
      return urllib.request(this.url + '/push?autoCreate=1', {
        method: 'POST',
        contentType: 'json',
        dataType: 'json',
        data: {
          'send_id': 'xiuhua_server',
          'channel': ['unitpart_changed'],
          'recv_id': [crypto.randomBytes(6).toString('hex')],
          'data': {
            'index': i + 1
          }
        }
      })
    });
    return Promise.all(pushs)
      .then(results => {
        _.map(results, res => {
          (res.data.send).should.equal(1);
        });
      }).catch(err => {
        should.ifError(err);
      });
  });

  it('Test server on /healthy.', function() {
    return urllib.request(this.url + '/healthy')
      .then(res => {
        (res.status).should.equal(200);
      }).catch(err => {
        should.ifError(err);
      });
  });

  it('Test server on /healthy with a impossible timeout.', function() {
    return urllib.request(this.url + '/healthy?timeout=1')
      .then(res => {
        (res.status).should.equal(408);
      }).catch(err => {
        should.ifError(err);
      });
  });
});

describe('Monitor API tests.', function() {
  before(function() {
    this.api = new Server();
    this.url = `http://${config.api.host}:${config.api.port}`;
    this.queueID = crypto.randomBytes(6).toString('hex');
    this.beginning = Math.floor(new Date().getTime() / 1000);
    return this.api.start()
      .then(() => {
        return Promise.all(_.map(_.range(0, 10), index => {
          return urllib.request(this.url + '/push?autoCreate=true', {
            method: 'POST',
            contentType: 'json',
            dataType: 'json',
            data: {
              send_id: 'xiucall-push',
              channel: ['test'],
              recv_id: [this.queueID],
              data: {
                index: index
              }
            }
          }).then(res => {
            (res.status).should.equal(200);
          });
        }));
      }).catch(err => {
        should.ifError(err);
      });
  });

  after(function() {
    return this.api.shutdown().catch(err => {
      should.ifError(err);
    })
  });

  it('Test server on GET /queues/:id .', function() {
    return urllib.request(this.url + `/queues/${this.queueID}`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(200);
      (res.data.ok).should.equal(1);
      (res.data.messages).should.have.lengthOf(10);
    }).catch(err => {
      should.ifError(err);
    })
  });

  it('Test server on GET /queues/:id?since= .', function() {
    return urllib.request(this.url + `/queues/${this.queueID}?since=${this.beginning}`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(200);
      (res.data.ok).should.equal(1);
      (res.data.messages).should.have.lengthOf(10);
    }).catch(err => {
      should.ifError(err);
    })
  });

  it('Test server on GET /queues/:id?since=&limit= .', function() {
    return urllib.request(this.url + `/queues/${this.queueID}?since=${this.beginning}&limit=${1}`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(200);
      (res.data.ok).should.equal(1);
      (res.data.messages).should.have.lengthOf(1);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on GET /queues/:id?since=abc&limit=abc .', function() {
    return urllib.request(this.url + `/queues/${this.queueID}?since=abc&limit=abc`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(400);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on GET /watch/:id .', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    setTimeout(() => {
      urllib.request(this.url + '/push?autoCreate=1', {
        method: 'POST',
        contentType: 'json',
        dataType: 'json',
        data: {
          send_id: 'xiucall-test',
          channel: ['test'],
          recv_id: [randomID],
          data: {
            index: 0
          }
        }
      }).then(res => {
        (res.status).should.equal(200);
        (res.data.send).should.equal(1);
      }).catch(err => {
        should.ifError(err);
      });
    }, 100);
    return urllib.request(this.url + `/watch/${randomID}`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(200);
      (res.data.ok).should.equal(1);
      (res.data.message.payload.data.index).should.equal(0);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test server on GET /watch/:id?channel=100 .', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    return urllib.request(this.url + `/watch/${randomID}?channel=100`, {
      method: 'GET',
      dataType: 'json'
    }).then(res => {
      (res.status).should.equal(400);
    }).catch(err => {
      should.ifError(err);
    });
  });
});