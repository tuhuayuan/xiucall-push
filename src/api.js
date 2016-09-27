import Koa from 'koa';
import BodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import _ from 'lodash';
import { config, debug, error, info } from './utils.js';
import { Broker } from './queue.js';

/**
 * Restfull http server for xiucall-push.
 */
class Server {

  /**
   * Setup broker, koa middlewares, api handlers.
   */
  constructor(opts) {
    this.options = _.assign(Server.defaultConfigs, config.api, opts);
    this.app = new Koa();
    this.broker = new Broker();
    this.router = new Router();
    this.bodyParser = new BodyParser();

    // middlewares
    this.app
      .use(this._logger)
      .use(_.bind(this._broker, this))
      .use(this.bodyParser)
      .use(this.router.routes())
      .use(this.router.allowedMethods());

    // handlers
    this.router.post('/push', this._apiPush);
    this.router.post('/healthy', this._apiHealthy);
    this.router.get('/apis', this._apiVersion);
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
    await next();
  }

  /**
   * handler for /push
   * 
   * @private
   */
  async _apiPush() {
    if (!this.is('application/json') || !this.acceptsCharsets('utf-8')) {
      this.throw('Accept application/json utf-8.', 400);
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
        autoCreate: false
      }).then(queue => {
        queue.push(queueMessage);
      });
    });
    await Promise.all(allPushs).catch(err => {
      if (this.request.query.strict) {
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
   * 
   * @private
   */
  async _apiHealthy(ctx) {

  }


  /**
   * Connect to message broker and start http server.
   * 
   * @public
   */
  async start() {
    await this.broker.connect();
    this.app.listen(this.options.port, this.options.host);
  }

  /**
   * 
   * @public
   */
  async shutdown() {
    await this.broker.close();
  }
}

/**
 * Supported apis.
 */
Server.apis = {
  v1: [
    "/push",
    "/healthy",
    "/apis"
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
Server.status = {};

export {
  Server
}