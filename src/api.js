import _ from 'lodash';
import Koa from 'koa';
import BodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import Validate from 'koa-validate';
import logger from 'koa-logger';
import crypto from 'crypto';
import EventEmitter from 'events';
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
    this.healthyID = crypto.randomBytes(6).toString('hex');
    this.options = {};
    _.assign(this.options, config.api, opts);
    // build koa app.
    this.app = new Koa();
    this.broker = new Broker();
    this.router = new Router(); // for api router.
    this.bodyParser = new BodyParser(); // for json body parse.
    Validate(this.app); // for params validate.
    // build api routers.
    this.router
      .post('/push', this._apiPush)
      .get('/queues/:id', this._apiGetQueue)
      .get('/watch/:id', this._apiWatchQueue)
      .get('/healthy', this._apiHealthy)
      .get('/apis', this._apiVersion);
    // build koa middlewares
    if (config.logger.level === 'debug') {
      this.app.use(logger());
    }
    this.app
      .use(_.bind(this._init, this))
      .use(this.bodyParser)
      .use(this.router.routes())
      .use(this.router.allowedMethods());
    this._setStatus(Server.status.wait);
  }

  /**
   * add objects to koa context.
   * @private
   */
  async _init(ctx, next) {
    ctx.broker = this.broker;
    ctx.healthyID = this.healthyID;
    await next();
  }

  /**
   * /push?autoCreate=
   * @private
   */
  async _apiPush() {
    if (!this.is('application/json') || !this.acceptsCharsets('utf-8')) {
      this.throw('Content-Type: application/json charset: utf-8.', 400);
    }
    let jsonBody = this.request.body;
    this.errors = [];
    // Check validity.
    if (!jsonBody)
      this.errors.push('Body required.');
    if (!jsonBody.send_id)
      this.errors.push('Property send_id required.');
    if (!jsonBody.channel)
      this.errors.push('Property channel required.');
    if (!jsonBody.recv_id || jsonBody.recv_id.length == 0)
      this.errors.push('Property recv_id required.');
    if (!jsonBody.data)
      this.errors.push('Property data required.');
    if (this.errors.length > 0) {
      this.status = 400;
      this.body = {
        ok: 0,
        errors: this.errors
      }
      return;
    }
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
        autoCreate: !!this.request.query.autoCreate
      }).then(queue => {
        return queue.push(queueMessage);
      }).then(() => {
        return true;
      }).catch(err => {
        return false;
      });
    });
    let send = _.reduce(await Promise.all(allPushs), (m, n) => {
      if (n) {
        m += 1;
      }
      return m;
    }, 0);
    this.status = 200;
    this.body = {
      ok: 1,
      send: send
    };
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
   * /queues/:id?since=1477312333&&limit=100
   * @private
   */
  async _apiGetQueue() {
    this.checkQuery('since').optional().isInt().gt(0);
    this.checkQuery('limit').optional().isInt().gt(0);
    if (this.errors) {
      this.status = 400;
      this.body = {
        ok: 0,
        errors: this.errors
      };
      return;
    }
    let opt = {};
    if (this.query.since) {
      this.query.since = new Date(this.query.since * 1000);
    }
    _.assign(opt, this.query);
    try {
      let broker = new Broker();
      await broker.connect();
      let queue = await broker.get(this.params.id, {
        mode: 'pub',
        autoCreate: false
      });
      let results = await queue.query(opt);
      this.body = {
        ok: 1,
        messages: results
      };
    } catch (err) {
      this.body = {
        ok: 0,
        errors: [err]
      }
    }
    this.status = 200;
  }

  /**
   * /watch/:id?channel=<number>
   * @private
   */
  async _apiWatchQueue() {
    this.checkQuery('channel').optional().isInt().gt(0).lt(16).default(10);
    if (this.errors) {
      this.status = 400;
      this.body = {
        ok: 0,
        errors: this.errors
      };
      return;
    }
    try {
      let broker = new Broker();
      await broker.connect();
      let queue = await broker.get(this.params.id, {
        mode: 'sub',
        autoCreate: true,
        channel: this.query.channel
      });
      let res = await queue.peek();
      this.body = {
        ok: 1,
        message: res
      };
    } catch (err) {
      this.body = {
        ok: 0,
        errors: [err]
      }
    }
    this.status = 200;
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
    '/queues',
    '/watch'
  ]
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