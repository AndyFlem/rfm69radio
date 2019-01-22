/* eslint-disable max-len */
'use strict';

const rfm69 = function() {

  const spi = require('spi-device');
  const Gpio = require('onoff').Gpio;
  const config = require('./config');
  const reg = require('./registers');

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const onoff_write = (pin, val) => new Promise((resolve, reject) => {
    pin.write(val, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  const state = {
    options: {}, // = { address, networkID, isRFM69HW, powerLevelPercent, promiscuousMode, autoAcknowledge, verbose };
    gpio_interrupt: undefined, // Initialized to a GPIO pin
    gpio_reset: undefined, // Initialized to a GPIO pin
    radio: undefined, // Initialized to a SPI device
    mode: reg.RF69_MODE_STANDBY, // Radio mode number
    modeName: 'Standby', // Radio mode name
    powerLevel: 0, // Calculated power level
    peers: new Map(), // Peers we have seen, key=address
    packetReceivedCallbacks: [], // List to callback on packet
  };

  function initSpi(spiBus, spiDevice) {
    return new Promise((resolve, reject) => {
      state.radio = spi.open(spiBus, spiDevice, (err) => {
        if (err) {
          debugPrint(err);
          reject(err);
        } else {
          debugPrint('SPI opened.');
          resolve(true);
        }
      });
    });
  }

  function resetRadio(pinReset) {
    debugPrint('Resetting radio.');
    return onoff_write(pinReset, 1)
      .then(() => wait(50))
      .then(() => onoff_write(pinReset, 0))
      .then(() => wait(50));
  }

  function checkSyncItem(check) {
    debugPrint(`Checking sync 0x${check.toString(16)}.`);

    return new Promise((resolve, reject) => {
      const intervalSync = setInterval(() => {
        writeRegSync(0x2F, check);
        const timeoutSync = setTimeout(() => {
          clearInterval(intervalSync);
          reject(new Error(`Failed to sync 0x${check}!`));
        }, 1600);
        setTimeout(() => {
          if (readRegSync(0x2F) === check) {
            debugPrint(`Synced 0x${check.toString(16)}!`);
            clearInterval(intervalSync);
            clearTimeout(timeoutSync);
            resolve(true);
          }
        }, 20);
      }, 100);
    });
  }

  function setConfig(freqBand, networkID) {
    debugPrint(`Setting config settings. Freq: ${freqBand}. networkId: ${networkID}.`);
    for (const entry of config.getConfig(freqBand, networkID)) {
      writeRegSync(entry[0], entry[1]);
    }
  }

  function readRSSI() {
    return readRegSync(reg.REG_RSSIVALUE) * -1;
  }

  function setEncryption(key) {
    debugPrint('Checking to set encryption key.');

    if (key !== 0 && key.length === 16) {
      const curMode = state.mode;

      setMode(reg.RF69_MODE_STANDBY);

      debugPrint(`Setting encryption key: ${key}`);
      const payload = Array.from(key).map(elm => elm.charCodeAt());
      const bSend = [reg.REG_AESKEY1 | 0x80].concat(payload);
      const message = [{
        byteLength: bSend.length,
        sendBuffer: Buffer.from(bSend),
        receiveBuffer: Buffer.alloc(bSend.length),
        speedHz: reg.TRANSFER_SPEED,
      }];
      state.radio.transferSync(message);
      writeRegSync(reg.REG_PACKETCONFIG2, (readRegSync(reg.REG_PACKETCONFIG2) & 0xFE) | reg.RF_PACKET2_AES_ON);
      setMode(curMode);
    } else {
      debugPrint(`Not setting encryption key: ${key}`);
      writeRegSync(reg.REG_PACKETCONFIG2, (readRegSync(reg.REG_PACKETCONFIG2) & 0xFE) | reg.RF_PACKET2_AES_OFF);
    }
  }

  function setMode(newMode) {
    debugPrint(`New mode ${newMode} requested`);

    if (newMode === state.mode) {
      debugPrint(`Staying in mode ${state.modeName} (${state.mode})`);
    } else {
      debugPrint(`Switching to mode ${newMode}`);
      if (newMode === reg.RF69_MODE_TX) {
        state.modeName = 'TX';
        writeRegSync(reg.REG_OPMODE, (readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_TRANSMITTER);
        if (state.options.isRFM69HW) setHighPowerRegs(true);
      } else if (newMode === reg.RF69_MODE_RX) {
        state.modeName = 'RX';
        writeRegSync(reg.REG_OPMODE, (readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_RECEIVER);
        if (state.options.isRFM69HW) setHighPowerRegs(false);
        // if (readRegSync(reg.REG_IRQFLAGS2) & reg.RF_IRQFLAGS2_PAYLOADREADY) {
        //  writeRegSync(reg.REG_PACKETCONFIG2, readRegSync(reg.REG_PACKETCONFIG2) & 0xFB) | reg.RF_PACKET2_RXRESTART; // avoid RX deadlocks
        // }
        writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_01); // set DIO0 to "PAYLOADREADY" in receive mode
      } else if (newMode === reg.RF69_MODE_SYNTH) {
        state.modeName = 'Synth';
        writeRegSync(reg.REG_OPMODE, (readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_SYNTHESIZER);
      } else if (newMode === reg.RF69_MODE_STANDBY) {
        state.modeName = 'Standby';
        writeRegSync(reg.REG_OPMODE, (readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_STANDBY);
      } else if (newMode === reg.RF69_MODE_SLEEP) {
        state.modeName = 'Sleep';
        writeRegSync(reg.REG_OPMODE, (readRegSync(reg.REG_OPMODE) & 0xE3) | reg.RF_OPMODE_SLEEP);
      }
      state.mode = newMode;
      debugPrint(`Mode set to ${state.modeName} (${state.mode})`);
    }
  }

  function setHighPower(isHighpower) {
    debugPrint(`Setting highpower to: ${isHighpower}`);
    if (isHighpower) {
      writeRegSync(reg.REG_OCP, reg.RF_OCP_OFF);
      writeRegSync(reg.REG_PALEVEL, (readRegSync(reg.REG_PALEVEL) & 0x1F) | reg.RF_PALEVEL_PA1_ON | reg.RF_PALEVEL_PA2_ON);
    } else {
      writeRegSync(reg.REG_OCP, reg.RF_OCP_ON);
      writeRegSync(reg.REG_PALEVEL, reg.RF_PALEVEL_PA0_ON | reg.RF_PALEVEL_PA1_OFF | reg.RF_PALEVEL_PA2_OFF | state.powerLevel);
    }
  }

  function setHighPowerRegs(isHighpower) {
    debugPrint(`Setting highpower regs with highpower: ${isHighpower}`);
    if (isHighpower) {
      writeRegSync(reg.REG_TESTPA1, 0x5D);
      writeRegSync(reg.REG_TESTPA2, 0x7C);
    } else {
      writeRegSync(reg.REG_TESTPA1, 0x55);
      writeRegSync(reg.REG_TESTPA2, 0x70);
    }
  }

  function waitReady() {
    debugPrint('Waiting for ready..');
    return new Promise((resolve) => {
      const inter = setInterval(() => {
        if ((readRegSync(reg.REG_IRQFLAGS1) & reg.RF_IRQFLAGS1_MODEREADY) !== 0x00) {
          clearInterval(inter);
          debugPrint('..ready.');
          resolve(true);
        }
      }, 10);
    });
  }

  function interruptHandler() {

    const irqFlags = readRegSync(reg.REG_IRQFLAGS2);
    debugPrint(`Interrupt with flags: ${irqFlags.toString(2)}`);

    if (irqFlags & reg.RF_IRQFLAGS2_PACKETSENT) {
      debugPrint('Interrupt: packet sent. Setting mode back to RX.');
      setMode(reg.RF69_MODE_RX);
    } else if (irqFlags & reg.RF_IRQFLAGS2_PAYLOADREADY) {
      debugPrint('Interrupt: packet received.');

      setMode(reg.RF69_MODE_STANDBY);
      const packet = dataReceivedHandler();
      setMode(reg.RF69_MODE_RX);
      if (packet) {
        for (let cb of state.packetReceivedCallbacks) { cb(packet); }
      }
    }
  }

  function dataReceivedHandler() {
    const message = [{
      byteLength: 5,
      sendBuffer: Buffer.from([(reg.REG_FIFO & 0x7F), 0, 0, 0, 0]),
      receiveBuffer: Buffer.alloc(5),
      speedHz: reg.TRANSFER_SPEED,
    }];
    state.radio.transferSync(message);

    let payloadLength = 0;
    let targetAddress = 0;
    let senderAddress = 0;
    let CTLbyte = 0x00;
    [payloadLength, targetAddress, senderAddress, CTLbyte] = message[0].receiveBuffer.slice(1);
    debugPrint(`Packet - payload length: ${payloadLength}, target address: ${targetAddress}, sender address: ${senderAddress}, CTLByte: ${CTLbyte}`);

    if (!state.options.promiscuousMode && targetAddress !== state.options.address && targetAddress !== reg.RF69_BROADCAST_ADDR) {
      debugPrint(`Packet not addressed here. Promiscuous mode: ${state.options.promiscuousMode}. Target address: ${targetAddress}. This address: ${state.options.address}. Broadcast address: ${reg.RF69_BROADCAST_ADDR}`);
      return;
      // throw new Error(`Packet not addressed here. Promiscuous mode: ${state.options.promiscuousMode}. Target address: ${targetAddress}. This address: ${state.options.address}. Broadcast address: ${reg.RF69_BROADCAST_ADDR}`);
    } else {
      // Addressed here
      // Get or create peer
      if (!state.peers.has(senderAddress)) {
        debugPrint(`Adding a new peer: ${senderAddress}`);
        state.peers.set(senderAddress, {
          lastReceivedPacket: {},
          lastSentPacket: {},
        });
      }
      const peer = state.peers.get(senderAddress);

      // Ack packet or data packet??
      if (CTLbyte & 0x80) { // ACK Packet
        debugPrint('Incoming ACK');
        peer.lastSentPacket.hasAck = true;
        peer.lastSentPacket.ackTimestamp = new Date;
        return;
      } else { // Data packet
        debugPrint('Incoming data.');
        const ackRequested = (CTLbyte & 0x40) > 0;
        if (payloadLength > 66) {
          payloadLength = 66;
        }

        const message2 = [{
          byteLength: payloadLength + 1,
          sendBuffer: Buffer.from([(reg.REG_FIFO & 0x7F)].concat(new Array(payloadLength).fill(0))),
          receiveBuffer: Buffer.alloc(payloadLength + 1),
          speedHz: reg.TRANSFER_SPEED,
        }];
        state.radio.transferSync(message2);
        const rssi = readRSSI();
        debugPrint(`RSSI: ${rssi}`);

        const payload = message2[0].receiveBuffer.slice(1);
        const payloadStr = payload.slice(0, -3).reduce((sum, current) => sum + String.fromCharCode(current), '');
        debugPrint(`Data packet: ${payloadStr}`);

        const packet = {
          targetAddress: targetAddress,
          senderAddress: senderAddress,
          peer: peer,
          rssi: rssi,
          payloadBuffer: payload,
          payload: payloadStr,
          requiresAck: ackRequested,
          hasAck: false,
          timestamp: new Date(),
        };
        peer.lastReceivedPacket = packet;

        if (ackRequested && state.options.autoAcknowledge) {
          debugPrint('Sending Ack.');
          sendAckFrame(senderAddress);
        }
        return packet;
      }
    }
  }

  function sendAckFrame(toAddress) {
    debugPrint(`Sending ACK to: ${toAddress}`);

    let bSend = [];
    setMode(reg.RF69_MODE_STANDBY);
    writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_00); // DIO0 is "Packet Sent"
    bSend = [reg.REG_FIFO | 0x80, 3, toAddress, state.options.address, 0x80];
    const message = [{
      byteLength: bSend.length,
      sendBuffer: Buffer.from(bSend),
      receiveBuffer: Buffer.alloc(bSend.length),
      speedHz: reg.TRANSFER_SPEED,
    }];
    state.radio.transferSync(message);

    setMode(reg.RF69_MODE_TX);

    state.peers.get(toAddress).lastReceivedPacket.hasAck = true;
    debugPrint(`Sent Ack packet ${bSend}`);
  }


  // Read a register from the radio
  function readRegSync(addr) {
    const message = [{
      byteLength: 2,
      sendBuffer: Buffer.from([(addr & 0x7F), 0]),
      receiveBuffer: Buffer.alloc(2),
      speedHz: reg.TRANSFER_SPEED,
    }];

    state.radio.transferSync(message);
    // debugPrint(`Register read: 0x${addr.toString(16)} => 0x${message[0].receiveBuffer[1].toString(16)}`);
    return message[0].receiveBuffer[1];
  }

  // Write a register to the radio
  function writeRegSync(addr, value) {
    const message = [{
      byteLength: 2,
      sendBuffer: Buffer.from([(addr | 0x80), value]),
      receiveBuffer: Buffer.alloc(2),
      speedHz: reg.TRANSFER_SPEED,
    }];

    state.radio.transferSync(message);
    // debugPrint(`Register write: 0x${addr.toString(16)} => 0x${value.toString(16)}`);
    return message[0].receiveBuffer[1];
  }


  function debugPrint(message) {
    if (state.options.verbose) {
      let m = new Date();
      console.log(`${formatDatetime(m)}: ${message}`);
    }
  }

  function formatDatetime(m) {
    return ('0' + m.getUTCHours()).slice(-2) + ':' +
      ('0' + m.getUTCMinutes()).slice(-2) + ':' +
      ('0' + m.getUTCSeconds()).slice(-2) + '.' +
      m.getUTCMilliseconds();
  }

  function setPowerLevel(powerLevelPercent) {
    state.options.powerLevelPercent = powerLevelPercent;
    state.powerLevel = Math.round(31.0 * (powerLevelPercent / 100.0));
    debugPrint(`********** Setting power level to: ${powerLevelPercent}% (${state.powerLevel})`);
    writeRegSync(reg.REG_PALEVEL, (readRegSync(reg.REG_PALEVEL) & 0xE0) | state.powerLevel);
  }

  function readTemp(calFactor = 0) {
    debugPrint('********** Reading temperature.');
    const curMode = state.mode;

    setMode(reg.RF69_MODE_STANDBY);

    writeRegSync(reg.REG_TEMP1, reg.RF_TEMP1_MEAS_START);

    return new Promise(resolve => {
      const wait = setInterval(() => {
        if (!(readRegSync(reg.REG_TEMP1) & reg.RF_TEMP1_MEAS_RUNNING)) {
          clearInterval(wait);
          // COURSE_TEMP_COEF puts reading in the ballpark, user can add additional correction
          // 'complement'corrects the slope, rising temp = rising val
          const temp = (Math.round(~readRegSync(reg.REG_TEMP2)) * -1) + reg.COURSE_TEMP_COEF + calFactor;
          debugPrint(`Got temperature: ${temp}`);

          setMode(curMode);
          resolve(temp);
        }
      }, 50);
    });
  }

  function sendTo({ toAddress, payload, attempts, attemptWait, requireAck }) {
    return new Promise((resolve, reject) => {
      debugPrint(`********** Sending '${payload}' to address: ${toAddress}`);

      if (!state.peers.has(toAddress)) {
        debugPrint(`Adding a new peer with address: ${toAddress}`);
        state.peers.set(toAddress, {
          lastReceivedPacket: {},
          lastSentPacket: {},
        });
      }
      const peer = state.peers.get(toAddress);
      if (peer.sending === true) {
        reject(new Error(`Already attempting to send to address ${toAddress}`));
        return;
      }

      try {
        peer.sending = true;

        if (attempts > 1) {
          requireAck = true;
        }

        let payloadStr = '';
        if (typeof payload === 'string') {
          payloadStr = payload;
          payload = Array.from(payloadStr).map(elm => elm.charCodeAt());
        } else {
          if (Array.isArray(payload)) {
            payloadStr = payload.reduce((sum, current) => sum + String.fromCharCode(current), '');
          } else {
            payloadStr = JSON.stringify(payload);
            payload = Array.from(payloadStr).map(elm => elm.charCodeAt());
          }
        }

        if (payload.length > reg.RF69_MAX_DATA_LEN) { payload = payload.slice(0, reg.RF69_MAX_DATA_LEN); }

        const packet = {
          targetAddress: toAddress,
          senderAddress: state.options.address,
          peer: peer,
          rssi: undefined,
          payloadBuffer: payload,
          payload: payloadStr,
          requiresAck: requireAck,
          hasAck: false,
          timestamp: new Date(),
        };
        peer.lastSentPacket = packet;

        let attempt = 0;

        if (requireAck) {
          setTimeout(function tick() {
            attempt += 1;
            debugPrint(`Send attempt: ${attempt} of ${attempts}`);
            sendToFrame(toAddress, payload, requireAck);
            setTimeout(() => {
              if (attempt < attempts && packet.hasAck === false) {
                debugPrint('No Ack received for our packet, retry.');
                setTimeout(tick, attemptWait);
              } else if (packet.hasAck === true) {
                debugPrint(`Ack received for our packet to address ${toAddress} on send attempt ${attempt}.`);
                peer.lastSentPacket.attempts = attempt;
                peer.sending = false;
                resolve(packet);
              } else if (attempt === attempts) {
                debugPrint('No Ack received. Giving up.');
                peer.sending = false;
                reject(new Error(`No Ack received for our packet to address ${toAddress} after ${attempt} attempts.`), attempt);
              }
            }, 200);
          }, 20);
        } else {
          sendToFrame(toAddress, payload, false);
          peer.sending = false;
          resolve(packet);
        }
      } catch (err){
        reject(err);
      } finally {
        if (peer) {
          peer.sending = false;
        }
      }
    });
  }

  function sendToFrame(toAddress, payload, requestAck) {
    debugPrint(`Sending packet to: ${toAddress}`);
    setMode(reg.RF69_MODE_STANDBY);
    writeRegSync(reg.REG_DIOMAPPING1, reg.RF_DIOMAPPING1_DIO0_00); // DIO0 is "Packet Sent"
    let ack = 0x00;
    // if (sendAck){ ack = 0x80 }
    if (requestAck) {
      ack = 0x40;
    }

    const bSend = [reg.REG_FIFO | 0x80, payload.length + 3, toAddress, state.options.address, ack].concat(payload);
    const message = [{
      byteLength: bSend.length,
      sendBuffer: Buffer.from(bSend),
      receiveBuffer: Buffer.alloc(bSend.length),
      speedHz: reg.TRANSFER_SPEED,
    }];
    state.radio.transferSync(message);

    setMode(reg.RF69_MODE_TX);

    debugPrint(`Sent: ${payload}`);
  }

  function calibrate() {
    return new Promise(resolve => {
      debugPrint('********** Calibrating radio.');
      writeRegSync(reg.REG_OSC1, reg.RF_OSC1_RCCAL_START);

      const inter = setInterval(() => {
        if ((readRegSync(reg.REG_OSC1) & reg.RF_OSC1_RCCAL_DONE) !== 0x00) {
          clearInterval(inter);
          debugPrint('Calibration complete.');
          resolve();
        }
      }, 20);
    });
  }

  function _registerPacketReceivedCallback(packetReceivedCallback) {
    if (typeof packetReceivedCallback === 'function') {
      state.packetReceivedCallbacks.push(packetReceivedCallback);
      debugPrint(`********** New packetReceivedCallback registered (${state.packetReceivedCallbacks.length})`);
    }
  }

  return {
    initialize: function(args) {
      let freqBand, interruptPin, resetPin, spiBus, spiDevice, encryptionKey;
      let address, networkID, isRFM69HW, powerLevelPercent, promiscuousMode, autoAcknowledge, verbose;
      ({
        freqBand = 'RF69_915MHZ', // 'RF69_315MHZ' or 'RF69_433MHZ' or 'RF69_868MHZ' or 'RF69_915MHZ' depending on radio hardware
        address = 1, // Address for this node
        networkID = 100,
        isRFM69HW = true, // Is High Power radio? Must be true for RF69HCW, RF69HW
        powerLevelPercent = 70, // Transmit power between 0 and 100
        interruptPin = 24, // Pin number of interrupt pin. This is a GPIO number (GPIO24 = pin 18).
        resetPin = 5, // Pin number of reset pin. This is a GPIO number (GPIO5 = pin 29).
        spiBus = 0, // SPI bus number.
        spiDevice = 0, // SPI device number.
        promiscuousMode = false, // Accept all packets
        encryptionKey = 0, // Key for AES encryption. Must be 16 chars long or no encryption set
        autoAcknowledge = true, // Automatically reply with Ack
        verbose = false, // Verbose logging to console
      } = args);

      state.options = { address, networkID, isRFM69HW, powerLevelPercent, promiscuousMode, autoAcknowledge, verbose };

      debugPrint('********** Starting initialization.');

      state.gpio_reset = new Gpio(resetPin, 'out');
      state.gpio_interrupt = new Gpio(interruptPin, 'in', 'rising');

      return initSpi(spiBus, spiDevice)
        .then(() => resetRadio(state.gpio_reset))
        .then(() => checkSyncItem(0xAA))
        .then(() => checkSyncItem(0x55))
        .then(() => {
          setConfig(freqBand, networkID);
          setEncryption(encryptionKey);
          setHighPower(isRFM69HW);
          setPowerLevel(powerLevelPercent);
          state.gpio_interrupt.watch(() => interruptHandler());
          return true;
        })
        .then(() => waitReady())
        .then(() => {
          setMode(reg.RF69_MODE_RX);
          debugPrint('Initialization complete.');
          return true;
        })
        .catch(err => {
          debugPrint(`Error during initializaiton: ${err}`);
          throw err;
        });
    },

    // Set the transmit power level between 0 and 100. Default 70
    setPowerLevel: function(powerLevelPercent) { setPowerLevel(powerLevelPercent); },

    // Read the temperature of the radios CMOS chip.
    // calFactor: Additional correction to corrects the slope, rising temp = rising val
    // Returns: Temperature in centigrade
    readTemperature: function(calFactor) { return readTemp(calFactor); },

    // Send payload to toAddress. Attempts sets number of retries waiting for Ack.
    // attemptWait ms between attempts. Wait for ack is 1000ms so total cycle = 1000 + attemptWait
    // requireAck set to true if attempts>0
    // Retruns a promise. Resolved when the ack is received if requireAck or otherwise on successfull send
    // Rejected if no ack received or error during send
    send: function({ toAddress = 0, payload = '', attempts = 3, attemptWait = 200, requireAck = true }) {
      return sendTo({ toAddress: toAddress, payload: payload, attempts: attempts, attemptWait: attemptWait, requireAck: requireAck });
    },

    // Broadcast a message to network i.e. sends to node 255 with no ACK request.
    broadcast: function(payload = '') {
      debugPrint(`********* Broadcast: ${payload}`);
      return sendTo({ toAddress: 255, payload: payload, attempts: 1, requireAck: false });
    },

    // Calibrate the internal RC oscillator for use in wide temperature variations.
    // See RFM69 datasheet section [4.3.5. RC Timer Accuracy] for more information.
    calibrateRadio: function() { return calibrate(); },

    // Register a new callback to be called with new packets
    registerPacketReceivedCallback: function(packetReceivedCallback) {
      _registerPacketReceivedCallback(packetReceivedCallback);
    },

    // Shutdown
    shutdown: function() {
      debugPrint('********** Shutting down.');
      if (state.gpio_reset) {
        state.gpio_reset.unexport();
      }
      if (state.gpio_interrupt) {
        state.gpio_interrupt.unexport();
      }
      if (state.radio) {
        state.radio.closeSync();
      }
    },
  };
};

module.exports = rfm69;
