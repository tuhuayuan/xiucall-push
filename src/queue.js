import _ from 'lodash';
import EventEmitter from 'events';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { debug, error, info, config } from './index.js';


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
    // end(or wait) -> connecting -> connect -> end
    this.status = Broker.status.wait;
  }

  /**
   * Change broker status.
   * 
   * @private
   */
  setStatus(status, args) {
    this.status = status;

    process.nextTick(() => {
      this.emit(status, args);
    });
  }

  /**
   * 
   * @public
   */
  async connect() {
    if (this.status === Broker.status.connecting || this.status === Broker.status.connect) {
      throw new Error('Broker status error.');
    }
    this.setStatus(Broker.status.connecting);

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

    this.setStatus(Broker.status.connect);
  }

  /**
   * Close broker release all resource.
   * 
   * @public
   */
  async close() {
    if (this.status === Broker.status.end || this.status == Broker.status.wait) {
      throw new Error(`Close failed. error status ${this.status}`);
    }
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
    this.setStatus(Broker.status.end);
  }

  /**
   * Get queue by authid.
   * 
   * opts.mode 'pub'(default) || 'sub'
   * opts.autoCreate true || false (default)
   * 
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

Broker.status = {
  wait: 'wait',
  connecting: 'connecting',
  connect: 'connect',
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
    size: 1024 * 1024 * 2
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
    this.cappedSize = opts.cappedSize || 1024 * 1024 * 2;
    this.authid = opts._authid;
    this.messageChannel = `mch_${this.authid}`;
    this.mode = opts.mode || 'pub';
    this.autoCreate = opts.autoCreate || false;
    this.broker = opts._broker;
  }

  /**
   * Build up the queue.
   * 
   * @private
   */
  async build() {
    // Using mongodb capped collection for queue message storage.
    let mongo = this.broker.mongo;
    this.store = await new Promise((fulfill, reject) => {
      mongo.collection(this.authid, { strict: true }, (err, col) => {
        if (err && this.autoCreate) {
          mongo.createCollection(this.authid, {
            capped: true,
            size: this.cappedSize
          }).then(coll => {
            fulfill(coll);
          }).catch(err => {
            reject(new Error(`Queue ${this.authid} create failed. err ${err}`));
          });
        } else if (!err) {
          fulfill(coll);
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
      this.sub = await this.broker.redisSub.duplicate()
        .connect()
        .catch(err => {
          throw new Error(`Subscriber ${this.authid} connect failed err: ${err}`);
        });
      this.sub.on('message', this._subscribeHandler);
      await this.sub.subscribe(this.messageChannel);
    }
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
    if (!_.isPlainObject(obj)) {
      throw new Error('Error push object type.');
    }
    await this.store.insertOne({
      payload: obj,
      acked: false
    }).catch(err => {
      throw new Error(`Push to queue err ${err}`);
    });
    await this.pub.publish(this.messageChannel, {});
    return true;
  }

  /**
   * Get message from head of the queue.(not remove it)
   * For subscriber.
   * Return the json object.
   * @public
   */
  async peek() {

  }

  async commit() {}

  /**
   * Close queue and release subscriber resource.
   * 
   * @public
   */
  async close() {

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

  /**
   * Handle subscribed message.
   * 
   * `channel`  Redis pub/sub channel.
   * `message`  options of channel.
   * @private
   */
  _subscribeHandler(channel, message) {
    if (channel !== this.messageChannel) {
      return;
    }
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
  await q.build().catch((err) => {
    error(`Queue ${id} create failed err: ${err}`);
  });
  return q;
};

/**
 * status: wait -> ready -> end || kicked 
 * Watch out !! the queue instance cannot reuse.
 */
Queue.status = {

};

export {
  Broker
}