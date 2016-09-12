var config = require("./config");
var restify = require("restify");
var crypto = require('crypto');
var winston = require('winston');
var Redis = require('ioredis');
var SocketIO = require('socket.io');
var co = require('co');
var MongoClient = require('mongodb').MongoClient;

var logger = new(winston.Logger)({
  transports: [
    new(winston.transports.Console)()
  ],
  level: config.logger.level
});


var format = function(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

setInterval(() => {
  let mem = process.memoryUsage();
  console.log('Process: heapTotal ' + format(mem.heapTotal) + ' heapUsed ' + format(mem.heapUsed) + ' rss ' + format(mem.rss));

}, 50000);

co(function*() {
  // MongoDB server
  let mongodb =
    yield MongoClient.connect(config.mongo.url);
  logger.info('MongoDB connected');

  // Redis server
  let roClient = new Redis(config.slave.host, config.slave.port, {
    lazyConnect: true
  });
  let client = new Redis({
    sentinels: [{
      host: config.sentinel.host,
      port: config.sentinel.port
    }],
    name: config.sentinel.name,
    lazyConnect: true
  });
  yield [client.connect(), roClient.connect()];
  logger.info('Redis connected');

  // RESTFull server.
  let server = restify.createServer();
  server.listen(config.web.port);
  logger.info('RESTFull server listen on :' + config.web.port);

  server.use(restify.bodyParser());
  let pushCallback = co.wrap(function*(request, response, next) {
    if (!request.is('application/json')) {
      return next(new restify.InvalidContentError("Need application/json"));
    }
    let jsonBody = request.body;
    if (!jsonBody || typeof jsonBody !== 'object')
      return next(new restify.InvalidContentError("body required."));
    if (!jsonBody.send_id)
      return next(new restify.InvalidContentError("send_id required."));
    if (!jsonBody.channel)
      return next(new restify.InvalidContentError("channel required."));
    if (!jsonBody.recv_id || jsonBody.recv_id.length == 0)
      return next(new restify.InvalidContentError("recv_id required."));
    if (!jsonBody.data)
      return next(new restify.InvalidContentError("data required."));
    let msgObj = {};
    msgObj.channel = jsonBody.channel;
    msgObj.from = jsonBody.send_id;
    msgObj.data = jsonBody.data;
    jsonBody.recv_id.forEach(receiver => {
      mongodb.collection(receiver, {
        strict: true
      }, co.wrap(function*(err, col) {
        if (!err) {
          logger.debug('Insert to %s, %s', receiver, msgObj);
          let insResult =
            yield col.insertOne({
              payload: msgObj,
              acked: false
            });
          if (insResult.insertedCount > 0) {
            logger.debug('Notify message channel %s', receiver);
            yield client.publish('m_' + receiver, false);
          }
        }
        // Don't do anything if number not logged before.
      }));
    });
    response.send(200);
    return next();
  });
  server.post('/push', pushCallback);

  // SocketIO server
  let socketio = SocketIO(config.socketio.port);
  logger.info('SocketIO server listen on :' + config.socketio.port);
  let socketioAuth = co.wrap(function*(socket, next) {
    let headers = socket.request.headers;
    let nbb_authid = headers['x-nbb-authid'];
    let nbb_sign = headers['x-nbb-sign'];
    let hasher = crypto.createHash("md5");
    let authed = false;

    if (nbb_authid && nbb_sign) {
      let result = nbb_sign.split(",");
      if (result.length > 1) {
        hasher.update(result[1] + config.auth.key + nbb_authid);
        if (result[0] === hasher.digest('hex')) {
          // Auth OK.
          authed = true;
        }
      }
    }

    if (!authed) {
      logger.debug('Disconnect by auth error');
      socket.disconnect();
      return;
    }

    // message queue
    mongodb.collection(nbb_authid, {
      strict: true
    }, co.wrap(function*(err, col) {

      if (err) {
        logger.debug('First create queue %s', nbb_authid);
        col =
          yield mongodb.createCollection(nbb_authid, {
            capped: true,
            size: config.push.queue_size
          });
      }
      socket.queue = col;
      socket.authid = nbb_authid;
      socket.mch = 'm_' + socket.authid;
      socket.cch = 'c_' + socket.authid;
      socket.redisClient = roClient.duplicate();
      socket.isCommitting = true;
      socket.waiting = 0;
      // Clean redis connection when socketio disconnected.
      socket.on('disconnect', () => {
        logger.debug('id: ' + socket.authid + ' socket: ' + socket.id + ' disconnected.');
        socket.redisClient.disconnect();
      });
      yield socket.redisClient.connect();

      let kickId =
        yield client.incr('i_' + socket.authid);
      socket.index = kickId;

      let onControlChannel = co.wrap(function*(message, socket) {
        if (message > socket.index) {
          logger.debug('Kicked: %s, %d, %d', socket.authid, socket.index, message);
          socket.disconnect();
        } else if (message < socket.index) {
          yield client.publish(socket.cch, socket.index);
        }
      });

      let onMessageChannel = co.wrap(function*(nullAble, socket) {
        logger.debug('Message channel %s:%s, %s, %s', socket.id, socket.authid, socket.isCommitting, nullAble);
        if (socket.isCommitting) {
          socket.isCommitting = false;
          let msgArray = new Array();
          let msgObj =
            yield socket.queue.findOne({
              acked: false
            });
          if (msgObj) {
            msgArray.push(msgObj.payload);
          }

          if (msgArray.length == 0 && nullAble == 'false') {
            socket.isCommitting = true;
            if (socket.waiting > 0) {
              logger.debug('Message not found, retry on waitings %d', socket.waiting);
              socket.waiting -= 1;
              client.publish(socket.mch, nullAble);
            }
          } else {
            logger.debug('Message %d to %s:%s waitings %s cleared.', msgArray.length, socket.id, socket.authid, socket.waiting);
            socket.waiting = 0;
            socket.emit('message', msgArray);
          }
        } else {
          // Increase waiting counter.
          socket.waiting += 1;
        }
      });

      // Process subscribed message.
      socket.redisClient.on('message', function(channel, message) {
        if (channel === socket.mch) {
          onMessageChannel(message, socket);
        } else if (channel === socket.cch) {
          onControlChannel(message, socket);
        } else {
          logger.error('Unexpected channel message.');
        }
      });
      // Login control channel.ach
      yield socket.redisClient.subscribe(socket.cch);
      // Message nofity channel.
      yield socket.redisClient.subscribe(socket.mch);
      // Send kick message.
      yield client.publish(socket.cch, kickId);
      // Send pushing nofitfy
      yield client.publish(socket.mch, true);
      return next();
    }));
  });
  socketio.use(socketioAuth);
  socketio.on('connection', function(socket) {
    logger.debug('socket ' + socket.id + ' id: ' + socket.authid + ' connected.');
    socket.on('commit', co.wrap(function*(count) {
      logger.debug('client %s commit %d.', socket.authid, count);
      if (!socket.isCommitting) {
        for (let i = 0; i < count; i++) {
          yield socket.queue.findOneAndUpdate({
            acked: false
          }, {
            $set: {
              acked: true
            }
          });
        }
        socket.isCommitting = true;
        yield client.publish(socket.mch, false);
      }
    }));
  });
}).catch(function onerror(err) {
  logger.error('Uncatched exception : %s', err.stack);
});