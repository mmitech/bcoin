/*!
 * mnemonic.js - hd mnemonics for bcoin
 * Copyright (c) 2015-2016, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var bcoin = require('../env');
var utils = require('../utils/utils');
var crypto = require('../crypto/crypto');
var assert = utils.assert;
var constants = bcoin.constants;
var BufferWriter = require('../utils/writer');
var BufferReader = require('../utils/reader');
var HD = require('./hd');
var unorm;

/**
 * HD Mnemonic
 * @exports Mnemonic
 * @constructor
 * @param {Object} options
 * @param {Number?} options.bit - Bits of entropy (Must
 * be a multiple of 8) (default=128).
 * @param {Buffer?} options.entropy - Entropy bytes. Will
 * be generated with `options.bits` bits of entropy
 * if not present.
 * @param {String?} options.phrase - Mnemonic phrase (will
 * be generated if not present).
 * @param {String?} options.passphrase - Optional salt for
 * key stretching (empty string if not present).
 * @param {String?} options.language - Language.
 */

function Mnemonic(options) {
  if (!(this instanceof Mnemonic))
    return new Mnemonic(options);

  this.bits = constants.hd.MIN_ENTROPY;
  this.language = 'english';
  this.entropy = null;
  this.phrase = null;
  this.passphrase = '';

  if (options)
    this.fromOptions(options);
}

/**
 * List of languages.
 * @const {String[]}
 * @default
 */

Mnemonic.languages = [
  'simplified chinese',
  'traditional chinese',
  'english',
  'french',
  'italian',
  'japanese'
];

/**
 * Inject properties from options object.
 * @private
 * @param {Object} options
 */

Mnemonic.prototype.fromOptions = function fromOptions(options) {
  if (typeof options === 'string')
    options = { phrase: options };

  if (options.bits != null) {
    assert(utils.isNumber(options.bits));
    assert(options.bits >= constants.hd.MIN_ENTROPY);
    assert(options.bits <= constants.hd.MAX_ENTROPY);
    assert(options.bits % 32 === 0);
    this.bits = options.bits;
  }

  if (options.language) {
    assert(typeof options.language === 'string');
    assert(Mnemonic.languages.indexOf(options.language) !== -1);
    this.language = options.language;
  }

  if (options.passphrase) {
    assert(typeof options.passphrase === 'string');
    this.passphrase = options.passphrase;
  }

  if (options.phrase) {
    this.fromPhrase(options.phrase);
    return this;
  }

  if (options.entropy) {
    this.fromEntropy(options.entropy);
    return this;
  }

  return this;
};

/**
 * Instantiate mnemonic from options.
 * @param {Object} options
 * @returns {Mnemonic}
 */

Mnemonic.fromOptions = function fromOptions(options) {
  return new Mnemonic().fromOptions(options);
};

/**
 * Destroy the mnemonic (zeroes entropy).
 */

Mnemonic.prototype.destroy = function destroy() {
  this.bits = constants.hd.MIN_ENTROPY;
  this.language = 'english';
  if (this.entropy) {
    this.entropy.fill(0);
    this.entropy = null;
  }
  this.phrase = null;
  this.passphrase = '';
};

/**
 * Generate the seed.
 * @param {String?} passphrase
 * @returns {Buffer} pbkdf2 seed.
 */

Mnemonic.prototype.toSeed = function toSeed(passphrase) {
  if (!passphrase)
    passphrase = this.passphrase;

  this.passphrase = passphrase;

  return crypto.pbkdf2(
    nfkd(this.getPhrase()),
    nfkd('mnemonic' + passphrase),
    2048, 64, 'sha512');
};

/**
 * Generate seed and create an hd private key.
 * @param {String?} passphrase
 * @param {(Network|NetworkType)?} network
 * @returns {HDPrivateKey}
 */

Mnemonic.prototype.toKey = function toKey(passphrase, network) {
  var seed = this.toSeed(passphrase);
  var key = HD.PrivateKey.fromSeed(seed, network);
  key.mnemonic = this;
  return key;
};

/**
 * Get or generate entropy.
 * @returns {Buffer}
 */

Mnemonic.prototype.getEntropy = function getEntropy() {
  if (!this.entropy)
    this.entropy = crypto.randomBytes(this.bits / 8);

  assert(this.bits / 8 === this.entropy.length);

  return this.entropy;
};

/**
 * Generate a mnemonic phrase from chosen language.
 * @returns {String}
 */

Mnemonic.prototype.getPhrase = function getPhrase() {
  var i, j, phrase, wordlist, bits, ent, entropy;
  var index, pos, oct, bit;

  if (this.phrase)
    return this.phrase;

  phrase = [];
  wordlist = Mnemonic.getWordlist(this.language);

  ent = this.getEntropy();
  bits = this.bits;

  // Include the first `ENT / 32` bits
  // of the hash (the checksum).
  bits += bits / 32;

  // Append the hash to the entropy to
  // make things easy when grabbing
  // the checksum bits.
  entropy = new Buffer(Math.ceil(bits / 8));
  ent.copy(entropy, 0);
  crypto.sha256(ent).copy(entropy, ent.length);

  // Build the mnemonic by reading
  // 11 bit indexes from the entropy.
  for (i = 0; i < bits / 11; i++) {
    index = 0;
    for (j = 0; j < 11; j++) {
      pos = i * 11 + j;
      bit = pos % 8;
      oct = (pos - bit) / 8;
      index <<= 1;
      index |= (entropy[oct] >>> (7 - bit)) & 1;
    }
    phrase.push(wordlist[index]);
  }

  // Japanese likes double-width spaces.
  if (this.language === 'japanese')
    phrase = phrase.join('\u3000');
  else
    phrase = phrase.join(' ');

  this.phrase = phrase;

  return phrase;
};

/**
 * Inject properties from phrase.
 * @private
 * @param {String} phrase
 */

Mnemonic.prototype.fromPhrase = function fromPhrase(phrase) {
  var i, j, bits, pos, oct, bit, b, ent, entropy, lang;
  var chk, word, wordlist, index, cbits, cbytes, words;

  assert(typeof phrase === 'string');

  words = phrase.split(/[ \u3000]+/);
  bits = words.length * 11;
  cbits = bits % 32;
  cbytes = Math.ceil(cbits / 8);
  bits -= cbits;

  assert(bits >= constants.hd.MIN_ENTROPY);
  assert(bits <= constants.hd.MAX_ENTROPY);
  assert(bits % 32 === 0);
  assert(cbits !== 0, 'Invalid checksum.');

  ent = new Buffer(Math.ceil((bits + cbits) / 8));
  ent.fill(0);

  lang = Mnemonic.getLanguage(words[0]);
  wordlist = Mnemonic.getWordlist(lang);

  for (i = 0; i < words.length; i++) {
    word = words[i];
    index = utils.binarySearch(wordlist, word, utils.strcmp);

    if (index === -1)
      throw new Error('Could not find word.');

    for (j = 0; j < 11; j++) {
      pos = i * 11 + j;
      bit = pos % 8;
      oct = (pos - bit) / 8;
      b = (index >>> (10 - j)) & 1;
      ent[oct] |= b << (7 - bit);
    }
  }

  entropy = ent.slice(0, ent.length - cbytes);
  ent = ent.slice(ent.length - cbytes);
  chk = crypto.sha256(entropy);

  for (i = 0; i < cbits; i++) {
    bit = i % 8;
    oct = (i - bit) / 8;
    b = (ent[oct] >>> (7 - bit)) & 1;
    j = (chk[oct] >>> (7 - bit)) & 1;
    if (b !== j)
      throw new Error('Invalid checksum.');
  }

  assert(bits / 8 === entropy.length);

  this.bits = bits;
  this.language = lang;
  this.entropy = entropy;
  this.phrase = phrase;

  return this;
};

/**
 * Instantiate mnemonic from a phrase (validates checksum).
 * @param {String} phrase
 * @returns {Mnemonic}
 * @throws on bad checksum
 */

Mnemonic.fromPhrase = function fromPhrase(phrase) {
  return new Mnemonic().fromPhrase(phrase);
};

/**
 * Inject properties from entropy.
 * @private
 * @param {Buffer} entropy
 * @param {String?} lang
 */

Mnemonic.prototype.fromEntropy = function fromEntropy(entropy, lang) {
  assert(Buffer.isBuffer(entropy));
  assert(entropy.length * 8 >= constants.hd.MIN_ENTROPY);
  assert(entropy.length * 8 <= constants.hd.MAX_ENTROPY);
  assert((entropy.length * 8) % 32 === 0);
  assert(!lang || Mnemonic.languages.indexOf(lang) !== -1);

  this.entropy = entropy;
  this.bits = entropy.length * 8;

  if (lang)
    this.language = lang;

  return this;
};

/**
 * Instantiate mnemonic from entropy.
 * @param {Buffer} entropy
 * @param {String?} lang
 * @returns {Mnemonic}
 */

Mnemonic.fromEntropy = function fromEntropy(entropy, lang) {
  return new Mnemonic().fromEntropy(entropy, lang);
};

/**
 * Determine a single word's language.
 * @param {String} word
 * @returns {String} Language.
 * @throws on not found.
 */

Mnemonic.getLanguage = function getLanguage(word) {
  var i, lang, wordlist;

  for (i = 0; i < Mnemonic.languages.length; i++) {
    lang = Mnemonic.languages[i];
    wordlist = Mnemonic.getWordlist(lang);
    if (utils.binarySearch(wordlist, word, utils.strcmp) !== -1)
      return lang;
  }

  throw new Error('Could not determine language.');
};

/**
 * Retrieve the wordlist for a language.
 * @param {String} language
 * @returns {String[]}
 */

Mnemonic.getWordlist = function getWordlist(language) {
  switch (language) {
    case 'simplified chinese':
      return require('./words/chinese-simplified.js');
    case 'traditional chinese':
      return require('./words/chinese-traditional.js');
    case 'english':
      return require('./words/english.js');
    case 'french':
      return require('./words/french.js');
    case 'italian':
      return require('./words/italian.js');
    case 'japanese':
      return require('./words/japanese.js');
    default:
      throw new Error('Unknown language: ' + language);
  }
};

/**
 * Convert mnemonic to a json-friendly object.
 * @returns {Object}
 */

Mnemonic.prototype.toJSON = function toJSON() {
  return {
    bits: this.bits,
    language: this.language,
    entropy: this.getEntropy().toString('hex'),
    phrase: this.getPhrase(),
    passphrase: this.passphrase
  };
};

/**
 * Inject properties from json object.
 * @private
 * @param {Object} json
 */

Mnemonic.prototype.fromJSON = function fromJSON(json) {
  assert(utils.isNumber(json.bits));
  assert(typeof json.language === 'string');
  assert(typeof json.entropy === 'string');
  assert(typeof json.phrase === 'string');
  assert(typeof json.passphrase === 'string');
  assert(json.bits >= constants.hd.MIN_ENTROPY);
  assert(json.bits <= constants.hd.MAX_ENTROPY);
  assert(json.bits % 32 === 0);
  assert(json.bits / 8 === json.entropy.length / 2);

  this.bits = json.bits;
  this.language = json.language;
  this.entropy = new Buffer(json.entropy, 'hex');
  this.phrase = json.phrase;
  this.passphrase = json.passphrase;

  return this;
};

/**
 * Instantiate mnemonic from json object.
 * @param {Object} json
 * @returns {Mnemonic}
 */

Mnemonic.fromJSON = function fromJSON(json) {
  return new Mnemonic().fromJSON(json);
};

/**
 * Serialize mnemonic.
 * @returns {Buffer}
 */

Mnemonic.prototype.toRaw = function toRaw(writer) {
  var p = new BufferWriter(writer);
  var lang = Mnemonic.languages.indexOf(this.language);

  assert(lang !== -1);

  p.writeU16(this.bits);
  p.writeU8(lang);
  p.writeBytes(this.getEntropy());
  p.writeVarString(this.getPhrase(), 'utf8');
  p.writeVarString(this.passphrase, 'utf8');

  if (!writer)
    p = p.render();

  return p;
};

/**
 * Inject properties from serialized data.
 * @private
 * @param {Buffer} data
 */

Mnemonic.prototype.fromRaw = function fromRaw(data) {
  var p = new BufferReader(data);

  this.bits = p.readU16();
  this.language = Mnemonic.languages[p.readU8()];
  this.entropy = p.readBytes(this.bits / 8);
  this.phrase = p.readVarString('utf8');
  this.passphrase = p.readVarString('utf8');

  assert(this.language);
  assert(this.bits >= constants.hd.MIN_ENTROPY);
  assert(this.bits <= constants.hd.MAX_ENTROPY);
  assert(this.bits % 32 === 0);

  return this;
};

/**
 * Instantiate mnemonic from serialized data.
 * @param {Buffer} data
 * @returns {Mnemonic}
 */

Mnemonic.fromRaw = function fromRaw(data) {
  return new Mnemonic().fromRaw(data);
};

/**
 * Convert the mnemonic to a string.
 * @returns {String}
 */

Mnemonic.prototype.toString = function toString() {
  return this.getPhrase();
};

/**
 * Inspect the mnemonic.
 * @returns {String}
 */

Mnemonic.prototype.inspect = function inspect() {
  return '<Mnemonic: ' + this.getPhrase() + '>';
};

/**
 * Test whether an object is a Mnemonic.
 * @param {Object} obj
 * @returns {Boolean}
 */

Mnemonic.isMnemonic = function isMnemonic(obj) {
  return obj
    && typeof obj.bits === 'number'
    && typeof obj.toSeed === 'function';
};

/*
 * Helpers
 */

function nfkd(str) {
  if (str.normalize)
    return str.normalize('NFKD');

  if (!unorm)
    unorm = require('../../vendor/unorm');

  return unorm.nfkd(str);
}

/*
 * Expose
 */

module.exports = Mnemonic;
