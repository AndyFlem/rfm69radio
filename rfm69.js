/* eslint-disable max-len */
'use strict';
const spi = require('spi-device');
const Gpio = require('onoff').Gpio;
const config = require('./config');
const reg = require('./registers');
let useVerbose = false;

function RFM69() {
  debug('New RMF69');
};

RFM69.prototype.initialize = function({
  freqBand = 'RF69_915MHZ',
  address = 1,
  networkID = 100,
  isHighPowerRadio = true,
  powerLevelPercent = 70,
  interruptPin = 24, // Pin number of interrupt pin. This is a pin index not a GPIO number.
  resetPin = 5, // Pin number of reset pin. This is a pin index not a GPIO number.
  spiBus = 0, // SPI bus number.
  spiDevice = 0, // SPI device number.
  promiscuousMode = false,
  encryptionKey = 0,
  autoAcknowledge = true,
  verbose = true,
  initializedCallback,
  dataReceivedCallback,
}) {
  this.freqBand = freqBand;
  this.address = address;
  this.networkID = networkID;
  this.isRFM69HW = isHighPowerRadio;
  this.powerLevelPercent = powerLevelPercent;
  this.interruptPin = interruptPin;
  this.resetPin = resetPin;
  this.spiBus = spiBus;
  this.spiDevice = spiDevice;
  this.promiscuousMode = promiscuousMode;
  this.encryptionKey = encryptionKey;
  this.autoAcknowledge = autoAcknowledge;
  useVerbose = verbose;

  this.mode = '';
  this.modeName = '';
  this.powerLevel = 0;

  this._peers = new Map();
  this._packets = [];

  this._dataReceivedCallback = dataReceivedCallback;

  const scope = this;
  debug('********** Starting initialization.');

  this._initSpi(this.spiBus, this.spiDevice);

  this._gpio_reset = new Gpio(this.resetPin, 'out');
  this._gpio_interrupt = new Gpio(this.interruptPin, 'in', 'rising');

  scope._resetRadio(function() {
    scope._checkSync(function() {
      scope._setConfig(scope.freqBand, scope.networkID);
      scope._setEncryption(scope.encryptionKey);
      scope._setHighPower(scope.isRFM69HW);
      scope._gpio_interrupt.watch(function() {
        scope._interruptHandler();
      });
      scope.setPowerLevel(powerLevelPercent);
      scope._waitReady(function() {
        scope._setMode(reg.RF69_MODE_RX);
        debug('Initialization complete.');
        initializedCallback();
      });
    });
  });
};

RFM69.prototype.shutdown = function() {
  debug('********** Shutting down.');
  this._gpio_reset.unexport();
  this._gpio_interrupt.unexport();
  this._radio.closeSync();
};

RFM69.prototype.setPowerLevel = function(powerLevelPercent, callback) {
  this.powerLevelPercent = powerLevelPercent;
  this.powerLevel = Math.round(31.0 * (powerLevelPercent / 100.0));
  debug(`Setting power level to: ${powerLevelPercent}% (${this.powerLevel})`);
  this._writeRegSync(reg.REG_PALEVEL, (this._readRegSync(reg.REG_PALEVEL) & 0xE0) | this.powerLevel);
};

RFM69.prototype.readTemperature = function(callback, calFactor = 0) {
  debug('********** Reading temperature.');
  this._setMode(reg.RF69_MODE_STANDBY);
  this._writeRegSync(reg.REG_TEMP1, reg.RF_TEMP1_MEAS_START);

  const scope = this;

  wait = setInterval(function() {
    if (!(scope._readRegSync(reg.REG_TEMP1) & reg.RF_TEMP1_MEAS_RUNNING)) {
      clearInterval(wait);
      temp = (Math.round(~scope._readRegSync(reg.REG_TEMP2)) * -1) + reg.COURSE_TEMP_COEF + calFactor;
      debug(`Got temperature: ${temp}`);
      scope._setMode(reg.RF69_MODE_RX);
      callback(temp);
    }
  }, 50);
};

RFM69.prototype.send = function({
  toAddress = 0,
  payload = '',
  attempts = 3,
  attemptWait = 200,
  requireAck = true,
  ackCallback,
}) {
  debug(`********** Sending '${payload}' to address: ${toAddress}`);
  const scope = this;
  if (attempts > 1) {
    requireAck = true;
  }

  let payloadStr = '';
  if (typeof payload == 'string') {
    payloadStr = payload;
    payload = Array.from(payloadStr).map(function(elm) {
      return elm.charCodeAt();
    });
  } else {
    payloadStr = payload.reduce((sum, current) => sum + String.fromCharCode(current), '');
  }

  if (payload.length > reg.RF69_MAX_DATA_LEN) {
    payload = payload.slice(0, reg.RF69_MAX_DATA_LEN);
  }

  if (!this._peers.has(toAddress)) {
    debug(`Adding a new peer with address: ${toAddress}`);
    this._peers.set(senderAddress, {
      lastReceivedPacket: {},
      lastSentPacket: {},
    });
  }
  const peer = this._peers.get(toAddress);

  const packet = {
    targetAddress: toAddress,
    senderAddress: this.address,
    peer: peer,
    rssi: undefined,
    payload: payload,
    payloadString: payloadStr,
    requiresAck: requireAck,
    hasAck: false,
  };
  peer.lastSentPacket = packet;

  let attempt = 0;

  setTimeout(function tick() {
    attempt += 1;
    debug(`Send attempt: ${attempt} of ${attempts}`);
    scope._sendFrame(toAddress, payload, requireAck, function() {
      setTimeout(function() {
        if (attempt < attempts && packet.hasAck == false) {
          debug(`No Ack Received, retry.`);
          timerId = setTimeout(tick, attemptWait);
        } else if (packet.hasAck == true) {
          debug(`Ack Received.`);
          ackCallback(null, true);
        } else if (attempt == attempts) {
          debug(`No Ack Received. Giving up.`);
          ackCallback(new Error('No Ack Received.'), false);
        }
      }, 1000);
    });
  }, 0);
};


RFM69.prototype._sendFrame = function(toAddress, payload, requestAck, callback) {
  debug(`Sending packet to: ${toAddress}`);
  const scope = this;

  this._setMode(reg.RF69_MODE_STANDBY);
  this._waitReady(function() {
    scope._writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_00); // DIO0 is "Packet Sent"

    let ack = 0x00;
    // if (sendAck){ ack = 0x80 }
    if (requestAck) {
      ack = 0x40;
    }

    const bSend = [reg.REG_FIFO | 0x80, payload.length + 3, toAddress, scope.address, ack].concat(payload);
    const message = [{
      byteLength: bSend.length,
      sendBuffer: Buffer.from(bSend),
      receiveBuffer: Buffer.alloc(bSend.length),
      speedHz: 4000000,
    }];

    scope._radio.transferSync(message);

    scope._setMode(reg.RF69_MODE_TX);
    debug(`Sent: ${payload}`);

    callback();
  });
};


RFM69.prototype._initSpi = function(spiBus, spiDevice) {
  try {
    this._radio = spi.openSync(spiBus, spiDevice);
    debug(`SPI opened.`);
  } catch (err) {
    console.error(`Error opening SPI: ${err}`);
    throw err;
  }
};

RFM69.prototype._resetRadio = function(callback) {
  debug(`Resetting radio.`);

  const scope = this;
  scope._gpio_reset.write(1, function resetHighCallback(err) {
    setTimeout(function resetTimeoutCallback() {
      scope._gpio_reset.write(0, function resetLowCallback(err) {
        setTimeout(callback, 50);
      });
    }, 50);
  });
};

RFM69.prototype._checkSync = function(callback) {
  const scope = this;
  scope._checkSyncAA(function() {
    scope._checkSync55(function() {
      callback();
    });
  });
};

RFM69.prototype._checkSyncAA = function(callback) {
  debug(`Checking sync AA.`);
  this._intervalSync = setInterval(() => {
    this._writeRegSync(0x2F, 0xAA);
    this._timeoutSync = setTimeout(() => {
      clearInterval(this._intervalSync);
      throw new Error(`Failed to sync AA!`);
    }, 1600);
    setTimeout(() => {
      if (this._readRegSync(0x2F) == 0xAA) {
        debug(`Synced AA!`);
        clearInterval(this._intervalSync);
        clearTimeout(this._timeoutSync);
        callback();
      }
    }, 20);
  }, 100);
};

RFM69.prototype._checkSync55 = function(callback) {
  debug(`Checking sync 55.`);
  this._intervalSync = setInterval(() => {
    this._writeRegSync(0x2F, 0x55);
    this._timeoutSync = setTimeout(() => {
      clearInterval(this._intervalSync);
      throw new Error(`Failed to sync 55!`);
    }, 1600);
    setTimeout(() => {
      if (this._readRegSync(0x2F) == 0x55) {
        debug(`Synced 55!`);
        clearInterval(this._intervalSync);
        clearTimeout(this._timeoutSync);
        callback();
      }
    }, 20);
  }, 100);
};

RFM69.prototype._setConfig = function(freqBand, networkID) {
  debug(`Setting config settings. Freq: ${freqBand}. networkId: ${networkID}.`);
  for (const entry of config.getConfig(freqBand, networkID)) {
    this._writeRegSync(entry[0], entry[1]);
  }
};

RFM69.prototype._readRSSI = function() {
  return this._readRegSync(reg.REG_RSSIVALUE) * -1;
};

RFM69.prototype._setEncryption = function(key) {
  const curMode = this.mode;
  this._setMode(reg.RF69_MODE_STANDBY);

  if (key != 0 && key.length == 16) {
    debug(`Setting encryption key: ${key}`);
    const payload = Array.from(key).map(function(elm) {
      return elm.charCodeAt();
    });
    const bSend = [reg.REG_AESKEY1 | 0x80].concat(payload);
    const message = [{
      byteLength: bSend.length,
      sendBuffer: Buffer.from(bSend),
      receiveBuffer: Buffer.alloc(bSend.length),
      speedHz: 4000000,
    }];
    this._radio.transferSync(message);
    this._writeRegSync(reg.REG_PACKETCONFIG2, (this._readRegSync(reg.REG_PACKETCONFIG2) & 0xFE) | reg.RF_PACKET2_AES_ON);
  } else {
    debug(`Not setting encryption key: ${key}`);
    this._writeRegSync(reg.REG_PACKETCONFIG2, (this._readRegSync(reg.REG_PACKETCONFIG2) & 0xFE) | reg.RF_PACKET2_AES_OFF);
  }
  this._setMode(curMode);
};

RFM69.prototype._setMode = function(newMode) {
  // debug("Setting mode to: ", newMode);
  if (newMode == this.mode) { } else if (newMode == reg.RF69_MODE_TX) {
    this.modeName = 'TX';
    this._writeRegSync(reg.REG_OPMODE, (this._readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_TRANSMITTER);
    if (this.isRFM69HW) this._setHighPowerRegs(true);
  } else if (newMode == reg.RF69_MODE_RX) {
    this.modeName = 'RX';
    this._writeRegSync(reg.REG_OPMODE, (this._readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_RECEIVER);
    if (this.isRFM69HW) this._setHighPowerRegs(false);

    if (this._readRegSync(reg.REG_IRQFLAGS2) & reg.RF_IRQFLAGS2_PAYLOADREADY) {
      this._writeRegSync(reg.REG_PACKETCONFIG2, this._readRegSync(reg.REG_PACKETCONFIG2) & 0xFB) | reg.RF_PACKET2_RXRESTART; // avoid RX deadlocks
    }
    this._writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_01); // set DIO0 to "PAYLOADREADY" in receive mode
  } else if (newMode == reg.RF69_MODE_SYNTH) {
    this.modeName = 'Synth';
    this._writeRegSync(reg.REG_OPMODE, (this._readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_SYNTHESIZER);
  } else if (newMode == reg.RF69_MODE_STANDBY) {
    this.modeName = 'Standby';
    this._writeRegSync(reg.REG_OPMODE, (this._readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_STANDBY);
  } else if (newMode == reg.RF69_MODE_SLEEP) {
    this.modeName = 'Sleep';
    this._writeRegSync(reg.REG_OPMODE, (this._readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_SLEEP);
  }

  // # we are using packet mode, so this check is not really needed
  // # but waiting for mode ready is necessary when going from sleep because the FIFO may not be immediately available from previous mode
  // while self.mode == RF69_MODE_SLEEP and self._readReg(REG_IRQFLAGS1) & RF_IRQFLAGS1_MODEREADY == 0x00:
  //    pass

  this.mode = newMode;
  debug(`Mode set to: ${this.modeName} (${this.mode})`);
};

RFM69.prototype._setHighPower = function(isHighpower) {
  debug(`Setting highpower to: ${isHighpower}`);
  if (isHighpower) {
    this._writeRegSync(reg.REG_OCP, reg.RF_OCP_OFF);
    this._writeRegSync(reg.REG_PALEVEL, (this._readRegSync(reg.REG_PALEVEL) & 0x1F) | reg.RF_PALEVEL_PA1_ON | reg.RF_PALEVEL_PA2_ON);
  } else {
    this._writeRegSync(reg.REG_OCP, reg.RF_OCP_ON);
    this._writeRegSync(reg.REG_PALEVEL, reg.RF_PALEVEL_PA0_ON | reg.RF_PALEVEL_PA1_OFF | reg.RF_PALEVEL_PA2_OFF | this.powerLevel);
  }
};

RFM69.prototype._setHighPowerRegs = function(isHighpower) {
  debug(`Setting highpower regs with highpower: ${isHighpower}`);
  if (isHighpower) {
    this._writeRegSync(reg.REG_TESTPA1, 0x5D);
    this._writeRegSync(reg.REG_TESTPA2, 0x7C);
  } else {
    this._writeRegSync(reg.REG_TESTPA1, 0x55);
    this._writeRegSync(reg.REG_TESTPA2, 0x70);
  }
};

RFM69.prototype._sendAckFrame = function(toAddress, callback) {
  debug(`Sending ACK to: ${toAddress}`);
  const scope = this;
  this._setMode(reg.RF69_MODE_STANDBY);
  this._waitReady(function() {
    scope._writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_00); // DIO0 is "Packet Sent"
    const bSend = [reg.REG_FIFO | 0x80, 3, toAddress, scope.address, 0x80];
    const message = [{
      byteLength: bSend.length,
      sendBuffer: Buffer.from(bSend),
      receiveBuffer: Buffer.alloc(bSend.length),
      speedHz: 4000000,
    }];

    scope._radio.transferSync(message);
    scope._setMode(reg.RF69_MODE_TX);
    scope._peers.get(toAddress).lastReceivedPacket.hasAck = true;
    callback();
  });
};

RFM69.prototype._waitReady = function(callback) {
  debug(`Waiting for ready..`);
  const scope = this;
  const inter = setInterval(function() {
    debug(`..ready.`);
    if ((scope._readRegSync(reg.REG_IRQFLAGS1) & reg.RF_IRQFLAGS1_MODEREADY) != 0x00) {
      clearInterval(inter);
      callback();
    }
  }, 20);
};

RFM69.prototype._interruptHandler = function() {
  const scope = this;

  const irqFlags = this._readRegSync(reg.REG_IRQFLAGS2);

  this._setMode(reg.RF69_MODE_STANDBY);

  debug(`Interrupt with flags: ${irqFlags.toString(2)}`);

  if (irqFlags & reg.RF_IRQFLAGS2_PACKETSENT) {
    debug(`Interrupt: packet sent. Setting mode back to RX.`);
    this._setMode(reg.RF69_MODE_RX);
  } else if (irqFlags & reg.RF_IRQFLAGS2_PAYLOADREADY) {
    debug(`Interrupt: packet received.`);
    this._packetReceivedHandler(function() {
      scope._setMode(reg.RF69_MODE_RX);
    });
  }
};

RFM69.prototype._packetReceivedHandler = function(callback) {
  const message = [{
    byteLength: 5,
    sendBuffer: Buffer.from([(reg.REG_FIFO & 0x7F), 0, 0, 0, 0]),
    receiveBuffer: Buffer.alloc(5),
    speedHz: 4000000,
  }];
  this._radio.transferSync(message);

  let payloadLength;
  let targetAddress;
  let senderAddress;
  let CTLbyte;
  [payloadLength, targetAddress, senderAddress, CTLbyte] = message[0].receiveBuffer.slice(1);
  debug(`Packet - payload length: ${payloadLength}, target address: ${targetAddress}, sender address: ${senderAddress}, CTLByte: ${CTLbyte}`);

  if (!this.promiscuousMode && targetAddress != this.address && targetAddress != reg.RF69_BROADCAST_ADDR) {
    debug(`Drop packet not addressed here.`);
    callback();
  } else {
    const ackRequested = CTLbyte & 0x40;

    if (!this._peers.has(senderAddress)) {
      debug(`Adding a new peer: ${senderAddress}`);
      this._peers.set(senderAddress, {
        lastReceivedPacket: {},
        lastSentPacket: {},
      });
    }
    const peer = this._peers.get(senderAddress);

    if (CTLbyte & 0x80) { // ACK Packet
      debug(`Incoming ACK`);
      peer.lastSentPacket.hasAck = true;
      callback();
    } else { // Data packet
      debug(`Incoming data.`);

      if (payloadLength > 66) {
        payloadLength = 66;
      }

      const message2 = [{
        byteLength: payloadLength + 1,
        sendBuffer: Buffer.from([(reg.REG_FIFO & 0x7F)].concat(new Array(payloadLength).fill(0))),
        receiveBuffer: Buffer.alloc(payloadLength + 1),
        speedHz: 4000000,
      }];
      this._radio.transferSync(message2);
      const rssi = this._readRSSI();
      debug(`RSSI: ${rssi}`);

      const payload = message2[0].receiveBuffer.slice(1);
      const payloadStr = payload.slice(0, -3).reduce((sum, current) => sum + String.fromCharCode(current), '');
      debug(`Data packet: ${payloadStr}`);

      const packet = {
        targetAddress: targetAddress,
        senderAddress: senderAddress,
        peer: peer,
        rssi: rssi,
        payload: payload,
        payloadString: payloadStr,
        requiresAck: ackRequested,
        hasAck: false,
      };
      peer.lastReceivedPacket = packet;
      this._packets.push(packet);

      if (ackRequested && this.autoAcknowledge) {
        debug(`Sending Ack.`);
        this._sendAckFrame(senderAddress, function() {
          callback();
        });
      } else {
        callback();
      }
    }
  }
};

RFM69.prototype._readRegSync = function(addr) {
  const message = [{
    byteLength: 2,
    sendBuffer: Buffer.from([(addr & 0x7F), 0]),
    receiveBuffer: Buffer.alloc(2),
    speedHz: 4000000,
  }];

  this._radio.transferSync(message);
  // debug(`Register read: 0x${addr.toString(16)} => 0x${message[0].receiveBuffer[1].toString(16)}`);
  return message[0].receiveBuffer[1];
};

RFM69.prototype._writeRegSync = function(addr, value) {
  const message = [{
    byteLength: 2,
    sendBuffer: Buffer.from([(addr | 0x80), value]),
    receiveBuffer: Buffer.alloc(2),
    speedHz: 4000000,
  }];

  this._radio.transferSync(message);
  // debug(`Register write: 0x${addr.toString(16)} => 0x${value.toString(16)}`);
  return message[0].receiveBuffer[1];
};

module.exports = RFM69;

function debug(message) {
  if (useVerbose) {
    console.log(`${formatDatetime(new Date())}: ${message}`);
  }
}

function formatDatetime(m) {
  return ('0' + m.getUTCHours()).slice(-2) + ':' +
    ('0' + m.getUTCMinutes()).slice(-2) + ':' +
    ('0' + m.getUTCSeconds()).slice(-2) + '.' +
    m.getUTCMilliseconds();
}
