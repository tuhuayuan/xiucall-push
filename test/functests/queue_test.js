import should from 'should';
import crypto from 'crypto';
import _ from 'lodash';
import { config, logger, debug, info, error } from '../../src/utils.js';
import Broker from '../../src/queue.js';

describe('Broker connectivity tests.', function() {
  it('Test broker connecting.', function(done) {
    let broker = new Broker();
    broker.on('connecting', () => {
      done();
    });
    broker.connect().catch(err => {
      done(err);
    });
  });

  it('Test broker connect.', function(done) {
    let broker = new Broker();
    broker.on('connect', () => {
      done();
    });
    broker.connect().catch(err => {
      done(err);
    });
  });

  it('Test broker disconnect.', function(done) {
    let broker = new Broker();
    broker.on('end', () => {
      done();
    })
    broker.on('connect', () => {
      broker.close().catch(err => {
        done(err);
      });;
    });
    broker.connect().catch(err => {
      done(err);
    });
  });

  it('Test broker open after close.', function(done) {
    let broker = new Broker();
    broker.on('end', () => {
      broker.once('connect', () => {
        done();
      });
      broker.connect().catch(err => {
        done(err);
      });
    })
    broker.once('connect', () => {
      broker.close().catch(err => {
        done(err);
      });
    });
    broker.connect().catch(err => {
      done(err);
    });
  });

  it('Test broker open connect in wrong status.', function(done) {
    let broker = new Broker();
    broker.on('connect', () => {
      broker.connect().catch(err => {
        should.exist(err);
        done();
      });
    });
    broker.connect().catch(err => {
      done(err);
    });
  });
});

describe('Queue build tests.', function() {
  beforeEach(function() {
    this.broker = new Broker();
    return this.broker.connect().catch(err => {
      should.ifError(err);
    });
  });

  afterEach(function() {
    return this.broker.close().catch(err => {
      should.ifError(err);
    });
  });

  it('Test get a publish queue with random id and autoCreate=true', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    return this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).catch(function(err) {
      shoudl.ifError(err);
    });
  });

  it('Test get a publish queue and push a message.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    return this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(queue => {
      return queue.push({
        name: 'tuhuayuan',
        attrs: {
          password: 'password',
          roles: ['admin', 'user']
        }
      });
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test queue create -> push -> peek -> commit.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: "Test queue create -> push -> peek -> commit."
    };
    let queue;
    return this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      return queue.push(message);
    }).then(val => {
      return queue.peek();
    }).then(val => {
      should.deepEqual(val.payload, message);
      return queue.commit();
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test queue create -> peek -> push -> commit.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> peek -> push -> commit.'
    };
    let queue;
    return this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(function(val) {
      queue = val;
      process.nextTick(() => {
        queue.push(message).catch(err => {
          should.ifError(err);
        });
      });
      return queue.peek();
    }).then(val => {
      should.deepEqual(val.payload, message);
      return queue.commit();
    }).catch(err => {
      should.ifError(err)
    });
  });

  it('Test queue create -> close.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    return this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(val => {
      queue = val;
      return queue.close();
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test queue create -> peeking -> close.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    return this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      process.nextTick(() => {
        queue.close().catch(err => {
          should.ifError(err);
        });
      });
      return queue.peek().catch(err => {
        should.AssertionError(err);
      });
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test queue create -> peeking -> Broker::close -> close.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    return this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      process.nextTick(() => {
        this.broker.close().catch(err => {
          should.ifError(err);
        });
      });
      queue.peek().catch(err => {
        should.AssertionError(err);
      });
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Test queue create -> push -> close(dump).', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> push -> close(dump).'
    };
    let queue;
    return this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(val => {
      queue = val;
      return queue.push(message);
    }).then(val => {
      return queue.close(true);
    }).then(() => {
      return this.broker.get(randomID, {
        mode: 'sub',
        autoCreate: false
      }).catch(err => {
        should.AssertionError(err);
      });
    }).catch(err => {
      should.ifError(err);
    });
  });
});

describe('Queue message sequence.', function() {
  beforeEach(function() {
    this.broker = new Broker();
    this.messages = _.map(_.range(0, 100), i => {
      return {
        index: i + 1,
        name: 'arithmetic sequence 1 to 100',
        test: 'Queue message sequence.'
      }
    });
    let randomID = crypto.randomBytes(6).toString('hex');
    return this.broker.connect().then(() => {
      return this.broker.get(randomID, {
        mode: 'sub',
        autoCreate: true
      });
    }).then(val => {
      this.queue = val;
    }).catch(err => {
      should.ifError(err);
    });
  });

  afterEach(function() {
    return this.broker.close().catch(err => {
      shoudl.ifError(err);
    });
  });

  it('Test messages from 1 to 100 arithmetic sequence one by one.', function() {
    return _.reduce(this.messages, (m, n) => {
      return m.then(() => {
        return this.queue.push(n)
      }).then(() => {
        return this.queue.peek();
      }).then(val => {
        should.equal(val.payload.index, n.index);
        return this.queue.commit();
      });
    }, Promise.resolve()).catch(err => {
      should.ifError(err);
    });
  });

  it('Test messages from 1 to 100 arithmetic sequence in concurrence.', function() {
    let pubs = _.map(this.messages, msg => {
      return this.queue.push(msg);
    });
    let sub = _.reduce(_.range(0, this.messages.length - 1), (m, n) => {
      return m.then(val => {
        return Promise.all([this.queue.commit(), val[1] + val[0].payload.index]);
      }).then(val => {
        return Promise.all([this.queue.peek(), val[1]]);
      });
    }, Promise.all([this.queue.peek(), 0])).then(result => {
      should.equal(result[0].payload.index + result[1], 5050);
    });
    return Promise.all(_.concat(pubs, sub)).catch(err => {
      should.ifError(err);
    });
  });
});

describe('Two brokers tests.', function() {
  beforeEach(function() {
    this.brokerA = new Broker();
    this.brokerB = new Broker();
    this.queueID = crypto.randomBytes(6).toString('hex');
    this.messages = _.map(_.range(0, 100), i => {
      return {
        index: i + 1,
        name: 'arithmetic sequence 1 to 100',
        test: 'Two brokers operate on same message queue from 1 to 100 arithmetic sequence.'
      }
    });
    return Promise.all([this.brokerA.connect(), this.brokerB.connect()])
      .catch(err => {
        should.ifError(err);
      });
  });

  afterEach(function() {
    return Promise.all([this.brokerA.close(), this.brokerB.close()])
      .catch(err => {
        should.ifError(err);
      });
  });

  it('Create same queue in broker a and b.', function() {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queueAs = _.map(_.range(0, 10), () => {
      return this.brokerA.get(randomID, {
        mode: 'pub',
        autoCreate: true
      });
    });
    let queueBs = _.map(_.range(0, 10), () => {
      return this.brokerB.get(randomID, {
        mode: 'pub',
        autoCreate: true
      });
    });
    return Promise.all(_.concat(queueAs, queueBs)).catch(err => {
      should.ifError(err);
    });
  });

  it('Broker A publish, Broker B subscribe.', function() {
    let pub = this.brokerA.get(this.queueID, {
      mode: 'pub',
      autoCreate: true
    }).then(queue => {
      return Promise.all(_.map(this.messages, msg => {
        return queue.push(msg);
      }));
    });
    let sub = this.brokerB.get(this.queueID, {
      mode: 'sub',
      autoCreate: true
    }).then(queue => {
      return _.reduce(_.range(0, this.messages.length - 1), (m, n) => {
        return m.then(val => {
          return Promise.all([queue.commit(), val[1] + val[0].payload.index]);
        }).then(val => {
          return Promise.all([queue.peek(), val[1]]);
        });
      }, Promise.all([queue.peek(), 0]));
    }).then(result => {
      should.equal(result[0].payload.index + result[1], 5050);
    });
    return Promise.all([pub, sub]).catch(err => {
      should.ifError(err);
    });
  });

  it('Broker A publish, Broker B subscribe on two channels.', function() {
    let pub = this.brokerA.get(this.queueID, {
      mode: 'pub',
      autoCreate: true
    }).then(queue => {
      return Promise.all(_.map(this.messages, msg => {
        return queue.push(msg);
      }));
    });
    let subs = _.map(_.range(0, 2), channel => {
      return this.brokerB.get(this.queueID, {
        mode: 'sub',
        autoCreate: true,
        channel: channel
      }).then(queue => {
        return _.reduce(_.range(0, this.messages.length - 1), (m, n) => {
          return m.then(val => {
            return Promise.all([queue.commit(), val[1] + val[0].payload.index]);
          }).then(val => {
            return Promise.all([queue.peek(), val[1]]);
          });
        }, Promise.all([queue.peek(), 0]));
      }).then(result => {
        should.equal(result[0].payload.index + result[1], 5050);
      });
    });
    return Promise.all(_.concat(subs, pub)).catch(err => {
      should.ifError(err);
    });
  });
});

describe('Queue query tests.', function() {
  before(function() {
    let queueID = crypto.randomBytes(6).toString('hex');
    this.broker = new Broker();
    this.beginning = new Date();
    return this.broker.connect()
      .then(() => {
        return this.broker.get(queueID, {
          mode: 'pub',
          autoCreate: true
        });
      }).then(queue => {
        this.queue = queue;
        return _.reduce(_.range(0, 10), (m, n) => {
          return m.then(() => {
            return this.queue.push({
              index: n
            });
          }).then(() => {
            return new Promise((fulfill, reject) => {
              setTimeout(() => {
                fulfill();
              }, 100);
            });;
          });
        }, Promise.resolve());
      }).then(() => {
        this.middle = new Date();
        return _.reduce(_.range(10, 20), (m, n) => {
          return m.then(() => {
            return this.queue.push({
              index: n
            });
          });
        }, Promise.resolve());
      }).catch(err => {
        should.ifError(err);
      });
  });

  after(function() {
    return this.broker.close().catch(err => {
      should.ifError(err);
    });
  });

  it('Query default.', function() {
    return this.queue.query()
      .then(results => {
        results.should.have.size(10);
      }).catch(err => {
        should.ifError(err);
      });
  });

  it('Query from the begining.', function() {
    return this.queue.query({
      since: this.beginning,
      limit: 5
    }).then(results => {
      results.should.have.size(5);
      should.equal(results[4].payload.index, 4);
    }).catch(err => {
      should.ifError(err);
    });
  });

  it('Query from the middle.', function() {
    return this.queue.query({
      since: this.middle,
      limit: 5
    }).then(results => {
      results.should.have.size(5);
      should.equal(results[0].payload.index, 10);
    }).catch(err => {
      should.ifError(err);
    })
  });
});