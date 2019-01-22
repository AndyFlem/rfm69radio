# RFM69RADIO
A Node module for sending and receiving through RFM69 radios on the Raspberry Pi.

Ported from [etrombly's python version](https://github.com/etrombly) of the [LowPowerLab code](https://github.com/LowPowerLab/RFM69).

## Hardware
This version tested on a pair of [Adafruit RFM69HCW Radios](https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/overview) with this NodeJS code running on a [Raspberry Pi 3 Model B](https://www.raspberrypi.org/products/raspberry-pi-3-model-b/). 

The default wiring is:

| RFM pin | Pi pin  
| ------- |-------
| 3v3     | 17  
| DIO0    | 18 (GPIO24)  
| MOSI    | 19 (GPIO10)
| MISO    | 21 (GPIO09)
| CLK     | 23 (GPIO11)
| CS (NSS)| 24 (GPIO08 CS0)
| Ground  | 25  
| RESET   | 29 (GPIO05)

See [here for the Raspberry Pi 3 GPIO pins](https://docs.microsoft.com/en-us/windows/iot-core/learn-about-hardware/pinmappings/pinmappingsrpi).

The second radio is connected to an Arduino UNO running the code in [frm69_test.ino](https://github.com/AndyFlem/rfm69radio/blob/master/frm69_test/rfm69_test.ino) and connected according to the instrucitons from [Adafruit](https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/arduino-wiring).

## Install
`npm install rfm69radio`

## Usage
Create the module.
```javascript
const RFM69 = require('rfm69radio');
const rfm69 = new RFM69();
```


Initialize the radio. Provide an address for the node and optionally a _16 char_ encryption key.
Then, register callback to handle recevied packets.
Then, read the temperature of the radio ic.
Then, calibrate the radio.
Then, send some packets.
```javascript
rfm69.initialize({
  address: 1,
  // encryptionKey: '0123456789abcdef',
  verbose: false,
  powerLevelPercent: 20,
})
  .then(() => {
    console.log('Initialized');
    rfm69.registerPacketReceivedCallback(packetReceivedCallback1);
    rfm69.registerPacketReceivedCallback(packetReceivedCallback2);
    return true;
  })
  .then(() => rfm69.readTemperature())
  .then((temp) => {
    console.log(`Temp: ${temp}`);
    rfm69.calibrateRadio();
    return true;
  })
  .then(() => {
    setInterval(() => {
      const toAddress = 2;
      console.log(`Sending packet to address ${toAddress}`);
      rfm69.send({ toAddress: toAddress, payload: `Hello ${timeStamp()}`, attempts: 3, requireAck: true })
        .then((packet) => {
          console.log(`Sent on attempt ${packet.attempts} after ${packet.ackTimestamp - packet.timestamp}ms`);
          return true;
        })
        .catch(err => console.log(err));
    }, 3000);

    setTimeout(() => {
      rfm69.broadcast('Broadcast!!')
        .then(() => {
          console.log('Sent broadcast');
          return true;
        })
        .catch(err => console.log(err));
    }, 2000);
    return true;
  })
  .catch(err => {
    console.log(`Error initializing radio: ${err}`);
    rfm69.shutdown();
  });


function packetReceivedCallback1(packet) {
  console.log(`Packet received (callback1) from peer ${packet.senderAddress} "${packet.payloadString}" RSSI:${packet.rssi}`);
}
function packetReceivedCallback2(packet) {
  console.log(`Packet received (callback2) from peer ${packet.senderAddress} "${packet.payloadString}" RSSI:${packet.rssi}`);
} 
```

## Dependencies

- GPIO access and interrupt detection: [onoff](https://www.npmjs.com/package/onoff)
- SPI Interface: [spi-device](https://www.npmjs.com/package/spi-device)