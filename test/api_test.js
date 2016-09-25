import 'babel-polyfill';
import should from 'should';
import urllib from 'urllib';
import { config } from '../lib/utils.js';
import { Server } from '../lib/api.js';


describe('API http server tests.', () => {
  before(function() {
    let api = new Server();
    api.start();
  });

  it('Test server existing.', function(done) {
    urllib.request(config.api.host, (err, data, res) => {
      done(err);
    });
  });
});