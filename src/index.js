import nconf from 'nconf';
import winston from 'winston';

let config = nconf.argv().env().file('./conf/config.json');

nconf.defaults({
  'NODE_ENV': 'development'
});

// Get profile config
config = config.get(config.get('NODE_ENV'));

// Create logger
let level = 'info';
if (config.logger && config.logger.level) {
  level = config.logger.level;
}
let logger = new(winston.Logger)({
  transports: [
    new(winston.transports.Console)()
  ],
  level: level
});

let debug = logger.debug;
let info = logger.info;
let error = logger.error;

export {
  config,
  logger,
  debug,
  info,
  error
}