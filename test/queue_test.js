import 'babel-polyfill';
import assert from 'assert';
import should from 'should';
import crypto from 'crypto';
import co from 'co';
import _ from 'lodash';
import { config, logger, debug, info, error } from '../lib/utils.js';
import Broker from '../lib/queue.js';


describe('Broker connectivity tests.', function() {
  it('Test new broker with correct config.', function() {
    let brk = new Broker();
    should.exist(brk);
  });
  it('Test broker connecting.', function(done) {
    let brk = new Broker();
    brk.on('connecting', () => {
      done();
    });
    brk.connect().catch(err => {
      done(err);
    });
  });
  it('Test broker connect.', function(done) {
    let brk = new Broker();
    brk.on('connect', () => {
      done();
    });
    brk.connect().catch(err => {
      done(err);
    });
  });
  it('Test broker disconnect.', function(done) {
    let brk = new Broker();
    brk.on('end', () => {
      done();
    })
    brk.on('connect', () => {
      brk.close().catch(err => {
        done(err);
      });;
    });
    brk.connect().catch(err => {
      done(err);
    });
  });
  it('Test broker reopen.', function(done) {
    let brk = new Broker();
    brk.on('end', () => {
      brk.once('connect', () => {
        done();
      });
      brk.connect().catch(err => {
        done(err);
      });
    })
    brk.once('connect', () => {
      brk.close().catch(err => {
        done(err);
      });;
    });
    brk.connect().catch(err => {
      done(err);
    });
  });
  it('Test broker repeat connect.', function(done) {
    let brk = new Broker();
    brk.on('connect', () => {
      brk.connect().catch(err => {
        should.exist(err);
        done();
      });
    });
    brk.connect().catch(err => {
      done(err);
    });
  });
});

describe('Queue build tests.', function() {
  beforeEach(function(done) {
    this.broker = new Broker();
    this.broker.connect().then(val => {
      should.exist(val);
      done();
    }).catch(err => {
      done(err);
    });
  });
  it('Test get #Publish queue with random id and autoCreate=true', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(function(val) {
      done();
    }).catch(function(err) {
      done(err);
    });
  });
  it('Test get new #Publish and push a message.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(function(val) {
      should.exist(val);
      val.push({
        name: 'tuhuayuan',
        attrs: {
          password: 'password',
          roles: ['admin', 'user']
        }
      }).then(val => {
        (val).should.be.false();
        done();
      }).catch(err => {
        done(err);
      });
    }).catch(function(err) {
      done(err);
    });
  });
  it('Test queue create -> push -> peek.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: "Test queue create -> push -> peek."
    };
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(function(val) {
      val.push(message).then(res => {
        (res).should.be.true();
        return val.peek();
      }).then(res => {
        (res).should.be.an.instanceOf(Object).and.have.property('payload');
        (res.payload).should.deepEqual(message);
        done();
      }).catch(err => {
        done(err);
      });
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> peek -> push.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> peek -> push.'
    };
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(function(val) {
      process.nextTick(() => {
        val.push(message).then(res => {
          (res).should.be.true();
        }).catch(err => {
          done(err);
        });
      });
      return val.peek();
    }).then(res => {
      (res).should.be.an.instanceOf(Object).and.have.property('payload');
      (res.payload).should.deepEqual(message);
      done();
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> push -> peek -> commit.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> push -> peek -> commit'
    };
    let queue;
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(function(val) {
      queue = val;
      return queue.push(message);
    }).then(res => {
      return queue.peek();
    }).then(res => {
      return queue.commit();
    }).then(res => {
      (res).should.be.true();
      done();
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> peek -> push -> commit.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> peek -> push -> commit'
    };
    let queue;
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      process.nextTick(() => {
        queue.push(message).catch(err => {
          done(err);
        });
      });
      return queue.peek();
    }).then(res => {
      return queue.commit();
    }).then(res => {
      (res).should.be.true();
      done();
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> close.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(val => {
      queue = val;
      return queue.close();
    }).then(() => {
      done();
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> peeking -> close.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      process.nextTick(() => {
        queue.close().catch(err => {
          done(err);
        });
      });
      queue.peek().catch(err => {
        should.exist(err);
        done();
      });
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> peeking -> Broker::close -> close.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let queue;
    this.broker.get(randomID, {
      mode: 'sub',
      autoCreate: true
    }).then(val => {
      queue = val;
      process.nextTick(() => {
        this.broker.close().catch(err => {
          done(err);
        });
      });
      queue.peek().catch(err => {
        done();
      });
    }).catch(err => {
      done(err);
    });
  });
  it('Test queue create -> push -> close -> get -> peeking -> commit.', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> push -> close -> get -> peeking -> commit.'
    };
    let queue;
    this.broker.get(randomID, {
      mode: 'pub',
      autoCreate: true
    }).then(val => {
      queue = val;
      return queue.push(message);
    }).then(val => {
      return queue.close();
    }).then(val => {
      return this.broker.get(randomID, {
        mode: 'sub',
        autoCreate: false
      });
    }).then(val => {
      queue = val;
      return queue.peek();
    }).then(val => {
      (val).should.be.an.instanceOf(Object).and.have.property('payload');
      (val.payload).should.deepEqual(message);
      return queue.commit();
    }).then(val => {
      (val).should.be.true();
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('Test queue create -> push -> close(dump).', function(done) {
    let randomID = crypto.randomBytes(6).toString('hex');
    let message = {
      from: 'Test queue create -> push -> close(dump).'
    };
    let queue;
    this.broker.get(randomID, {
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
      });
    }).catch(err => {
      done();
    });
  });
});

describe('Queue message sequence.', function() {
  beforeEach(function(done) {
    this.broker = new Broker();
    let randomID = crypto.randomBytes(6).toString('hex');
    this.messages = new Array(101);
    for (let i = 1; i <= 100; i++) {
      this.messages[i] = {
        index: i,
        padding: 'arithmetic sequence 1 to 100'
      };
    }
    this.broker.connect().then(val => {
      return this.broker.get(randomID, {
        mode: 'sub',
        autoCreate: true
      });
    }).then(val => {
      this.queue = val;
      done();
    }).catch(err => {
      done(err);
    });
  });
  afterEach(function(done) {
    let sum = 0;
    let count = 0;
    let queue = this.queue;
    co(function*() {
      for (let i = 1; i <= 100; i++) {
        let message = yield queue.peek();
        count++;
        sum += message.payload.index;
        if (count == 100) {
          (sum).should.equal(5050);
          done();
        }
        yield queue.commit();
      }
    }).catch(err => {
      done(err);
    })
  });
  it('Test messages from 1 to 100 arithmetic sequence.', function(done) {
    let messages = this.messages;
    let queue = this.queue;
    co(function*() {
      for (let msg of messages) {
        if (!msg) {
          continue;
        }
        yield queue.push(msg);
      }
    }).catch(err => {
      done(err);
    })
    done();
  });
  it('Test concurrent messages from 1 to 100 arithmetic sequence.', function(done) {
    let messages = this.messages;
    let queue = this.queue;
    let allPush = new Array();
    co(function*() {
      for (let msg of messages) {
        if (!msg) {
          continue;
        }
        allPush.push(queue.push(msg));
      }
      yield Promise.all(allPush);
      done();
    }).catch(err => {
      done(err);
    })
  });
});

describe('Brokers operate on same message queue from 1 to 100 arithmetic sequence.', function() {
  beforeEach(function(done) {
    this.brokerA = new Broker();
    this.brokerB = new Broker();
    this.queueID = crypto.randomBytes(6).toString('hex');
    this.messages = new Array(101);
    for (let i = 1; i <= 100; i++) {
      this.messages[i] = {
        index: i,
        padding: 'arithmetic sequence 1 to 100'
      };
    }
    Promise.all([this.brokerA.connect(), this.brokerB.connect()]).then(val => {
      done();
    }).catch(err => {
      done(err);
    })
  });

  afterEach(function(done) {
    Promise.all([this.brokerA.close(), this.brokerB.close()]).then(val => {
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('Broker A publish, Broker B subscribe.', function(done) {
    let context = this;
    co(function*() {
      let queuePub = yield context.brokerA.get(context.queueID, {
        mode: 'pub',
        autoCreate: true
      });
      let queueSub = yield context.brokerB.get(context.queueID, {
        mode: 'sub',
        autoCreate: true
      });
      let workerForPub = new Promise((fulfil, reject) => {
        co(function*() {
          for (let msg of context.messages) {
            if (!msg) {
              continue;
            }
            yield queuePub.push(msg);
          }
          fulfil();
        }).catch(err => {
          reject(err);
        });
      });
      let workerForSub = new Promise((fulfil, reject) => {
        co(function*() {
          let count = 0;
          let sum = 0;
          while (true) {
            let msg = yield queueSub.peek();
            yield queueSub.commit();

            count++;
            sum += msg.payload.index;
            if (count == 100) {
              (sum).should.equal(5050);
              return done();
            }
          }
        }).catch(err => {
          reject(err);
        });
      });
      // Pub/Sub in concurrent.
      yield [workerForPub, workerForSub];
    }).catch(err => {
      done(err);
    });;
  })

  it('Broker A concurrent publish, Broker B subscribe.', function(done) {
    let context = this;
    co(function*() {
      let queuePub = yield context.brokerA.get(context.queueID, {
        mode: 'pub',
        autoCreate: true
      });
      let queueSub = yield context.brokerB.get(context.queueID, {
        mode: 'sub',
        autoCreate: false
      });
      let workersForAll = _.map(context.messages, msg => {
        queuePub.push(msg);
      });
      workersForAll.push(new Promise((fulfil, reject) => {
        co(function*() {
          let count = 0;
          let sum = 0;
          while (true) {
            let msg = yield queueSub.peek();
            yield queueSub.commit();

            count++;
            sum += msg.payload.index;
            if (count == 100) {
              (sum).should.equal(5050);
              return done();
            }
          }
        }).catch(err => {
          reject(err);
        });
      }));
      // Pub/Sub in concurrent.
      yield workersForAll;
    }).catch(err => {
      done(err);
    });
  });

  it('Broker A concurrent publish, Broker B open two subscriber channel.', function(done) {
    let context = this;
    co(function*() {
      let queuePub = yield context.brokerA.get(context.queueID, {
        mode: 'pub',
        autoCreate: true
      });
      let queueSub1 = yield context.brokerB.get(context.queueID, {
        mode: 'sub',
        autoCreate: false,
        channel: 0
      });
      let queueSub2 = yield context.brokerB.get(context.queueID, {
        mode: 'sub',
        autoCreate: false,
        channel: 1
      });
      let workersForAll = _.map(context.messages, msg => {
        queuePub.push(msg);
      });
      workersForAll.push(new Promise((fulfil, reject) => {
        co(function*() {
          let count = 0;
          let sum = 0;
          let createWorkerPromise = function(queue) {
            let msg;
            return queue.peek().then(val => {
              msg = val;
              return queue.commit();
            }).then(() => {
              return Promise.resolve(msg);
            });
          };
          let workerSub1 = createWorkerPromise(queueSub1);
          let workerSub2 = createWorkerPromise(queueSub2);
          while (true) {
            let [msg1, msg2] = yield Promise.all([
              workerSub1.then(val => {
                workerSub1 = createWorkerPromise(queueSub1);
                return val;
              }),
              workerSub2.then(val => {
                workerSub2 = createWorkerPromise(queueSub2);
                return val;
              })
            ]);
            for (let msg of[msg1, msg2]) {
              count++;
              sum += msg.payload.index;
              if (count == 100 * 2) {
                (sum).should.equal(5050 * 2);
                return done();
              }
            }
          }
        }).catch(err => {
          reject(err);
        });
      }));
      // Pub/Sub in concurrent.
      yield workersForAll;
    }).catch(err => {
      done(err);
    });;
  });
});