import should from 'should';
import _ from 'lodash';
import crypto from 'crypto';
import { config, debug, info } from '../../src/utils.js';
import Connector from '../../src/connector.js';

class FackeSocket {
  constructor(reject, headers) {
    this.reject = reject;
    this.request = {};
    this.request.headers = headers;
  }

  disconnect() {
    this.reject();
  }
}

function getSignature(date, id, key) {
  let timestamp = Math.floor(date.getTime() / 1000);
  let hasher = crypto.createHash("md5");
  hasher.update(`${timestamp}${key}${id}`);
  return `${hasher.digest('hex')},${timestamp}`;
}

describe('Connector auth.', function() {
  before(function() {
    this.connector = new Connector();
    this.connector._setStatus(Connector.status.ready);
    this.authID = crypto.randomBytes(6).toString('hex');
    console.log
    this.authKey = config.connector.authKey;
  });

  it('Test auth with legally headers.', function(done) {
    let socket = new FackeSocket(() => {
      done(new Error('Should ok.'));
    }, {
      'x-nbb-authid': this.authID,
      'x-nbb-sign': getSignature(new Date(), this.authID, this.authKey)
    });
    this.connector._authHandler(socket, () => {
      done();
    });
  });

  it('Test auth with illegally headers.', function(done) {
    let socket = new FackeSocket(() => {
      done();
    }, {
      'x-nbb-authid': this.authID,
      'x-nbb-sign': getSignature(new Date(), this.authID + '@', this.authKey)
    });
    this.connector._authHandler(socket, () => {
      done(new Error('Should not ok'));
    });
  });

  it('Test auth with very old timestamp.', function(done) {
    let now = new Date();
    let socket = new FackeSocket(() => {
      done();
    }, {
      'x-nbb-authid': this.authID,
      'x-nbb-sign': getSignature(new Date(now.setMinutes(-15)), this.authID, this.authKey)
    });
    this.connector._authHandler(socket, () => {
      done(new Error('Should not ok'));
    });
  })
});