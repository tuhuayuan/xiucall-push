import Koa from 'koa';
import BodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import crypto from 'crypto';
import EventEmitter from 'events';
import _ from 'lodash';
import { config, debug, error, info } from './utils.js';
import Broker from './queue.js';

/**
 * Restfull http server for xiucall-push.
 */
class Server extends EventEmitter {

  /**
   * Setup broker, koa middlewares, api handlers.
   */
  constructor(opts) {
    super();
    this.options = {};
    _.assign(this.options, Server.defaultConfigs, config.api, opts);
    this.app = new Koa();
    this.broker = new Broker();
    this.router = new Router();
    this.bodyParser = new BodyParser();
    this.healthyID = crypto.randomBytes(6).toString('hex');

    // middlewares
    this.app
      .use(this._logger)
      .use(_.bind(this._broker, this))
      .use(this.bodyParser)
      .use(this.router.routes())
      .use(this.router.allowedMethods());
    // handlers
    this.router.post('/push', this._apiPush);
    this.router.get('/queue');
    this.router.get('/healthy', this._apiHealthy);
    this.router.get('/apis', this._apiVersion);
    // Initialize status.
    this._setStatus(Server.status.wait);
  }

  /**
   * logger middleware
   * @private
   */
  async _logger(ctx, next) {
    debug(`-> ${ctx.method} | ${ctx.ip} | ${ctx.origin} | ${ctx.path} | ${ctx.request.type || ''}`);
    await next();
    debug(`<- ${ctx.status} | ${ctx.length || ''} | ${ctx.type || ''}`);
  }

  /**
   * setup broker
   */
  async _broker(ctx, next) {
    ctx.broker = this.broker;
    ctx.healthyID = this.healthyID;
    await next();
  }

  /**
   * handler for /push
   * 
   * @private
   */
  async _apiPush() {
    if (!this.is('application/json') || !this.acceptsCharsets('utf-8')) {
      this.throw('Content-Type: application/json charset: utf-8.', 400);
    }
    let jsonBody = this.request.body;
    // Check validity.
    if (!jsonBody)
      this.throw(400, 'Body required.');
    if (!jsonBody.send_id)
      this.throw(400, 'Property send_id required.');
    if (!jsonBody.channel)
      this.throw(400, 'Property channel required.');
    if (!jsonBody.recv_id || jsonBody.recv_id.length == 0)
      this.throw(400, 'Property recv_id required.');
    if (!jsonBody.data)
      this.throw(400, 'Property data required.');
    // Fill in queue message.
    let queueMessage = {
      channel: jsonBody.channel,
      from: jsonBody.send_id,
      data: jsonBody.data
    };
    // Push to each queue
    let allPushs = _.map(jsonBody.recv_id, receiver => {
      return this.broker.get(receiver, {
        mode: 'pub',
        autoCreate: this.request.query.autoCreate ? this.request.query.autoCreate : false
      }).then(queue => {
        return queue.push(queueMessage);
      });
    });
    await Promise.all(allPushs).catch(err => {
      if (this.request.query.strictMode) {
        this.throw(406, `Push not finished. err: ${err}`);
      }
    });
    this.status = 200;
    this.body = { ok: 1 };
  }

  /**
   * handler for /apis
   * 
   * @private
   */
  async _apiVersion() {
    this.status = 200;
    this.body = Server.apis;
  }

  /**
   * handler for /healthy
   * @private
   */
  async _apiHealthy() {
    // Go through queue operates and set complete timeout.
    let timeout = _.toInteger(this.query.timeout);
    timeout = timeout <= 0 ? 5000 : timeout;
    await new Promise((fulfill, reject) => {
      let timer = setTimeout(() => {
        reject(408);
      }, timeout);
      let queue;
      this.broker.get(this.healthyID, {
        mod: 'pub',
        autoCreate: true
      }).then(val => {
        queue = val;
        return queue.push({ ok: 1 });
      }).then(() => {
        return queue.close(true);
      }).then(() => {
        timer.close();
        fulfill();
        this.status = 200;
        this.body = { ok: 1 };
      }).catch(err => {
        reject(500);
      });
    }).catch(err => {
      this.status = err;
      this.body = { ok: 0 };
    });
  }

  /**
   * Change server status and emit Events.
   * @private
   */
  _setStatus(status, args) {
    this.status = status;

    process.nextTick(() => {
      this.emit(status, args);
    });
  }

  /**
   * Connect to message broker and start http server.
   * 
   * @public
   */
  async start() {
    if (this.status === Server.status.starting || this.status === Server.status.listening) {
      throw new Error(`Start on wrong status ${this.status}`);
    }
    this._setStatus(Server.status.starting);
    await this.broker.connect();
    this.server = this.app.listen(this.options.port, this.options.host);
    this._setStatus(Server.status.listening);
  }

  /**
   * Shutdown api server.
   * @public
   */
  async shutdown() {
    if (this.status !== Server.status.listening) {
      throw new Error(`Shutdown on wrong status ${this.status}`);
    }
    this._setStatus(Server.status.stopped);
    this.server.close();
    await this.broker.close();
  }
}

/**
 * Supported apis.
 */
Server.apis = {
  v1: [
    '/push',
    '/healthy',
    '/apis',
    '/queue',
    '/clients'
  ]
};

/**
 * Default config for api server.
 */
Server.defaultConfigs = {
  host: 'localhost',
  port: 5000
};

/**
 * Running status for api server.
 * 
 */
Server.status = {
  wait: 'wait',
  starting: 'connecting',
  listening: 'listening',
  stopped: 'stopped'
};

export default Server;