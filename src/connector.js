import _ from 'lodash';
import Redis from 'ioredis';
import crypto from 'crypto';
import http from 'http';
import EventEmitter from 'events';
import SocketIO from 'socket.io';
import Broker from './queue.js';
import { config, debug, error, info } from './utils.js';

class Connector extends EventEmitter {

  /**
   * Setup socket.io server, auth middlewares.
   */
  constructor(opts) {
    super();
    this.options = {};
    _.assign(this.options, config.connector, opts);

    this.broker = new Broker();
    this.server = http.createServer();
    this.socketio = new SocketIO(this.server, {
      transports: ['websocket']
    });

    this.socketio.use(_.bind(this._authHandler, this));
    this.socketio.use(_.bind(this._initHandler, this));
    this.socketio.on('connection', _.bind(this._connectHandler, this));
  }

  /**
   * start connector.
   * @public
   */
  async start() {
    await this.broker.connect();
    this.session = await SessionManager.create(this.options);
    this.session.on('kicked', _.bind(this._kickedHandler, this));
    this.server.listen(this.options.port, this.options.host);
  }

  /**
   * stop connector.
   * @public
   */
  async shutdown() {
    this.server.close();
    await this.session.close();
    await this.broker.close();
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
   * middleware for socketio server.
   * @socket socketio socket.
   * @next function for next middleware.
   */
  _authHandler(socket, next) {
    let headers = socket.request.headers;
    let nbbAuthid = headers['x-nbb-authid'];
    let nbbSign = headers['x-nbb-sign'];
    let hash = crypto.createHash("md5");
    socket.authenticated = false;
    if (nbbAuthid && nbbSign) {
      let result = nbbSign.split(",");
      if (result.length > 1) {
        hash.update(result[1] + config.connector.authKey + nbbAuthid);
        if (result[0] === hash.digest('hex')) {
          socket.authenticator = nbbAuthid;
          return next();
        }
      }
    }
    socket.disconnect();
  }

  /**
   * middleware for initialize
   * @private
   */
  _initHandler(socket, next) {
    this.broker.get(socket.authenticator, {
      autoCreate: true,
      mode: 'sub'
    }).then(val => {
      socket.queue = val;
      socket.on('disconnect', this._disconnectHandler);
      return this.session.join(socket.authenticator, socket);
    }).then(val => {
      socket.sessionID = val;
      socket.sessionManager = this.session;
      return next();
    }).catch(err => {
      socket.disconnect();
    });
  }

  /**
   * Handle client connection then send a void message.
   * Bind#this
   * @private
   */
  _connectHandler(socket) {
    socket.on('commit', this._commitHandler);
    socket.emit('message', []);
  }

  /**
   * Handle queue commit.
   * Bind#socket
   * @private
   */
  _commitHandler(count) {
    let socket = this;
    let commit = Promise.resolve();
    if (_.toInteger(count) > 0) {
      commit = socket.queue.commit();
    }
    commit.then(() => {
      return socket.queue.peek();
    }).then(msg => {
      socket.emit('message', [msg.payload]);
    }).catch(err => {
      debug(`${socket.sessionID} peek error ${err}`);
    });
  }

  /**
   * Handle client disconnect.
   * Bind#socket
   * @private
   */
  _disconnectHandler() {
    if (this.queue) {
      this.queue.close().catch(err => {
        info(`Queue close error: ${err}`);
      });
    }
    if (this.sessionManager) {
      this.sessionManager.remove(this.sessionID).catch(err => {
        info(`Session manager remove error: ${err}`);
      });
    }
  }

  /**
   * Handle kicked message from session manager.
   * Bind#this
   * @private
   */
  _kickedHandler(sessionID, socket) {
    socket.disconnect();
  }
}

/**
 * Connector status.
 */
Connector.status = {
  wait: 'wait',
  starting: 'connecting',
  listening: 'listening',
  stopped: 'stopped'
}

/**
 * SessionManager for connector using redis.
 * @private 
 */
class SessionManager extends EventEmitter {
  constructor(opts) {
    super();
    this.options = {};
    _.assign(this.options, config.session, opts);
    this.redisPub = new Redis(_.assign({}, this.options.redis, {
      lazyConnect: true
    }));
    this.clientMap = new Map();
    this.redisSub = this.redisPub.duplicate();
    this.redisSub.on('pmessage', _.bind(this._onMessage, this));
  }

  /**
   * Need two master connection.
   * @private 
   */
  async _connect() {
    await Promise.all([
      this.redisPub.connect(),
      this.redisSub.connect()
    ]).catch(err => {
      throw new Error(`Session manager connect error: ${err}`);
    });
  }

  /**
   * Close the session.
   * @public
   */
  async close() {
    await this.redisSub.punsubscribe()
      .then(() => {
        Promise.all([
          this.redisPub.quit(),
          this.redisSub.quit()
        ])
      }).catch(err => {
        throw new Error(`Session manager disconnect error: ${err}`);
      });
  }

  /**
   * A new client join in.
   * return a string for session id.
   * @public
   */
  async join(id, args = undefined) {
    let randomID = crypto.randomBytes(4).toString('hex');
    let clientID = `session_${id}`;
    let sessionID = `${clientID}_${randomID}`;
    let token = await this.redisPub.incr(`index_${id}`);
    let clients = this.clientMap.get(clientID);
    if (!clients) {
      clients = new Map();
    }
    clients.set(randomID, { index: token, args: args });
    this.clientMap.set(clientID, clients);
    await this.redisSub.psubscribe(`${clientID}_*`);
    await this.redisPub.publish(sessionID, token);
    return sessionID;
  }

  /**
   * remove with session id which returned by join
   * @public
   */
  async remove(sessionID) {
    const [prefix, id, randomID] = _.split(sessionID, '_', 3);
    if (prefix !== 'session') {
      return;
    }
    const clientID = `${prefix}_${id}`;
    const clients = this.clientMap.get(clientID);
    if (_.isUndefined(clients) || _.isEmpty(clients)) {
      return;
    }
    clients.delete(randomID);
    if (clients.size === 0) {
      await this.redisSub.punsubscribe(`${clientID}_*`);
    }
  }

  /**
   * Handler redis subscribed message.
   * Bind#this
   * @private
   */
  _onMessage(pattern, sessionID, token) {
    const [prefix, id, randomID] = _.split(sessionID, '_', 3);
    if (prefix !== 'session') {
      return;
    }
    const clientID = `${prefix}_${id}`;
    const clients = this.clientMap.get(clientID);
    if (_.isUndefined(clients) || _.isEmpty(clients)) {
      return;
    }
    const indexRemote = _.toInteger(token);
    clients.forEach((val, randomID) => {
      const indexLocal = val.index;
      const args = val.args;

      // The lower index will be kickout.
      const localSession = `${clientID}_${randomID}`;
      if (indexRemote > indexLocal) {
        this.remove(localSession);
        this.emit('kicked', localSession, args);
      } else if (indexRemote < indexLocal) {
        this.redisPub.publish(localSession, indexLocal);
      }
    });
  }
}

/**
 * SessionManager factory
 */
SessionManager.create = async function(opts) {
  let ret = new SessionManager(opts);
  await ret._connect().catch(err => {
    throw new Error(`Create session manager error: ${err}`);
  });
  return ret;
}

export default Connector;