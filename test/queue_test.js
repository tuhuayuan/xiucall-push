import 'babel-polyfill';
import assert from 'assert';
import should from 'should';
import crypto from 'crypto';
import { config, logger, debug, info, error } from '../lib/index.js';
import { Broker } from '../lib/queue.js';


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

describe('Broker exception tests.', function() {
  it('Test unreachable mongodb config.', function(done) {
    let opts = {
      mongo: 'mongodb://localhost:22222/messagessss'
    };
    let broker = new Broker(opts);
    broker.connect().catch(function(err) {
      should.exist(err);
      done();
    });
  });
});

describe('Queue build tests.', function() {
  beforeEach(function(done) {
    this.broker = new Broker();
    this.broker.connect().then(function(val) {
      done(val);
    }).catch(function(err) {
      done(err);
    });
  });
  afterEach(function(done) {
    should.exist(this.broker);
    this.broker.close().then(function(val) {
      done();
    }).catch(function(err) {
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
          password: '123',
          roles: ['admin', 'user']
        }
      }).then(val => {
        done();
      }).catch(err => {
        done(err);
      });
    }).catch(function(err) {
      done(err);
    });
  });
});