import Koa from 'koa';
import { config, debug, error, info } from './index.js';
import { Broker } from './queue.js';

/**
 * Restfull http server for xiucall-push.
 */
class Server {

  /**
   * 
   */
  constructor(opts) {
    this.app = new Koa();
  }

  /**
   * 
   * @private
   */
  async _push(ctx) {

  }

  /**
   * 
   * @public
   */
  start() {
    this.app.listen(5000);
  }

  /**
   * 
   * @public
   */
  shutdown() {

  }
}

export {
  Server
}