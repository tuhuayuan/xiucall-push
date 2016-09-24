import _ from 'lodash';
import EventEmitter from 'events';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { debug, error, info, config } from './index.js';

/**
 * 
 */
class Broker extends EventEmitter {

  /**
   * Construct a broker, but not emit any connection.
   */
  constructor(opts) {
    super();
    this.options = _.assign(Broker.defaultConfigs, config, opts);
    let o = this.options;
    let inner = {
      lazyConnect: true,
      connectTimeout: 5000
    };
    this.redisPub = new Redis(_.assign({
      sentinels: o.redis.pub.endpoints,
      name: o.redis.pub.name
    }, inner));
    this.redisSub = new Redis(o.redis.sub.host, o.redis.sub.port, inner);
    this.mongoClient = new MongoClient();
    this._setStatus(Broker.status.wait);
  }

  /**
   * Change broker status.
   * 
   * @private
   */
  _setStatus(status, args) {
    this.status = status;

    process.nextTick(() => {
      this.emit(status, args);
    });
  }

  /**
   * Do broker connect.
   * 
   * Returns: 
   * If success return Promise.resolve(this), or return Promise.reject(Error(`reason`));
   * @public
   */
  async connect() {
    if (this.status === Broker.status.connecting ||
      this.status === Broker.status.connect ||
      this.status === Broker.status.closing) {
      throw new Error(`Broker status error. ${this.status}`);
    }
    this._setStatus(Broker.status.connecting);

    // The ioredis do not complain the sentinel timeout between conncet -> ready.
    let sentinelPromise = new Promise((fulfill, reject) => {
      let sentinelTimeout = setTimeout(() => {
        reject(new Error('Sentinels timeout.'));
      }, 5000);
      this.redisPub.connect().then(val => {
        sentinelTimeout.close();
        fulfill(val);
      });
    });

    await Promise.all([
      MongoClient.connect(this.options.mongo)
      .then(val => {
        this.mongo = val;
      }),
      sentinelPromise,
      this.redisSub.connect()
    ]).catch(err => {
      throw new Error(`Broker connect failed, err: ${err}.`);
    });
    this._setStatus(Broker.status.connect);
    return this;
  }

  /**
   * Close broker release all resource.
   * 
   * Returns:
   * If success return Promise.resolve(), or Promise.reject(Error(`$reason`))
   * @public
   */
  async close() {
    if (this.status === Broker.status.end ||
      this.status == Broker.status.wait ||
      this.status == Broker.status.closing) {
      throw new Error(`Close failed. error status ${this.status}`);
    }
    this._setStatus(Broker.status.closing);
    // BUG: After ioredis quit promise resolved, status still ready.
    let redisQuit = function(client) {
      return new Promise((fulfill, reject) => {
        client.once('end', fulfill);
        client.quit().catch(err => {
          reject(err);
        });
      })
    };
    await Promise.all([
      this.mongo.close(),
      redisQuit(this.redisPub),
      redisQuit(this.redisSub)
    ]).catch(err => {
      debug(`Close broker err: ${err}`);
    });
    this._setStatus(Broker.status.end);
  }

  /**
   * Get queue by authid.
   * 
   * opts.mode 'pub'(default) || 'sub'
   * opts.autoCreate true || false (default)
   * 
   * Return:
   * If success return Promise.resolve(Queue), or Promise.reject(Error)
   * @public
   */
  async get(id, opts) {
    if (this.status !== Broker.status.connect) {
      throw new Error(`Get queue err: status ${this.status} `);
    }
    if (!_.isString(id) || id.length === 0) {
      throw new Error(`Param 'id' not correct`);
    }
    opts = _.assign(opts, { cappedSize: this.options.queue.size });
    return await Queue.create(id, this, opts).catch((err) => {
      throw new Error(`Get queue ${id} err: ${err}`);
    });
  }
}

/**
 * Broker status.
 * (end || wait) -> connecting -> connect -> closing -> end.
 */
Broker.status = {
  wait: 'wait',
  connecting: 'connecting',
  connect: 'connect',
  closing: 'closing',
  end: 'end'
};

/**
 * Config template and default value for broker.
 * `pub` is redis sentinels config for writable redis node.
 * `sub` is for readonly redis node. (use kubernetes service for LBS)
 * `pub.endpoints` 
 */
Broker.defaultConfigs = {
  redis: {
    pub: {
      endpoints: [
        { host: 'localhost', port: 26379 }
      ],
      name: 'mymaster'
    },
    sub: {
      host: 'localhost',
      port: 6379
    }
  },
  mongo: 'mongodb://localhost:27017/messages',
  queue: {
    size: 1024 * 1024 * 2 // size in byte
  }
};

class Queue extends EventEmitter {

  /**
   * Construct queue instance.
   * 
   * DO NOT use new Queue yourself, use Broker.prototype.get.
   * @private
   */
  constructor(opts) {
    super();
    this.cappedSize = opts.cappedSize;
    this.authid = opts._authid;
    this.messageChannel = `mch_${this.authid}`;
    this.mode = opts.mode || 'pub';
    this.autoCreate = opts.autoCreate || false;
    this.broker = opts._broker;
    this._setStatus(Queue.status.connecting);
  }

  /**
   * Build up the queue.
   * 
   * @private
   */
  async _build() {
    if (this.status !== Queue.status.connecting) {
      throw new Error(`Build on error status ${this.status}`);
    }
    // Using mongodb capped collection for queue message storage.
    let mongo = this.broker.mongo;
    this.store = await new Promise((fulfill, reject) => {
      mongo.collection(this.authid, { strict: true }, (err, col) => {
        if (err && this.autoCreate) {
          mongo.createCollection(this.authid, {
            capped: true,
            size: this.cappedSize
          }).then(col => {
            fulfill(col);
          }).catch(err => {
            reject(new Error(`Queue ${this.authid} create failed. err ${err}`));
          });
        } else if (!err) {
          fulfill(col);
        } else {
          reject(new Error(`Queue ${this.authid} not exist.`));
        }
      });
    }).catch(err => {
      throw err;
    });

    // Pub is reuse.
    this.pub = this.broker.redisPub;

    // Clone a redis connect for Subscriber.
    if (this.mode === 'sub') {
      this.sub = this.broker.redisSub.duplicate();
      await this.sub.connect().catch(err => {
        throw new Error(`Subscriber ${this.authid} connect failed err: ${err}`);
      });
      this.sub.on('message', (channel, message) => {
        if (channel === this.messageChannel && this.status === Queue.status.peeking) {
          this._peekingFulfill(message);
        }
      });
      await this.sub.subscribe(this.messageChannel);
    }
    // Die on broker end.
    this.broker.once('end', () => {
      this.close();
    });
    this._setStatus(Queue.status.ready);
  }

  /**
   * Push a json object to queue.
   * the json object store in `payload` property of message.
   * {
   *   _id: ObjectID(),
   *   acked: false || true,
   *   ackTime: Date(),
   *   payload: obj
   * }
   * For publisher && subscriber
   * If success resolved with true.
   * @public
   */
  async push(obj) {
    if (this.status !== Queue.status.ready && this.status !== Queue.status.peeking) {
      throw new Error(`Push on error status ${this.status}`);
    }
    if (!_.isPlainObject(obj)) {
      throw new Error('Error push object type.');
    }
    await this.store.insertOne({
      payload: obj,
      acked: false,
      lastDate: new Date()
    }).catch(err => {
      throw new Error(`Push to queue err ${err}`);
    });
    let result = await this.pub.publish(this.messageChannel, {});
    if (result > 0) {
      return true;
    }
    return false;
  }

  /**
   * Get message from head of the queue.(not remove it)
   * For subscriber.
   * Return the json object.
   * @public
   */
  async peek() {
    if (this.status !== 'ready') {
      throw new Error(`Peek on error queue status ${this.status}`);
    }
    if (this.mode !== 'sub') {
      throw new Error(`Can't peek on mode ${this.mode}`);
    }
    this._setStatus(Queue.status.peeking);
    // Get message direct from store or wait message incoming notify.
    while (true) {
      let signal = new Promise((fulfill, reject) => {
        // signal hook.
        this._peekingFulfill = fulfill;
        this._peekingReject = reject;
      }).catch(err => {
        throw new Error(`Peeking canceled err: ${err}`);
      });
      let message = await this.store.findOne({ acked: false });
      if (message) {
        this._setStatus(Queue.status.ready);
        return message;
      } else {
        await signal;
      }
    }
  }

  /**
   * Remove a message from the head of the queue.
   * 
   * Return true: message commited, false: no change
   * @public
   */
  async commit() {
    if (this.status !== Queue.status.ready && this.status !== Queue.status.peeking) {
      throw new Error(`Commit on error status ${this.status}`);
    }
    if (this.mode !== 'sub') {
      throw new Error(`Can't peek on mode ${this.mode}`);
    }
    let result = await this.store.findOneAndUpdate({
      acked: false
    }, {
      $set: {
        acked: true,
        lastDate: new Date()
      }
    }).catch(err => {
      throw new Error(`Commit error: ${err}`);
    });

    if (result.ok === 1) {
      return true;
    }
    return false;
  }

  /**
   * Close queue and release subscriber resource.
   * 
   * Return Promise.resolve()
   * @public
   */
  async close() {
    if (this.status === Queue.status.end || this.status === Queue.status.closing) {
      throw new Error('Queue is closing or closed.');
    }
    if (this.status === Queue.status.peeking) {
      this._peekingReject('User close.');
    }
    this._setStatus(Queue.status.closing);

    if (this.mode === 'sub') {
      await this.sub.quit();
    }
    this._setStatus(Queue.status.end);
  }

  /**
   * Change queue status and emit Events.
   * @private
   */
  _setStatus(status, args) {
    this.status = status;

    process.nextTick(() => {
      this.emit(status, args);
    });
  }
}

/**
 * Queue factory.
 * 
 * @private
 */
Queue.create = async function(id, broker, opts) {
  opts = _.assign(opts, { _authid: id, _broker: broker });
  let q = new Queue(opts);
  await q._build().catch((err) => {
    throw new Error(`Queue ${id} create failed err: ${err}`);
  });
  return q;
};

/**
 * status: connecting -> (ready <-> peeking) －> closing -> end 
 */
Queue.status = {
  connecting: 'connecting',
  ready: 'ready',
  peeking: 'peeking',
  closing: 'closing',
  end: 'end'
};

export {
  Broker
}