const EventEmitter = require('events');

class Broker extends EventEmitter {

}

class Queue extends EventEmitter {
    constructor(opts) {
        super();
    }

    /**
     * 获取对应的ID的队列
     */
    get(id) {}

    /**
     * 
     */
    push(obj) {}

    commit() {}
}

module.exports = Queue;