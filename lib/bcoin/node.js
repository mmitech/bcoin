/**
 * node.js - full node for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * https://github.com/indutny/bcoin
 */

var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;
var bcoin = require('../bcoin');
var bn = require('bn.js');
var constants = bcoin.protocol.constants;
var network = bcoin.protocol.network;
var utils = bcoin.utils;
var assert = utils.assert;
var fs = bcoin.fs;

/**
 * Node
 */

function Node(options) {
  if (!(this instanceof Node))
    return new Node(options);

  EventEmitter.call(this);

  if (!options)
    options = {};

  this.options = options;

  if (this.options.debug)
    bcoin.debug = this.options.debug;

  if (this.options.network)
    network.set(this.options.network);

  this.storage = null;
  this.mempool = null;
  this.pool = null;
  this.chain = null;

  Node.global = this;

  this._init();
}

inherits(Node, EventEmitter);

Node.prototype._init = function _init() {
  var self = this;

  if (!this.options.pool)
    this.options.pool = {};

  this.options.pool.type = 'full';

  this.storage = new bcoin.blockdb(this.options.storage);
  this.mempool = new bcoin.mempool(this, this.options.mempool);
  this.pool = new bcoin.pool(this.options.pool);
  this.chain = this.pool.chain;

  this.pool.on('block', function(block, peer) {
    self.storage.saveBlock(block, function(err) {
      if (err)
        throw err;

      self.mempool.addBlock(block);
      var hash = block.txs[0].hash('hex');
      if (0)
      self.storage.getTX(hash, function(err, tx) {
        if (err) throw err;
        utils.print(tx);
      });
      self.storage.getCoin(hash, 0, function(err, tx) {
        if (err) throw err;
        utils.print(tx);
      });
    });
  });

  this.mempool.on('error', function(err) {
    self.emit('error', err);
  });

  this.chain.on('error', function(err) {
    self.emit('error', err);
  });

  this.pool.on('error', function(err) {
    self.emit('error', err);
  });

  this.pool.on('fork', function(a, b) {
    [a, b].forEach(function(hash) {
      self.storage.removeBlock(hash, function(err, block) {
        if (err)
          throw err;

        if (!block)
          return;

        self.mempool.removeBlock(block);
      });
    });
  });

  this.pool.on('tx', function(tx, peer) {
    assert(tx.ts === 0);
    self.mempool.addTX(tx, peer);
  });

  this.pool.startSync();
};

Node.prototype.getCoin = function getCoin(hash, index, callback) {
  var self = this;
  var coin;

  callback = utils.asyncify(callback);

  coin = this.mempool.getCoin(hash, index);
  if (coin)
    return callback(null, coin);

  if (this.mempool.isSpent(hash, index))
    return callback(null, null);

  this.storage.getCoin(hash, index, function(err, coin) {
    if (err)
      return callback(err);

    if (!coin)
      return;

    return callback(null, coin);
  });
};

Node.prototype.getCoinByAddress = function getCoinsByAddress(addresses, callback) {
  var self = this;
  var mempool;

  callback = utils.asyncify(callback);

  mempool = this.mempool.getCoinsByAddress(addresses);

  this.storage.getCoinsByAddress(addresses, function(err, coins) {
    if (err)
      return callback(err);

    return callback(null, mempool.concat(coins.filter(function(coin) {
      if (self.mempool.isSpent(coin.hash, coin.index))
        return false;
      return true;
    })));
  });
};

Node.prototype.getTX = function getTX(hash, callback) {
  var self = this;
  var tx;

  callback = utils.asyncify(callback);

  tx = this.mempool.getTX(hash);
  if (tx)
    return callback(null, tx);

  this.storage.getTX(hash, function(err, tx) {
    if (err)
      return callback(err);

    return callback(null, tx);
  });
};

Node.prototype.isSpent = function isSpent(hash, index, callback) {
  var self = this;

  callback = utils.asyncify(callback);

  if (this.mempool.isSpent(hash, index))
    return callback(null, true);

  this.storage.getCoin(hash, index, function(err, coin) {
    if (err)
      return callback(err);

    return callback(null, coin ? false : true);
  });
};

Node.prototype.getTXByAddress = function getTXByAddress(addresses, callback) {
  var self = this;
  var mempool;

  callback = utils.asyncify(callback);

  mempool = this.mempool.getTXByAddress(addresses);

  this.storage.getTXByAddress(addresses, function(err, txs) {
    if (err)
      return callback(err);

    return callback(null, mempool.concat(txs));
  });
};

Node.prototype.fillTX = function fillTX(tx, callback) {
  this.storage.fillTX(tx, callback);
};

/**
 * Expose
 */

module.exports = Node;