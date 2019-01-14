/* eslint-disable max-len */
/* eslint-disable no-console */
'use strict';

const rfm69 = require('../lib/rfm69')();

rfm69.initialize({
  address: 1,
  // encryptionKey: '0123456789abcdef',
  verbose: false,
  powerLevelPercent: 20,
})
  .then(() => {
    console.log('Initialized');
    return rfm69.registerPacketReceivedCallback(packetReceivedCallback1);
  })
  .then(() => rfm69.registerPacketReceivedCallback(packetReceivedCallback2))
  .then(() => rfm69.readTemperature())
  .then((temp) => {
    console.log(`Temp: ${temp}`);
    return rfm69.calibrateRadio();
  })
  .then(() => {
    setInterval(() => {
      const toAddress = 2;
      console.log(`Sending packet to address ${toAddress}`);
      rfm69.send({ toAddress: toAddress, payload: `Hello ${timeStamp()}`, attempts: 3, requireAck: true })
        .then((packet) => {
          console.log(`Sent on attempt ${packet.attempts} after ${packet.ackTimestamp - packet.timestamp}ms`);
        })
        .catch(err => console.log(err));
    }, 3000);
  })
  .then(() => {
    setTimeout(() => {
      rfm69.broadcast('Broadcast!!')
        .then(() => console.log('Sent broadcast'));
    }, 2000);
  })
  .catch(err => {
    console.log(`Error initializing radio: ${err}`);
    rfm69.shutdown();
  });


function packetReceivedCallback1(packet) {
  console.log(`Packet received (callback1) from peer ${packet.senderAddress} "${packet.payloadString}" RSSI:${packet.rssi}`);
}
function packetReceivedCallback2(packet) {
  console.log(`Packet received (callback1) from peer ${packet.senderAddress} "${packet.payloadString}" RSSI:${packet.rssi}`);
}

process.on('SIGINT', () => {
  rfm69.shutdown();
});


function timeStamp() {
  const m = new Date();
  return ('0' + m.getUTCMinutes()).slice(-2) + ':' +
    ('0' + m.getUTCSeconds()).slice(-2) + '.' +
    m.getUTCMilliseconds();
}
